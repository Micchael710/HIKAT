package com.hikat.common;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public final class FingerprintUtil {
    private FingerprintUtil() {}

    public static String normalizePath(String rawPath) {
        if (rawPath == null) return "";
        String normalized = rawPath.replace('\\', '/').trim();
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        String[] segments = normalized.split("/");
        for (String seg : segments) {
            if (seg.equals("..")) {
                throw new IllegalArgumentException("Path traversal rejected: " + rawPath);
            }
        }
        return normalized;
    }

    public static boolean isSafePath(Path root, String relPath) {
        try {
            String norm = normalizePath(relPath);
            if (norm.isEmpty()) return false;
            Path resolved = root.resolve(norm).normalize();
            if (!resolved.startsWith(root.normalize())) {
                return false;
            }
            Path current = root.normalize();
            for (Path part : root.relativize(resolved)) {
                current = current.resolve(part);
                if (Files.isSymbolicLink(current)) {
                    return false;
                }
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public static String sha256Hex(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(data);
            return toHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    public static String sha256Hex(Path file) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            try (InputStream is = Files.newInputStream(file)) {
                int read;
                while ((read = is.read(buffer)) != -1) {
                    md.update(buffer, 0, read);
                }
            }
            return toHex(md.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    public static String computeCanonicalFingerprint(Map<String, String> fileHashes) {
        List<String> paths = new ArrayList<>(fileHashes.keySet());
        Collections.sort(paths);
        StringBuilder sb = new StringBuilder();
        for (String path : paths) {
            String hash = fileHashes.get(path);
            if (hash != null) {
                sb.append(path).append('\u0000').append(hash.toLowerCase().trim()).append('\n');
            }
        }
        return sha256Hex(sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String toHex(byte[] bytes) {
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            hex.append(Character.forDigit((b >> 4) & 0xF, 16));
            hex.append(Character.forDigit(b & 0xF, 16));
        }
        return hex.toString();
    }
}
