package com.hikat.server.integrity;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public class ServerIntegrityService {
    private static final Logger LOGGER = LoggerFactory.getLogger(ServerIntegrityService.class);
    private static ServerIntegrityService INSTANCE;

    private final Path integrityFile;
    private volatile boolean loaded = false;
    private volatile String officialReleaseVersion = "";
    private volatile String officialFingerprint = "";

    public static synchronized ServerIntegrityService getInstance(Path gameDir) {
        if (INSTANCE == null) {
            Path file = gameDir.resolve("hikat").resolve("integrity.json");
            INSTANCE = new ServerIntegrityService(file);
        }
        return INSTANCE;
    }

    public static synchronized ServerIntegrityService getInstance() {
        return INSTANCE;
    }

    public ServerIntegrityService(Path integrityFile) {
        this.integrityFile = integrityFile;
        reload();
    }

    public synchronized void reload() {
        loaded = false;
        officialReleaseVersion = "";
        officialFingerprint = "";

        if (integrityFile == null || !Files.exists(integrityFile)) {
            LOGGER.info("[HiKAT] No official integrity manifest found at {}", integrityFile);
            return;
        }

        try {
            String content = Files.readString(integrityFile, StandardCharsets.UTF_8);
            JsonObject json = JsonParser.parseString(content).getAsJsonObject();

            if (json.has("version") && !json.get("version").isJsonNull()) {
                officialReleaseVersion = json.get("version").getAsString().trim();
            }

            if (json.has("officialFingerprint") && !json.get("officialFingerprint").isJsonNull()) {
                officialFingerprint = json.get("officialFingerprint").getAsString().trim();
            }

            loaded = !officialFingerprint.isEmpty();
            LOGGER.info("[HiKAT] Loaded official integrity: version={}, fingerprint={}",
                    officialReleaseVersion, officialFingerprint);
        } catch (Exception e) {
            LOGGER.error("[HiKAT] Failed to load server integrity manifest: {}", e.getMessage());
        }
    }

    public boolean isLoaded() {
        return loaded;
    }

    public String getOfficialReleaseVersion() {
        return officialReleaseVersion;
    }

    public String getOfficialFingerprint() {
        return officialFingerprint;
    }

    public boolean isVersionMatch(String clientVersion) {
        if (!loaded || officialReleaseVersion.isEmpty()) {
            return false;
        }
        return officialReleaseVersion.equalsIgnoreCase(clientVersion != null ? clientVersion.trim() : "");
    }

    public boolean isFingerprintMatch(String clientFingerprint) {
        if (!loaded || officialFingerprint.isEmpty()) {
            return false;
        }
        return officialFingerprint.equalsIgnoreCase(clientFingerprint != null ? clientFingerprint.trim() : "");
    }
}
