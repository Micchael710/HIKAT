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

        // Version match & mismatch
        assertTrue(service.isVersionMatch("1.2.0"));
        assertFalse(service.isVersionMatch("1.1.0"));
        assertFalse(service.isVersionMatch(null));

        // Fingerprint match & mismatch
        assertTrue(service.isFingerprintMatch("abc123canonicalhash"));
        assertFalse(service.isFingerprintMatch("tamperedhash"));
        assertFalse(service.isFingerprintMatch(null));
    }

    @Test
    void testMissingIntegrityManifestFailsClosed(@TempDir Path tempDir) {
        Path missing = tempDir.resolve("non-existent.json");
        ServerIntegrityService service = new ServerIntegrityService(missing);
        assertFalse(service.isLoaded());

        // Fail-closed: Never accept when manifest is missing
        assertFalse(service.isVersionMatch("1.2.0"));
        assertFalse(service.isVersionMatch("any-version"));
        assertFalse(service.isFingerprintMatch("abc123canonicalhash"));
        assertFalse(service.isFingerprintMatch("any-fingerprint"));
    }

    @Test
    void testCorruptedIntegrityManifestFailsClosed(@TempDir Path tempDir) throws Exception {
        Path hikatDir = tempDir.resolve("hikat");
        Files.createDirectories(hikatDir);
        Path integrityFile = hikatDir.resolve("integrity.json");

        // Malformed JSON
        Files.writeString(integrityFile, "{ invalid json content: 123 }");

        ServerIntegrityService service = new ServerIntegrityService(integrityFile);
        assertFalse(service.isLoaded());

        // Fail-closed
        assertFalse(service.isVersionMatch("1.2.0"));
        assertFalse(service.isFingerprintMatch("any-fingerprint"));
    }

    @Test
    void testEmptyIntegrityManifestFailsClosed(@TempDir Path tempDir) throws Exception {
        Path hikatDir = tempDir.resolve("hikat");
        Files.createDirectories(hikatDir);
        Path integrityFile = hikatDir.resolve("integrity.json");

        // Empty file
        Files.writeString(integrityFile, "");

        ServerIntegrityService service = new ServerIntegrityService(integrityFile);
        assertFalse(service.isLoaded());

        // Fail-closed
        assertFalse(service.isVersionMatch("1.2.0"));
        assertFalse(service.isFingerprintMatch("any-fingerprint"));
    }
}
