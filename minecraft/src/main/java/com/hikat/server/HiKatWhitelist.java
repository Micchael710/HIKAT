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

    public synchronized boolean isAllowed(String userId, String displayName) {
        if (!data.enabled) return true;
        for (WhitelistEntry entry : data.entries) {
            if (userId != null && !userId.isBlank() && entry.userId() != null && userId.equals(entry.userId())) {
                return true;
            }
            if (displayName != null && !displayName.isBlank() && entry.displayName() != null && displayName.equalsIgnoreCase(entry.displayName().trim())) {
                return true;
            }
        }
        return false;
    }

    public synchronized boolean isAllowed(String userId) {
        return isAllowed(userId, null);
    }

    public synchronized boolean add(String displayName) throws IOException {
        if (displayName == null || displayName.isBlank()) return false;
        String clean = displayName.trim();
        for (WhitelistEntry entry : data.entries) {
            if (entry.displayName() != null && entry.displayName().trim().equalsIgnoreCase(clean)) {
                return false; // already present case-insensitively
            }
        }
        data.entries.add(new WhitelistEntry(null, clean, Instant.now().toString()));
        save();
        return true;
    }

    public synchronized boolean add(String userId, String displayName) throws IOException {
        if ((userId == null || userId.isBlank()) && (displayName == null || displayName.isBlank())) return false;
        for (WhitelistEntry entry : data.entries) {
            if (userId != null && !userId.isBlank() && entry.userId() != null && userId.equals(entry.userId())) {
                return false;
            }
            if (displayName != null && !displayName.isBlank() && entry.displayName() != null && entry.displayName().trim().equalsIgnoreCase(displayName.trim())) {
                return false;
            }
        }
        data.entries.add(new WhitelistEntry(userId, displayName != null ? displayName.trim() : null, Instant.now().toString()));
        save();
        return true;
    }

    public synchronized boolean remove(String target) throws IOException {
        if (target == null || target.isBlank()) return false;
        String clean = target.trim();
        boolean removed = data.entries.removeIf(e ->
            (e.displayName() != null && e.displayName().trim().equalsIgnoreCase(clean)) ||
            (e.userId() != null && e.userId().equals(clean))
        );
        if (removed) {
            save();
        }
        return removed;
    }

    public synchronized List<WhitelistEntry> getEntries() {
        return Collections.unmodifiableList(new ArrayList<>(data.entries));
    }
}
