package com.hikat.server;

import com.google.gson.Gson;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public class IntegrityService {
    public record IntegrityData(String releaseId, String expectedFingerprint) {}

    private static final Gson GSON = new Gson();
    private final Path integrityJsonPath;
    private long lastModified = -1;
    private IntegrityData cachedData = null;

    public IntegrityService(Path serverRoot) {
        this.integrityJsonPath = serverRoot.resolve("hikat").resolve("integrity.json");
    }

    public synchronized IntegrityData getIntegrityData() throws IOException {
        if (!Files.exists(integrityJsonPath)) {
            throw new IOException("Server integrity configuration not found at " + integrityJsonPath);
        }
        long mtime = Files.getLastModifiedTime(integrityJsonPath).toMillis();
        if (cachedData == null || mtime != lastModified) {
            String json = Files.readString(integrityJsonPath);
            cachedData = GSON.fromJson(json, IntegrityData.class);
            lastModified = mtime;
        }
        return cachedData;
    }

    public void verify(String clientReleaseId, String clientFingerprint) throws Exception {
        IntegrityData data = getIntegrityData();
        if (data == null || data.releaseId() == null || data.expectedFingerprint() == null) {
            throw new SecurityException("Server integrity configuration is invalid");
        }

        if (!data.releaseId().equals(clientReleaseId)) {
            throw new SecurityException("Release mismatch: client has " + clientReleaseId + ", server requires " + data.releaseId());
        }

        if (!data.expectedFingerprint().equalsIgnoreCase(clientFingerprint)) {
            throw new SecurityException("File integrity check failed: client files do not match server release");
        }
    }
}
