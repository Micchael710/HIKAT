package com.hikat.server;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class HiKatWhitelist {
    public record WhitelistEntry(String userId, String displayName, String addedAt) {}

    public static class WhitelistFile {
        public boolean enabled = false;
        public List<WhitelistEntry> entries = new ArrayList<>();
    }

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private final Path whitelistPath;
    private final Path tempPath;
    private WhitelistFile data = new WhitelistFile();

    public HiKatWhitelist(Path serverRoot) {
        Path dir = serverRoot.resolve("hikat");
        this.whitelistPath = dir.resolve("whitelist.json");
        this.tempPath = dir.resolve("whitelist.tmp");
        load();
    }

    public synchronized void load() {
        try {
            if (Files.exists(whitelistPath)) {
                String json = Files.readString(whitelistPath);
                WhitelistFile parsed = GSON.fromJson(json, WhitelistFile.class);
                if (parsed != null) {
                    if (parsed.entries == null) parsed.entries = new ArrayList<>();
                    this.data = parsed;
                    return;
                }
            }
        } catch (Exception e) {
            System.err.println("[HiKAT] Error reading whitelist.json: " + e.getMessage());
        }
        this.data = new WhitelistFile();
    }

    public synchronized void save() throws IOException {
        Files.createDirectories(whitelistPath.getParent());
        String json = GSON.toJson(this.data);
        Files.writeString(tempPath, json);
        Files.move(tempPath, whitelistPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    public synchronized boolean isEnabled() {
        return data.enabled;
    }

    public synchronized void setEnabled(boolean enabled) throws IOException {
        data.enabled = enabled;
        save();
    }

    public synchronized boolean isAllowed(String userId) {
        if (!data.enabled) return true;
        if (userId == null || userId.isBlank()) return false;
        for (WhitelistEntry entry : data.entries) {
            if (userId.equals(entry.userId())) {
                return true;
            }
        }
        return false;
    }

    public synchronized boolean add(String userId, String displayName) throws IOException {
        if (userId == null || userId.isBlank()) return false;
        for (WhitelistEntry entry : data.entries) {
            if (userId.equals(entry.userId())) {
                return false; // already present
            }
        }
        data.entries.add(new WhitelistEntry(userId, displayName, Instant.now().toString()));
        save();
        return true;
    }

    public synchronized boolean remove(String userId) throws IOException {
        if (userId == null || userId.isBlank()) return false;
        boolean removed = data.entries.removeIf(e -> userId.equals(e.userId()));
        if (removed) {
            save();
        }
        return removed;
    }

    public synchronized List<WhitelistEntry> getEntries() {
        return Collections.unmodifiableList(new ArrayList<>(data.entries));
    }
}
