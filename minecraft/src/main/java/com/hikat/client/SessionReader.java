package com.hikat.client;

import com.hikat.common.FingerprintUtil;
import com.hikat.common.SessionData;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

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
        Set<String> officialProtected = new HashSet<>();

        // Collect official NO_MODIFICABLE files
        if (sessionData.protectedFiles() != null) {
            for (String relPath : sessionData.protectedFiles()) {
                if (relPath != null && !relPath.isBlank()) {
                    officialProtected.add(FingerprintUtil.normalizePath(relPath));
                }
            }
        }
        if (sessionData.filePolicies() != null) {
            for (SessionData.PolicyEntry fp : sessionData.filePolicies()) {
                if (fp != null && fp.path() != null && "NO_MODIFICABLE".equalsIgnoreCase(fp.policy())) {
                    officialProtected.add(FingerprintUtil.normalizePath(fp.path()));
                }
            }
        }

        // 1. Process official protected files: hash if present, or mark MISSING
        for (String norm : officialProtected) {
            if (!FingerprintUtil.isSafePath(gameRoot, norm)) {
                throw new SecurityException("Unsafe or symlinked path detected in protected files: " + norm);
            }
            Path target = gameRoot.resolve(norm);
            if (Files.isRegularFile(target)) {
                String hash = FingerprintUtil.sha256Hex(target);
                fileHashes.put(norm, hash);
            } else {
                fileHashes.put(norm, "MISSING");
            }
        }

        // 2. Scan areas covered by directoryPolicies for extra files
        Set<String> visitedFiles = new HashSet<>(officialProtected);
        if (sessionData.directoryPolicies() != null) {
            for (SessionData.PolicyEntry dp : sessionData.directoryPolicies()) {
                if (dp == null || dp.path() == null) continue;
                String dirNorm = FingerprintUtil.normalizePath(dp.path());
                Path dirPath = dirNorm.isEmpty() ? gameRoot : gameRoot.resolve(dirNorm);
                if (Files.exists(dirPath) && Files.isDirectory(dirPath)) {
                    try (var stream = Files.walk(dirPath)) {
                        for (Path file : (Iterable<Path>) stream.filter(Files::isRegularFile)::iterator) {
                            String rel = FingerprintUtil.normalizePath(gameRoot.relativize(file).toString());
                            if (visitedFiles.add(rel)) {
                                if (!FingerprintUtil.isSafePath(gameRoot, rel)) {
                                    throw new SecurityException("Unsafe or symlinked path detected: " + rel);
                                }
                                String policy = sessionData.resolveEffectivePolicy(rel);
                                if ("NO_MODIFICABLE".equalsIgnoreCase(policy)) {
                                    String hash = FingerprintUtil.sha256Hex(file);
                                    fileHashes.put(rel, hash);
                                }
                            }
                        }
                    }
                }
            }
        }

        String fingerprint = FingerprintUtil.computeCanonicalFingerprint(fileHashes);
        return new ClientSnapshot(sessionData, Collections.unmodifiableMap(fileHashes), fingerprint);
    }
}
