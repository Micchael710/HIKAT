package com.hikat.client.integrity;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
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
                "Fingerprint must restore to original after restoring file",
                3000
        );
        assertEquals(originalFingerprint, service.getFingerprint());

        // C) Crear archivo extra en directorio protegido: fingerprint cambia
        Path extraMod = modsDir.resolve("unauthorized-extra.jar");
        Files.writeString(extraMod, "cheat-extra-bytes");
        awaitCondition(
                () -> !originalFingerprint.equals(service.getFingerprint()),
                "Fingerprint must change when unauthorized file is added to protected dir",
                3000
        );
        String extraFingerprint = service.getFingerprint();
        assertNotEquals(originalFingerprint, extraFingerprint);

        // D) Eliminar el extra: vuelve al fingerprint anterior
        Files.delete(extraMod);
        awaitCondition(
                () -> originalFingerprint.equals(service.getFingerprint()),
                "Fingerprint must return to original when extra file is removed",
                3000
        );
        assertEquals(originalFingerprint, service.getFingerprint());

        // E) Modificar archivo MODIFICABLE: fingerprint no cambia y no dispara PENDING
        int pendingBefore = service.getPendingTransitions();
        Files.writeString(configFile, "setting_a = false\nsetting_b = 42");
        Thread.sleep(200); // Give watcher time to observe if any event fired
        assertEquals(originalFingerprint, service.getFingerprint(), "Modifying MODIFICABLE file must NOT alter fingerprint");
        assertEquals(pendingBefore, service.getPendingTransitions(), "Modifying MODIFICABLE file must NOT trigger PENDING state");

        // F) Crear una SUBCARPETA nueva dentro de directorio protegido y crear archivo dentro
        Path subDir = modsDir.resolve("subfolder");
        Files.createDirectory(subDir);
        Path subFile = subDir.resolve("nested-mod.jar");
        Files.writeString(subFile, "nested-mod-bytes");

        awaitCondition(
                () -> !originalFingerprint.equals(service.getFingerprint()),
                "Watcher must register new subdirectory and detect new file inside it",
                3000
        );
        String subfolderFingerprint = service.getFingerprint();
        assertNotEquals(originalFingerprint, subfolderFingerprint);

        // G) Durante un evento protegido: el estado pasa por PENDING antes de quedar VALID
        assertTrue(service.getPendingTransitions() > 0, "Integrity service must have transitioned through PENDING during mutations");
        assertEquals(ClientIntegrityService.IntegrityState.VALID, service.getState());
    }
}
