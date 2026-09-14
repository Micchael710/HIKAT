package com.hikat.client;

import com.hikat.common.FingerprintUtil;
import java.io.IOException;
import java.nio.file.ClosedWatchServiceException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardWatchEventKinds;
import java.nio.file.WatchEvent;
import java.nio.file.WatchKey;
import java.nio.file.WatchService;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

public class IntegrityWatcher {
    private final Path gameRoot;
    private final Map<String, String> currentHashes;
    private final String initialFingerprint;
    private final Consumer<String> onFingerprintChanged;

    private WatchService watchService;
    private Thread watcherThread;
    private volatile boolean running = false;
    private final Map<WatchKey, Path> keyPathMap = new ConcurrentHashMap<>();

    public IntegrityWatcher(
        Path gameRoot,
        Map<String, String> initialHashes,
        String initialFingerprint,
        Consumer<String> onFingerprintChanged
    ) {
        this.gameRoot = gameRoot;
        this.currentHashes = new HashMap<>(initialHashes);
        this.initialFingerprint = initialFingerprint;
        this.onFingerprintChanged = onFingerprintChanged;
    }

    public synchronized void start() throws IOException {
        if (running) return;
        this.watchService = FileSystems.getDefault().newWatchService();
        this.running = true;

        Set<Path> parentDirs = new HashSet<>();
        for (String relPath : currentHashes.keySet()) {
            Path target = gameRoot.resolve(relPath);
            Path parent = target.getParent();
            if (parent != null && Files.exists(parent)) {
                parentDirs.add(parent);
            }
        }

        for (Path dir : parentDirs) {
            WatchKey key = dir.register(
                watchService,
                StandardWatchEventKinds.ENTRY_CREATE,
                StandardWatchEventKinds.ENTRY_MODIFY,
                StandardWatchEventKinds.ENTRY_DELETE
            );
            keyPathMap.put(key, dir);
        }

        watcherThread = new Thread(this::runWatcherLoop, "HiKAT-IntegrityWatcher");
        watcherThread.setDaemon(true);
        watcherThread.start();
    }

    private void runWatcherLoop() {
        while (running) {
            WatchKey key;
            try {
                key = watchService.take();
            } catch (InterruptedException | ClosedWatchServiceException e) {
                break;
            }

            Path dir = keyPathMap.get(key);
            if (dir == null) {
                key.reset();
                continue;
            }

            boolean hasOverflow = false;
            Set<Path> changedFiles = new HashSet<>();

            for (WatchEvent<?> event : key.pollEvents()) {
                if (event.kind() == StandardWatchEventKinds.OVERFLOW) {
                    hasOverflow = true;
                    continue;
                }

                @SuppressWarnings("unchecked")
                WatchEvent<Path> ev = (WatchEvent<Path>) event;
                Path filename = ev.context();
                changedFiles.add(dir.resolve(filename));
            }

            boolean valid = key.reset();
            if (!valid) {
                keyPathMap.remove(key);
            }

            if (!changedFiles.isEmpty() || hasOverflow) {
                try {
                    Thread.sleep(400); // 400ms debounce
                } catch (InterruptedException e) {
                    break;
                }

                synchronized (this) {
                    if (hasOverflow) {
                        rescanAll();
                    } else {
                        for (Path changed : changedFiles) {
                            rehashFile(changed);
                        }
                    }

                    String newFingerprint = FingerprintUtil.computeCanonicalFingerprint(currentHashes);
                    if (!newFingerprint.equals(initialFingerprint)) {
                        if (onFingerprintChanged != null) {
                            onFingerprintChanged.accept(newFingerprint);
                        }
                    }
                }
            }
        }
    }

    private void rehashFile(Path file) {
        try {
            String rel = FingerprintUtil.normalizePath(gameRoot.relativize(file).toString());
            if (currentHashes.containsKey(rel)) {
                if (Files.isRegularFile(file) && FingerprintUtil.isSafePath(gameRoot, rel)) {
                    currentHashes.put(rel, FingerprintUtil.sha256Hex(file));
                } else {
                    currentHashes.put(rel, "MISSING");
                }
            }
        } catch (Exception ignored) {}
    }

    private void rescanAll() {
        for (String rel : new HashSet<>(currentHashes.keySet())) {
            Path file = gameRoot.resolve(rel);
            try {
                if (Files.isRegularFile(file) && FingerprintUtil.isSafePath(gameRoot, rel)) {
                    currentHashes.put(rel, FingerprintUtil.sha256Hex(file));
                } else {
                    currentHashes.put(rel, "MISSING");
                }
            } catch (Exception e) {
                currentHashes.put(rel, "ERROR");
            }
        }
    }

    public synchronized void stop() {
        running = false;
        if (watchService != null) {
            try {
                watchService.close();
            } catch (IOException ignored) {}
        }
        if (watcherThread != null) {
            watcherThread.interrupt();
        }
    }

    public boolean isRunning() {
        return running;
    }
}
