package com.hikat.client;

import com.hikat.common.FingerprintUtil;
import com.hikat.common.SessionData;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public final class SessionReader {
    public record ClientSnapshot(
        SessionData sessionData,
        Map<String, String> fileHashes,
        String fingerprint
    ) {}

    private SessionReader() {}

    public static ClientSnapshot loadSnapshot(Path gameRoot) throws IOException {
        Path sessionFile = gameRoot.resolve(".hikat").resolve("session.json");
        if (!Files.exists(sessionFile)) {
            throw new IOException("HiKAT session not found. Please launch the game through HiKAT Launcher.");
        }

        String json = Files.readString(sessionFile);
        SessionData sessionData = SessionData.fromJson(json);

        Map<String, String> fileHashes = new HashMap<>();
        if (sessionData.protectedFiles() != null) {
            for (String relPath : sessionData.protectedFiles()) {
                if (!FingerprintUtil.isSafePath(gameRoot, relPath)) {
                    throw new SecurityException("Unsafe or symlinked path detected in protected files: " + relPath);
                }
                String norm = FingerprintUtil.normalizePath(relPath);
                Path target = gameRoot.resolve(norm);
                if (Files.isRegularFile(target)) {
                    String hash = FingerprintUtil.sha256Hex(target);
                    fileHashes.put(norm, hash);
                } else {
                    fileHashes.put(norm, "MISSING");
                }
            }
        }

        String fingerprint = FingerprintUtil.computeCanonicalFingerprint(fileHashes);
        return new ClientSnapshot(sessionData, Collections.unmodifiableMap(fileHashes), fingerprint);
    }
}
