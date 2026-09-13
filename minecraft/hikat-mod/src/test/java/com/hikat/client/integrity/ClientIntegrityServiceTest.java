package com.hikat.client.integrity;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.WatchKey;
import java.util.function.BooleanSupplier;

import static org.junit.jupiter.api.Assertions.*;

public class ClientIntegrityServiceTest {

    @TempDir
    Path tempDir;

    private Path hikatDir;
    private Path modsDir;
    private Path configDir;
    private Path officialMod;
    private Path configFile;
    private ClientIntegrityService service;
    private String originalFingerprint;

    @BeforeEach
    void setUp() throws Exception {
        hikatDir = tempDir.resolve(".hikat");
        modsDir = tempDir.resolve("mods");
        configDir = tempDir.resolve("config");
        Files.createDirectories(hikatDir);
        Files.createDirectories(modsDir);
        Files.createDirectories(configDir);

        officialMod = modsDir.resolve("official-mod.jar");
        Files.writeString(officialMod, "official-mod-v1-bytes");

        configFile = configDir.resolve("settings.toml");
        Files.writeString(configFile, "setting_a = true");

        String manifestJson = """
                {
                  "modpackVersion": "1.0.0",
                  "directoryPolicies": [
                    { "path": "mods", "policy": "NO_MODIFICABLE" },
                    { "path": "config", "policy": "MODIFICABLE" }
                  ],
                  "files": {
                    "mods/official-mod.jar": {
                      "policy": "NO_MODIFICABLE"
                    },
                    "config/settings.toml": {
                      "policy": "MODIFICABLE"
                    }
                  }
                }
                """;
        Files.writeString(hikatDir.resolve("installed-manifest.json"), manifestJson);

        service = new ClientIntegrityService(tempDir);
        assertEquals(ClientIntegrityService.IntegrityState.VALID, service.getState());
        originalFingerprint = service.getFingerprint();
        assertNotNull(originalFingerprint);
        assertFalse(originalFingerprint.isEmpty());
    }

    @AfterEach
    void tearDown() {
        if (service != null) {
            service.stopWatcher();
        }
    }

