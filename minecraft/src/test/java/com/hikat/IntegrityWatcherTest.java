package com.hikat;

import com.hikat.client.IntegrityWatcher;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

public class IntegrityWatcherTest {

    @Test
    public void testWatcherLifecycleStartAndStopCleanly(@TempDir Path tempDir) throws IOException, InterruptedException {
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

        // Stop watcher cleanly
        watcher.stop();
        assertFalse(watcher.isRunning());
    }
}
