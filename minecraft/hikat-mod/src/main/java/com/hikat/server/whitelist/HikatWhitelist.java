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
import java.util.concurrent.ConcurrentSkipListSet;

public class HikatWhitelist {
    private static final Logger LOGGER = LoggerFactory.getLogger(HikatWhitelist.class);
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static HikatWhitelist INSTANCE;

    private final Path configFile;
    private volatile boolean enabled = false;
    private final Set<String> allowedUsernames = new ConcurrentSkipListSet<>(String.CASE_INSENSITIVE_ORDER);

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

            allowedUsernames.clear();
            if (json.has("allowedUsernames") && json.get("allowedUsernames").isJsonArray()) {
                JsonArray arr = json.getAsJsonArray("allowedUsernames");
                for (JsonElement el : arr) {
                    if (el.isJsonPrimitive()) {
                        String name = el.getAsString().trim();
                        if (!name.isEmpty()) {
                            allowedUsernames.add(name);
                        }
                    }
                }
            }
            LOGGER.info("[HiKAT] Whitelist loaded. Enabled: {}, Entries: {}", enabled, allowedUsernames.size());
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
            for (String username : allowedUsernames) {
                arr.add(username);
            }
            json.add("allowedUsernames", arr);

            Files.writeString(configFile, GSON.toJson(json), StandardCharsets.UTF_8);
        } catch (Exception e) {
            LOGGER.error("[HiKAT] Failed to save whitelist file: {}", e.getMessage());
        }
    }

    public boolean isAllowed(String username) {
        if (!enabled) {
            return true;
        }
        if (username == null || username.isBlank()) {
            return false;
        }
        return allowedUsernames.contains(username.trim());
    }

    public synchronized boolean add(String username) {
        if (username == null || username.isBlank()) return false;
        boolean added = allowedUsernames.add(username.trim());
        if (added) {
            save();
        }
        return added;
    }

    public synchronized boolean remove(String username) {
        if (username == null || username.isBlank()) return false;
        boolean removed = allowedUsernames.remove(username.trim());
        if (removed) {
            save();
        }
        return removed;
    }

    public synchronized void setEnabled(boolean enabled) {
        this.enabled = enabled;
        save();
    }

    public boolean isEnabled() {
        return enabled;
    }

    public Set<String> getAllowedUsernames() {
        return Collections.unmodifiableSet(allowedUsernames);
    }
}
