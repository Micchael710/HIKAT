package com.hikat.server.whitelist;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentSkipListSet;

public class HikatWhitelist {
    private static final Logger LOGGER = LoggerFactory.getLogger(HikatWhitelist.class);
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static HikatWhitelist INSTANCE;

    private final Path configFile;
    private volatile boolean enabled = false;
    private final Set<UUID> allowedUuids = new ConcurrentSkipListSet<>();
    private final java.util.Map<String, UUID> knownPlayersByName = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.Map<UUID, String> knownNamesByUuid = new java.util.concurrent.ConcurrentHashMap<>();

    public static synchronized HikatWhitelist getInstance(Path configDir) {
        if (INSTANCE == null) {
            Path file = configDir.resolve("hikat").resolve("whitelist.json");
            INSTANCE = new HikatWhitelist(file);
        }
        return INSTANCE;
    }

    public static synchronized HikatWhitelist getInstance() {
        return INSTANCE;
    }

    public HikatWhitelist(Path configFile) {
        this.configFile = configFile;
        load();
    }

    public synchronized void load() {
        if (configFile == null || !Files.exists(configFile)) {
            return;
        }

        try {
            String content = Files.readString(configFile, StandardCharsets.UTF_8);
            JsonObject json = JsonParser.parseString(content).getAsJsonObject();

            if (json.has("enabled")) {
                this.enabled = json.get("enabled").getAsBoolean();
            }

            allowedUuids.clear();
            if (json.has("allowedUuids") && json.get("allowedUuids").isJsonArray()) {
                JsonArray arr = json.getAsJsonArray("allowedUuids");
                for (JsonElement el : arr) {
                    if (el.isJsonPrimitive()) {
                        try {
                            allowedUuids.add(java.util.UUID.fromString(el.getAsString().trim()));
                        } catch (IllegalArgumentException ignored) {}
                    }
                }
            }
            LOGGER.info("[HiKAT] Whitelist loaded. Enabled: {}, Entries: {}", enabled, allowedUuids.size());
        } catch (Exception e) {
            LOGGER.error("[HiKAT] Failed to read whitelist file: {}", e.getMessage());
        }
    }

    public synchronized void save() {
        if (configFile == null) return;
        try {
            if (!Files.exists(configFile.getParent())) {
                Files.createDirectories(configFile.getParent());
            }

            JsonObject json = new JsonObject();
            json.addProperty("enabled", enabled);

            JsonArray arr = new JsonArray();
            for (UUID uuid : allowedUuids) {
                arr.add(uuid.toString());
            }
            json.add("allowedUuids", arr);

            Files.writeString(configFile, GSON.toJson(json), StandardCharsets.UTF_8);
        } catch (Exception e) {
            LOGGER.error("[HiKAT] Failed to save whitelist file: {}", e.getMessage());
        }
    }

    public void recordKnownPlayer(String username, UUID uuid) {
        if (username != null && !username.isBlank() && uuid != null) {
            String clean = username.trim();
            knownPlayersByName.put(clean.toLowerCase(java.util.Locale.ROOT), uuid);
            knownNamesByUuid.put(uuid, clean);
        }
    }

    public UUID findKnownUuid(String usernameOrUuid) {
        if (usernameOrUuid == null || usernameOrUuid.isBlank()) return null;
        String clean = usernameOrUuid.trim();
        UUID fromKnown = knownPlayersByName.get(clean.toLowerCase(java.util.Locale.ROOT));
        if (fromKnown != null) {
            return fromKnown;
        }
        try {
            return UUID.fromString(clean);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    public String getDisplayName(UUID uuid) {
        if (uuid == null) return null;
        return knownNamesByUuid.get(uuid);
    }

    public boolean isAllowed(UUID uuid) {
        if (!enabled) {
            return true;
        }
        if (uuid == null) {
            return false;
        }
        return allowedUuids.contains(uuid);
    }

    public boolean isAllowed(String usernameOrUuid) {
        if (!enabled) return true;
        UUID uuid = findKnownUuid(usernameOrUuid);
        return isAllowed(uuid);
    }

    public synchronized boolean add(UUID uuid) {
        if (uuid == null) return false;
        boolean added = allowedUuids.add(uuid);
        if (added) {
            save();
        }
        return added;
    }

    public synchronized boolean add(String usernameOrUuid) {
        UUID uuid = findKnownUuid(usernameOrUuid);
        if (uuid == null) return false;
        return add(uuid);
    }

    public synchronized boolean remove(UUID uuid) {
        if (uuid == null) return false;
        boolean removed = allowedUuids.remove(uuid);
        if (removed) {
            save();
        }
        return removed;
    }

    public synchronized boolean remove(String usernameOrUuid) {
        UUID uuid = findKnownUuid(usernameOrUuid);
        if (uuid == null) return false;
        return remove(uuid);
    }

    public synchronized void setEnabled(boolean enabled) {
        this.enabled = enabled;
        save();
    }

    public boolean isEnabled() {
        return enabled;
    }

    public Set<UUID> getAllowedUuids() {
        return Collections.unmodifiableSet(allowedUuids);
    }
}
