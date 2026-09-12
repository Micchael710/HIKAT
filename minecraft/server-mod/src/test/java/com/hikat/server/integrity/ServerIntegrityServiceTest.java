package com.hikat.server.integrity;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

public class ServerIntegrityServiceTest {

    @Test
    void testIntegrityManifestMatching(@TempDir Path tempDir) throws Exception {
        Path hikatDir = tempDir.resolve("hikat");
        Files.createDirectories(hikatDir);
        Path integrityFile = hikatDir.resolve("integrity.json");

        String json = """
                {
                  "version": "1.2.0",
                  "officialFingerprint": "abc123canonicalhash",
                  "generatedAt": "2026-09-12T12:00:00Z"
                }
                """;
        Files.writeString(integrityFile, json);

        ServerIntegrityService service = new ServerIntegrityService(integrityFile);
        assertTrue(service.isLoaded());
        assertEquals("1.2.0", service.getOfficialReleaseVersion());
        assertEquals("abc123canonicalhash", service.getOfficialFingerprint());

        // Version match
        assertTrue(service.isVersionMatch("1.2.0"));
        assertFalse(service.isVersionMatch("1.1.0"));

        // Fingerprint match
        assertTrue(service.isFingerprintMatch("abc123canonicalhash"));
        assertFalse(service.isFingerprintMatch("tamperedhash"));
    }

    @Test
    void testMissingIntegrityPermitsDevMode(@TempDir Path tempDir) {
        Path missing = tempDir.resolve("non-existent.json");
        ServerIntegrityService service = new ServerIntegrityService(missing);
        assertFalse(service.isLoaded());

        // When no manifest is loaded, dev fallback permits connection
        assertTrue(service.isVersionMatch("any-version"));
        assertTrue(service.isFingerprintMatch("any-fingerprint"));
    }
}
