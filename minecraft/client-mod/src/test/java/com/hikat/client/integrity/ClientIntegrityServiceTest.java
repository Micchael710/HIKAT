package com.hikat.client.integrity;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

public class ClientIntegrityServiceTest {

    @Test
    void testIntegrityCalculationAndReactivity(@TempDir Path tempDir) throws Exception {
        // Setup folder structure
        Path hikatDir = tempDir.resolve(".hikat");
        Path modsDir = tempDir.resolve("mods");
        Path configDir = tempDir.resolve("config");
        Files.createDirectories(hikatDir);
        Files.createDirectories(modsDir);
        Files.createDirectories(configDir);

        Path modFile = modsDir.resolve("sample-mod.jar");
        Files.writeString(modFile, "dummy-mod-content-v1");

        Path configFile = configDir.resolve("settings.json");
        Files.writeString(configFile, "{\"setting\": true}");

        String manifestJson = """
                {
                  "modpackVersion": "1.0.0",
                  "directoryPolicies": [
                    { "path": "mods", "policy": "NO_MODIFICABLE" },
                    { "path": "config", "policy": "MODIFICABLE" }
                  ],
                  "files": {
                    "mods/sample-mod.jar": {
                      "policy": "NO_MODIFICABLE"
                    },
                    "config/settings.json": {
                      "policy": "MODIFICABLE"
                    }
                  }
                }
                """;
        Files.writeString(hikatDir.resolve("installed-manifest.json"), manifestJson);

        // 1. Initial fingerprint
        ClientIntegrityService service = new ClientIntegrityService(tempDir);
        assertEquals(ClientIntegrityService.IntegrityState.VALID, service.getState());
        assertEquals("1.0.0", service.getReleaseVersion());
        String initialFingerprint = service.getFingerprint();
        assertNotNull(initialFingerprint);
        assertFalse(initialFingerprint.isEmpty());

        // 2. Modifying a MODIFICABLE file does NOT change the fingerprint
        Files.writeString(configFile, "{\"setting\": false, \"updated\": true}");
        Thread.sleep(100); // Give watcher a moment if triggered
        assertEquals(initialFingerprint, service.getFingerprint(), "Modifying MODIFICABLE file should NOT change fingerprint");

        // 3. Modifying a NO_MODIFICABLE file DOES change fingerprint
        Files.writeString(modFile, "tampered-content");
        // Trigger watcher or re-check
        Thread.sleep(200);
        String tamperedFingerprint = service.getFingerprint();
        assertNotEquals(initialFingerprint, tamperedFingerprint, "Modifying NO_MODIFICABLE file must change fingerprint");

        // 4. Adding an extra file in a protected directory changes fingerprint
        Path extraMod = modsDir.resolve("cheat-mod.jar");
        Files.writeString(extraMod, "cheat-code");
        Thread.sleep(200);
        String extraModFingerprint = service.getFingerprint();
        assertNotEquals(tamperedFingerprint, extraModFingerprint, "Adding extra mod must change fingerprint");

        // 5. Deleting a protected file changes fingerprint
        Files.delete(extraMod);
        Thread.sleep(200);
        String afterDeleteExtra = service.getFingerprint();
        assertEquals(tamperedFingerprint, afterDeleteExtra, "Deleting extra mod should restore to tampered fingerprint");

        service.stopWatcher();
    }
}
