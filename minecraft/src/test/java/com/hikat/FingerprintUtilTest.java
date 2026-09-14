package com.hikat;

import com.hikat.common.FingerprintUtil;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

public class FingerprintUtilTest {

    @Test
    public void testCanonicalFingerprintExactVector() {
        // Shared test vector matching TypeScript shared tests
        Map<String, String> hashes = new HashMap<>();
        hashes.put("mods/jei.jar", "ffeeddccbbaa00998877665544332211ffeeddccbbaa00998877665544332211");
        hashes.put("config/create.toml", "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0");
        hashes.put("mods/create.jar", "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff");

        String fingerprint = FingerprintUtil.computeCanonicalFingerprint(hashes);
        assertEquals("4fac370ba18fb419bdef32b87c01b28f3051a55f0a60a9d8a337fdd36f5d5c50", fingerprint);
    }

    @Test
    public void testNormalizePathAndTraversalRejection() {
        // Legitimate paths
        assertEquals("mods/create.jar", FingerprintUtil.normalizePath("mods\\create.jar"));
        assertEquals("mods/create.jar", FingerprintUtil.normalizePath("/mods/create.jar/"));
        assertEquals("mods/file..name.jar", FingerprintUtil.normalizePath("mods/file..name.jar"));

        // Path traversal attempts with .. segment must throw
        assertThrows(IllegalArgumentException.class, () -> FingerprintUtil.normalizePath("../mods/create.jar"));
        assertThrows(IllegalArgumentException.class, () -> FingerprintUtil.normalizePath("mods/../../etc/passwd"));
        assertThrows(IllegalArgumentException.class, () -> FingerprintUtil.normalizePath("mods/.."));
        assertThrows(IllegalArgumentException.class, () -> FingerprintUtil.normalizePath(".."));
    }

    @Test
    public void testSafePathRejectsSymlinks(@TempDir Path tempDir) throws IOException {
        Path realDir = tempDir.resolve("mods");
        Files.createDirectories(realDir);
        Path realFile = realDir.resolve("mod.jar");
        Files.writeString(realFile, "test-content");

        assertTrue(FingerprintUtil.isSafePath(tempDir, "mods/mod.jar"));

        // Create symlink
        try {
            Path symlink = tempDir.resolve("link.jar");
            Files.createSymbolicLink(symlink, realFile);
            assertFalse(FingerprintUtil.isSafePath(tempDir, "link.jar"));
        } catch (UnsupportedOperationException | SecurityException e) {
            // Symlinks may not be supported on some OS privileges, skip safely
        }
    }
}
