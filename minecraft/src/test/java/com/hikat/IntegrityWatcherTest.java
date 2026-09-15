package com.hikat;

import com.hikat.client.IntegrityWatcher;
import com.hikat.client.SessionReader;
import com.hikat.common.FingerprintUtil;
import com.hikat.common.SessionData;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

public class IntegrityWatcherTest {

    private void awaitCondition(java.util.function.BooleanSupplier condition, long timeoutMs) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (!condition.getAsBoolean() && System.currentTimeMillis() < deadline) {
            Thread.sleep(50);
        }
    }

    @Test
    public void testWatcherLifecycleStartAndStopCleanly(@TempDir Path tempDir) throws IOException {
        Path modsDir = tempDir.resolve("mods");
        Files.createDirectories(modsDir);
        Path modFile = modsDir.resolve("mod.jar");
        Files.writeString(modFile, "initial-content");

        Map<String, String> initialHashes = new HashMap<>();
        initialHashes.put("mods/mod.jar", "initial-hash");

        AtomicReference<String> updatedFingerprint = new AtomicReference<>();
        IntegrityWatcher watcher = new IntegrityWatcher(
            tempDir,
            initialHashes,
            "initial-fingerprint",
            updatedFingerprint::set
        );

        assertFalse(watcher.isRunning());
        watcher.start();
        assertTrue(watcher.isRunning());

        watcher.stop();
        assertFalse(watcher.isRunning());
    }

    @Test
    public void testExtraFileBeforeHandshakeProducesDifferentFingerprint(@TempDir Path tempDir) throws IOException {
        Path hikatDir = tempDir.resolve(".hikat");
        Files.createDirectories(hikatDir);
        Path modsDir = tempDir.resolve("mods");
        Files.createDirectories(modsDir);

        Path officialMod = modsDir.resolve("official.jar");
        Files.writeString(officialMod, "official-binary-content");

        String sessionJson = """
            {
              "schemaVersion": 1,
              "releaseId": "rel-v1",
              "gameToken": "token-xyz",
              "protectedFiles": ["mods/official.jar"],
              "filePolicies": [{"path": "mods/official.jar", "policy": "NO_MODIFICABLE"}],
              "directoryPolicies": [{"path": "mods", "policy": "NO_MODIFICABLE"}]
            }
            """;
        Files.writeString(hikatDir.resolve("session.json"), sessionJson);

        SessionReader.ClientSnapshot baseline = SessionReader.loadSnapshot(tempDir);
        assertTrue(baseline.fileHashes().containsKey("mods/official.jar"));
        assertEquals(1, baseline.fileHashes().size());

        // User placed an extra file in mods/ before launching
        Path extraMod = modsDir.resolve("cheat.jar");
        Files.writeString(extraMod, "extra-cheat-binary");

        SessionReader.ClientSnapshot withExtra = SessionReader.loadSnapshot(tempDir);
        assertTrue(withExtra.fileHashes().containsKey("mods/cheat.jar"));
        assertEquals(2, withExtra.fileHashes().size());
        assertNotEquals(baseline.fingerprint(), withExtra.fingerprint(),
            "Fingerprint must differ when extra file is present in NO_MODIFICABLE directory");
    }

    @Test
    public void testModifyingKnownProtectedFileDetectedByWatcher(@TempDir Path tempDir) throws IOException, InterruptedException {
        Path modsDir = tempDir.resolve("mods");
        Files.createDirectories(modsDir);
        Path modFile = modsDir.resolve("official.jar");
        Files.writeString(modFile, "initial-content");

        String initHash = FingerprintUtil.sha256Hex(modFile);
        Map<String, String> initialHashes = new HashMap<>();
        initialHashes.put("mods/official.jar", initHash);
        String initFingerprint = FingerprintUtil.computeCanonicalFingerprint(initialHashes);

        SessionData sessionData = new SessionData(
            1, "rel-v1", "token-xyz",
            List.of("mods/official.jar"),
            List.of(new SessionData.PolicyEntry("mods/official.jar", "NO_MODIFICABLE")),
            List.of(new SessionData.PolicyEntry("mods", "NO_MODIFICABLE"))
        );

        AtomicReference<String> updatedFingerprint = new AtomicReference<>();
        IntegrityWatcher watcher = new IntegrityWatcher(
            tempDir,
            sessionData,
            initialHashes,
            initFingerprint,
            updatedFingerprint::set
        );

        watcher.start();
        try {
            // Modify protected file
            Files.writeString(modFile, "tampered-content");

            awaitCondition(() -> updatedFingerprint.get() != null, 2500);
            assertNotNull(updatedFingerprint.get(), "Watcher must detect modified protected file");
            assertNotEquals(initFingerprint, updatedFingerprint.get());
        } finally {
            watcher.stop();
        }
    }

    @Test
    public void testDeletingProtectedFileDetectedByWatcher(@TempDir Path tempDir) throws IOException, InterruptedException {
        Path modsDir = tempDir.resolve("mods");
        Files.createDirectories(modsDir);
        Path modFile = modsDir.resolve("official.jar");
        Files.writeString(modFile, "initial-content");

        String initHash = FingerprintUtil.sha256Hex(modFile);
        Map<String, String> initialHashes = new HashMap<>();
        initialHashes.put("mods/official.jar", initHash);
        String initFingerprint = FingerprintUtil.computeCanonicalFingerprint(initialHashes);

        SessionData sessionData = new SessionData(
            1, "rel-v1", "token-xyz",
            List.of("mods/official.jar"),
            List.of(new SessionData.PolicyEntry("mods/official.jar", "NO_MODIFICABLE")),
            List.of(new SessionData.PolicyEntry("mods", "NO_MODIFICABLE"))
        );

        AtomicReference<String> updatedFingerprint = new AtomicReference<>();
        IntegrityWatcher watcher = new IntegrityWatcher(
            tempDir,
            sessionData,
            initialHashes,
            initFingerprint,
            updatedFingerprint::set
        );

        watcher.start();
        try {
            // Delete protected file
            Files.delete(modFile);

            awaitCondition(() -> updatedFingerprint.get() != null, 2500);
            assertNotNull(updatedFingerprint.get(), "Watcher must detect deleted protected file");
            assertEquals("MISSING", watcher.getCurrentHashes().get("mods/official.jar"));
        } finally {
            watcher.stop();
        }
    }

    @Test
    public void testAddingExtraFileInProtectedDirectoryDetectedByWatcher(@TempDir Path tempDir) throws IOException, InterruptedException {
        Path modsDir = tempDir.resolve("mods");
        Files.createDirectories(modsDir);
        Path modFile = modsDir.resolve("official.jar");
        Files.writeString(modFile, "initial-content");

        String initHash = FingerprintUtil.sha256Hex(modFile);
        Map<String, String> initialHashes = new HashMap<>();
        initialHashes.put("mods/official.jar", initHash);
        String initFingerprint = FingerprintUtil.computeCanonicalFingerprint(initialHashes);

        SessionData sessionData = new SessionData(
            1, "rel-v1", "token-xyz",
            List.of("mods/official.jar"),
            List.of(new SessionData.PolicyEntry("mods/official.jar", "NO_MODIFICABLE")),
            List.of(new SessionData.PolicyEntry("mods", "NO_MODIFICABLE"))
        );

        AtomicReference<String> updatedFingerprint = new AtomicReference<>();
        IntegrityWatcher watcher = new IntegrityWatcher(
            tempDir,
            sessionData,
            initialHashes,
            initFingerprint,
            updatedFingerprint::set
        );

        watcher.start();
        try {
            // Add extra file to NO_MODIFICABLE directory
            Path extraMod = modsDir.resolve("hacked_client.jar");
            Files.writeString(extraMod, "illegal-code");

            awaitCondition(() -> updatedFingerprint.get() != null, 2500);
            assertNotNull(updatedFingerprint.get(), "Watcher must detect extra file added to NO_MODIFICABLE dir");
            assertNotEquals(initFingerprint, updatedFingerprint.get());
            assertTrue(watcher.getCurrentHashes().containsKey("mods/hacked_client.jar"));
        } finally {
            watcher.stop();
        }
    }

    @Test
    public void testSubdirectoryExceptionModificableAllowsExtrasWithoutViolation(@TempDir Path tempDir) throws IOException, InterruptedException {
        Path modsDir = tempDir.resolve("mods");
        Path customDir = modsDir.resolve("custom");
        Files.createDirectories(customDir);

        Path officialMod = modsDir.resolve("official.jar");
        Files.writeString(officialMod, "official-content");

        String initHash = FingerprintUtil.sha256Hex(officialMod);
        Map<String, String> initialHashes = new HashMap<>();
        initialHashes.put("mods/official.jar", initHash);
        String initFingerprint = FingerprintUtil.computeCanonicalFingerprint(initialHashes);

        SessionData sessionData = new SessionData(
            1, "rel-v1", "token-xyz",
            List.of("mods/official.jar"),
            List.of(new SessionData.PolicyEntry("mods/official.jar", "NO_MODIFICABLE")),
            List.of(
                new SessionData.PolicyEntry("mods", "NO_MODIFICABLE"),
                new SessionData.PolicyEntry("mods/custom", "MODIFICABLE")
            )
        );

        AtomicReference<String> updatedFingerprint = new AtomicReference<>();
        IntegrityWatcher watcher = new IntegrityWatcher(
            tempDir,
            sessionData,
            initialHashes,
            initFingerprint,
            updatedFingerprint::set
        );

        watcher.start();
        try {
            // Add extra file inside the MODIFICABLE exception subfolder
            Path userMod = customDir.resolve("user_allowed.jar");
            Files.writeString(userMod, "user-custom-content");

            // Wait beyond debounce (700ms)
            Thread.sleep(700);

            // Assert no violation was reported
            assertNull(updatedFingerprint.get(), "Extras in MODIFICABLE subfolder must not trigger integrity violation");
            assertFalse(watcher.getCurrentHashes().containsKey("mods/custom/user_allowed.jar"));

            // Now add an extra file in the parent NO_MODIFICABLE folder
            Path illegalMod = modsDir.resolve("illegal.jar");
            Files.writeString(illegalMod, "illegal-content");

            awaitCondition(() -> updatedFingerprint.get() != null, 2500);
            assertNotNull(updatedFingerprint.get(), "Watcher must detect extra file in NO_MODIFICABLE area");
        } finally {
            watcher.stop();
        }
    }

    @Test
    public void testArbitraryDirectoryPathsNotSpecialCasedForMods(@TempDir Path tempDir) throws IOException, InterruptedException {
        Path scriptsDir = tempDir.resolve("scripts");
        Path userScriptsDir = scriptsDir.resolve("user");
        Files.createDirectories(userScriptsDir);

        Path coreScript = scriptsDir.resolve("core.zs");
        Files.writeString(coreScript, "println('core');");

        String initHash = FingerprintUtil.sha256Hex(coreScript);
        Map<String, String> initialHashes = new HashMap<>();
        initialHashes.put("scripts/core.zs", initHash);
        String initFingerprint = FingerprintUtil.computeCanonicalFingerprint(initialHashes);

        SessionData sessionData = new SessionData(
            1, "rel-v1", "token-xyz",
            List.of("scripts/core.zs"),
            List.of(new SessionData.PolicyEntry("scripts/core.zs", "NO_MODIFICABLE")),
            List.of(
                new SessionData.PolicyEntry("scripts", "NO_MODIFICABLE"),
                new SessionData.PolicyEntry("scripts/user", "MODIFICABLE")
            )
        );

        AtomicReference<String> updatedFingerprint = new AtomicReference<>();
        IntegrityWatcher watcher = new IntegrityWatcher(
            tempDir,
            sessionData,
            initialHashes,
            initFingerprint,
            updatedFingerprint::set
        );

        watcher.start();
        try {
            // Add file to scripts/user/ (MODIFICABLE) -> no violation
            Files.writeString(userScriptsDir.resolve("custom.zs"), "println('user');");
            Thread.sleep(700);
            assertNull(updatedFingerprint.get(), "Arbitrary directory exception should be honored");

            // Add file to scripts/ (NO_MODIFICABLE) -> violation
            Files.writeString(scriptsDir.resolve("cheat.zs"), "println('cheat');");
            awaitCondition(() -> updatedFingerprint.get() != null, 2500);
            assertNotNull(updatedFingerprint.get(), "Arbitrary directory NO_MODIFICABLE violation must be detected");
            assertTrue(watcher.getCurrentHashes().containsKey("scripts/cheat.zs"));
        } finally {
            watcher.stop();
        }
    }

    @Test
    public void testProtectedFileReplacedBySymlinkDetectedByWatcher(@TempDir Path tempDir) throws Exception {
        // 1. A normal protected file exists
        Path modsDir = tempDir.resolve("mods");
        Files.createDirectories(modsDir);
        Path officialMod = modsDir.resolve("official.jar");
        Files.writeString(officialMod, "official-binary-content");

        Path externalDir = tempDir.resolve("external");
        Files.createDirectories(externalDir);
        Path externalTarget = externalDir.resolve("target.jar");
        Files.writeString(externalTarget, "official-binary-content");

        String initHash = FingerprintUtil.sha256Hex(officialMod);
        Map<String, String> initialHashes = new HashMap<>();
        initialHashes.put("mods/official.jar", initHash);
        String initFingerprint = FingerprintUtil.computeCanonicalFingerprint(initialHashes);

        SessionData sessionData = new SessionData(
            1, "rel-v1", "token-xyz",
            List.of("mods/official.jar"),
            List.of(new SessionData.PolicyEntry("mods/official.jar", "NO_MODIFICABLE")),
            List.of(new SessionData.PolicyEntry("mods", "NO_MODIFICABLE"))
        );

        AtomicReference<String> updatedFingerprint = new AtomicReference<>();
        IntegrityWatcher watcher = new IntegrityWatcher(
            tempDir,
            sessionData,
            initialHashes,
            initFingerprint,
            updatedFingerprint::set
        );

        // 2. Starts the watcher
        watcher.start();
        try {
            // 3. The file is replaced by a symlink
            Files.delete(officialMod);
            try {
                Files.createSymbolicLink(officialMod, externalTarget);
            } catch (UnsupportedOperationException | java.nio.file.FileSystemException | SecurityException e) {
                Assumptions.abort("Symlinks not supported in this environment: " + e.getMessage());
            }

            // 4. Verify that fingerprint changes and the violation is detected
            awaitCondition(() -> updatedFingerprint.get() != null, 2500);
            assertNotNull(updatedFingerprint.get(), "Watcher must detect symlink replacement of protected file");
            assertNotEquals(initFingerprint, updatedFingerprint.get(), "Fingerprint must change when protected file is replaced with a symlink");
            assertEquals("MISSING", watcher.getCurrentHashes().get("mods/official.jar"));
        } finally {
            watcher.stop();
        }
    }

    @Test
    public void testNewSymlinkInNoModificableDirectoryDetectedByWatcher(@TempDir Path tempDir) throws Exception {
        Path modsDir = tempDir.resolve("mods");
        Files.createDirectories(modsDir);
        Path officialMod = modsDir.resolve("official.jar");
        Files.writeString(officialMod, "official-binary-content");

        Path externalDir = tempDir.resolve("external");
        Files.createDirectories(externalDir);
        Path externalTarget = externalDir.resolve("cheat_payload.jar");
        Files.writeString(externalTarget, "cheat-payload-content");

        String initHash = FingerprintUtil.sha256Hex(officialMod);
        Map<String, String> initialHashes = new HashMap<>();
        initialHashes.put("mods/official.jar", initHash);
        String initFingerprint = FingerprintUtil.computeCanonicalFingerprint(initialHashes);

        SessionData sessionData = new SessionData(
            1, "rel-v1", "token-xyz",
            List.of("mods/official.jar"),
            List.of(new SessionData.PolicyEntry("mods/official.jar", "NO_MODIFICABLE")),
            List.of(new SessionData.PolicyEntry("mods", "NO_MODIFICABLE"))
        );

        AtomicReference<String> updatedFingerprint = new AtomicReference<>();
        IntegrityWatcher watcher = new IntegrityWatcher(
            tempDir,
            sessionData,
            initialHashes,
            initFingerprint,
            updatedFingerprint::set
        );

        watcher.start();
        try {
            Path newSymlink = modsDir.resolve("cheat.jar");
            try {
                Files.createSymbolicLink(newSymlink, externalTarget);
            } catch (UnsupportedOperationException | java.nio.file.FileSystemException | SecurityException e) {
                Assumptions.abort("Symlinks not supported in this environment: " + e.getMessage());
            }

            awaitCondition(() -> updatedFingerprint.get() != null, 2500);
            assertNotNull(updatedFingerprint.get(), "Watcher must detect new symlink in NO_MODIFICABLE directory");
            assertNotEquals(initFingerprint, updatedFingerprint.get(), "Fingerprint must change when new symlink is created in NO_MODIFICABLE directory");
            assertTrue(watcher.getCurrentHashes().containsKey("mods/cheat.jar"));
            assertEquals("ERROR", watcher.getCurrentHashes().get("mods/cheat.jar"));
        } finally {
            watcher.stop();
        }
    }
}