    private void awaitCondition(BooleanSupplier condition, String failureReason, long timeoutMs) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (!condition.getAsBoolean()) {
            if (System.currentTimeMillis() > deadline) {
                fail("Timeout exceeded (" + timeoutMs + "ms): " + failureReason);
            }
            Thread.sleep(25);
        }
    }

    @Test
    void testRequirementsAThroughG() throws Exception {
        // A) Eliminar un archivo OFICIAL NO_MODIFICABLE: fingerprint cambia
        Files.delete(officialMod);
        awaitCondition(
                () -> !originalFingerprint.equals(service.getFingerprint()),
                "Fingerprint must change when official NO_MODIFICABLE file is deleted",
                3000
        );
        String deletedFingerprint = service.getFingerprint();
        assertNotEquals(originalFingerprint, deletedFingerprint);

        // B) Restaurarlo con contenido correcto: fingerprint vuelve al original
        Files.writeString(officialMod, "official-mod-v1-bytes");
        awaitCondition(
                () -> originalFingerprint.equals(service.getFingerprint()),
                "Fingerprint must return to original after restoring official file",
                3000
        );

        // C) Crear archivo extra en directorio protegido: fingerprint cambia
        Path extraFile = modsDir.resolve("unauthorized-cheat.jar");
        Files.writeString(extraFile, "cheat-bytes");
        awaitCondition(
                () -> !originalFingerprint.equals(service.getFingerprint()),
                "Fingerprint must change when extra file is created in protected directory",
                3000
        );
        String extraFingerprint = service.getFingerprint();

        // D) Eliminar el extra: vuelve al fingerprint anterior
        Files.delete(extraFile);
        awaitCondition(
                () -> originalFingerprint.equals(service.getFingerprint()),
                "Fingerprint must return to original after deleting extra file",
                3000
        );

        // E) Modificar archivo MODIFICABLE: fingerprint NO cambia
        String beforeConfigModify = service.getFingerprint();
        Files.writeString(configFile, "setting_a = false\nsetting_b = 42");
        Thread.sleep(300);
        assertEquals(beforeConfigModify, service.getFingerprint(),
                "Modifying MODIFICABLE file in config/ must not change fingerprint");

        // F) Crear una SUBCARPETA nueva dentro de directorio protegido y luego un archivo dentro
        Path subDir = modsDir.resolve("subfolder");
        Files.createDirectories(subDir);
        Thread.sleep(100);

        Path nestedFile = subDir.resolve("nested-mod.jar");
        Files.writeString(nestedFile, "nested-mod-bytes");
        awaitCondition(
                () -> !originalFingerprint.equals(service.getFingerprint()),
                "Watcher must detect file inside dynamically created subdirectory",
                3000
        );
        assertNotEquals(originalFingerprint, service.getFingerprint());

        // G) Durante un evento protegido: el estado pasa por PENDING antes de quedar VALID
        assertTrue(service.getPendingTransitions() > 0,
                "Integrity service must register PENDING state transitions during mutations");
        assertEquals(ClientIntegrityService.IntegrityState.VALID, service.getState(),
                "Integrity state must return to VALID once recalculation is complete");
    }

    @Test
    void testExplicitFilePolicyOverride(@TempDir Path customDir) throws Exception {
        Path customHikat = customDir.resolve(".hikat");
        Path customMods = customDir.resolve("mods");
        Files.createDirectories(customHikat);
        Files.createDirectories(customMods);

        Path allowedJar = customMods.resolve("allowed.jar");
        Path coreJar = customMods.resolve("core.jar");
        Files.writeString(allowedJar, "allowed-initial");
        Files.writeString(coreJar, "core-initial");

        // mods directory is NO_MODIFICABLE, but mods/allowed.jar is explicitly MODIFICABLE
        String manifestJson = """
                {
                  "modpackVersion": "2.0.0",
                  "directoryPolicies": [
                    { "path": "mods", "policy": "NO_MODIFICABLE" }
                  ],
                  "files": {
                    "mods/allowed.jar": {
                      "policy": "MODIFICABLE"
                    },
                    "mods/core.jar": {
                      "policy": "NO_MODIFICABLE"
                    }
                  }
                }
                """;
        Files.writeString(customHikat.resolve("installed-manifest.json"), manifestJson);

        ClientIntegrityService customService = new ClientIntegrityService(customDir);
        try {
            assertEquals(ClientIntegrityService.IntegrityState.VALID, customService.getState());
            String initFp = customService.getFingerprint();

            // Verify policy resolution directly
            assertEquals("MODIFICABLE", customService.resolveEffectivePolicy("mods/allowed.jar", null));
            assertEquals("NO_MODIFICABLE", customService.resolveEffectivePolicy("mods/core.jar", null));

            // Modifying allowed.jar (explicitly MODIFICABLE) must NOT change fingerprint
            Files.writeString(allowedJar, "allowed-modified-content");
            Thread.sleep(300);
            assertEquals(initFp, customService.getFingerprint(),
                    "Modifying explicitly MODIFICABLE file inside NO_MODIFICABLE directory must NOT alter fingerprint");

            // Modifying core.jar (NO_MODIFICABLE) MUST change fingerprint
            Files.writeString(coreJar, "core-modified-content");
            awaitCondition(
                    () -> !initFp.equals(customService.getFingerprint()),
                    "Modifying protected core.jar must alter fingerprint",
                    3000
            );
            assertNotEquals(initFp, customService.getFingerprint());
        } finally {
            customService.stopWatcher();
        }
    }

    @Test
    void testMissingManifestFailsClosed(@TempDir Path emptyDir) {
        ClientIntegrityService missingService = new ClientIntegrityService(emptyDir);
        assertEquals(ClientIntegrityService.IntegrityState.INVALID, missingService.getState(),
                "Missing manifest must initialize to INVALID fail-closed");
        assertEquals("MANIFEST_NOT_FOUND", missingService.getFingerprint());
    }

    @Test
    void testHikatManifestPriorityOverRootManifest(@TempDir Path priorityDir) throws Exception {
        Path hikatFolder = priorityDir.resolve(".hikat");
        Files.createDirectories(hikatFolder);

        // Manifest inside .hikat has version 3.0.0
        String hikatManifestJson = """
                {
                  "modpackVersion": "3.0.0",
                  "directoryPolicies": [],
                  "files": {}
                }
                """;
        Files.writeString(hikatFolder.resolve("installed-manifest.json"), hikatManifestJson);

        // Manifest in root has version 1.0.0
        String rootManifestJson = """
                {
                  "modpackVersion": "1.0.0",
                  "directoryPolicies": [],
                  "files": {}
                }
                """;
        Files.writeString(priorityDir.resolve("installed-manifest.json"), rootManifestJson);

        ClientIntegrityService priorityService = new ClientIntegrityService(priorityDir);
        try {
            assertEquals("3.0.0", priorityService.getReleaseVersion(),
                    ".hikat/installed-manifest.json must take precedence over root installed-manifest.json");
        } finally {
            priorityService.stopWatcher();
        }

        // Test fallback: when .hikat manifest is absent, root is used
        Files.delete(hikatFolder.resolve("installed-manifest.json"));
        ClientIntegrityService fallbackService = new ClientIntegrityService(priorityDir);
        try {
            assertEquals("1.0.0", fallbackService.getReleaseVersion(),
                    "Root installed-manifest.json must be used as fallback when .hikat does not exist");
        } finally {
            fallbackService.stopWatcher();
        }
    }

    @Test
    void testWatchKeyInvalidationFailsClosed() throws Exception {
        // Initially valid
        assertEquals(ClientIntegrityService.IntegrityState.VALID, service.getState());
        assertFalse(service.isWatcherFailed());
        assertFalse(service.getWatchKeyPaths().isEmpty());

        // Get an active WatchKey for one of the protected directories (e.g. mods)
        WatchKey key = service.getWatchKeyPaths().keySet().iterator().next();
        assertNotNull(key);
        assertTrue(key.isValid());

        // Invalidate/cancel the WatchKey
        key.cancel();
        assertFalse(key.isValid());

        // Process the key through handleWatchKey (as happens in watcher loop on event)
        service.handleWatchKey(key);

        // Verify key was removed from watchKeyPaths
        assertFalse(service.getWatchKeyPaths().containsKey(key));

        // Verify watcher is marked failed and state is set to INVALID fail-closed
        assertTrue(service.isWatcherFailed());
        assertEquals(ClientIntegrityService.IntegrityState.INVALID, service.getState());

        // Subsequent file changes must NEVER return state to VALID
        Files.writeString(officialMod, "official-mod-corrupted-after-cancel");
        Thread.sleep(300);
        assertEquals(ClientIntegrityService.IntegrityState.INVALID, service.getState(),
                "State must permanently remain INVALID after WatchKey invalidation");
    }
}
