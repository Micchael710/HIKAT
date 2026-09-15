package com.hikat.client;

import com.hikat.common.FingerprintUtil;
import com.hikat.common.SessionData;
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
    private final SessionData sessionData;
    private final Set<String> officialProtected;
    private final Map<String, String> currentHashes;
    private final String initialFingerprint;
    private String lastReportedFingerprint;
    private final Consumer<String> onFingerprintChanged;

    private WatchService watchService;
    private Thread watcherThread;
    private volatile boolean running = false;
    private final Map<WatchKey, Path> keyPathMap = new ConcurrentHashMap<>();

    public IntegrityWatcher(
        Path gameRoot,
        SessionData sessionData,
        Map<String, String> initialHashes,
        String initialFingerprint,
        Consumer<String> onFingerprintChanged
    ) {
        this.gameRoot = gameRoot;
        this.sessionData = sessionData;
        this.currentHashes = new HashMap<>(initialHashes);
        this.initialFingerprint = initialFingerprint;
        this.lastReportedFingerprint = initialFingerprint;
        this.onFingerprintChanged = onFingerprintChanged;

        this.officialProtected = new HashSet<>();
        if (sessionData != null) {
            if (sessionData.protectedFiles() != null) {
                for (String p : sessionData.protectedFiles()) {
                    if (p != null && !p.isBlank()) {
                        officialProtected.add(FingerprintUtil.normalizePath(p));
                    }
                }
            }
            if (sessionData.filePolicies() != null) {
                for (SessionData.PolicyEntry fp : sessionData.filePolicies()) {
                    if (fp != null && fp.path() != null && "NO_MODIFICABLE".equalsIgnoreCase(fp.policy())) {
                        officialProtected.add(FingerprintUtil.normalizePath(fp.path()));
                    }
                }
            }
        } else {
            this.officialProtected.addAll(initialHashes.keySet());
        }
    }

    public IntegrityWatcher(
        Path gameRoot,
        Map<String, String> initialHashes,
        String initialFingerprint,
        Consumer<String> onFingerprintChanged
    ) {
        this(gameRoot, null, initialHashes, initialFingerprint, onFingerprintChanged);
    }

    public synchronized void start() throws IOException {
        if (running) return;
        this.watchService = FileSystems.getDefault().newWatchService();
        this.running = true;

        Set<Path> dirsToWatch = new HashSet<>();
        for (String relPath : officialProtected) {
            Path target = gameRoot.resolve(relPath);
            Path parent = target.getParent();
            if (parent != null && Files.exists(parent)) {
                dirsToWatch.add(parent);
            }
        }

        if (sessionData != null && sessionData.directoryPolicies() != null) {
            for (SessionData.PolicyEntry dp : sessionData.directoryPolicies()) {
                if (dp == null || dp.path() == null) continue;
                String dirNorm = FingerprintUtil.normalizePath(dp.path());
                Path dir = dirNorm.isEmpty() ? gameRoot : gameRoot.resolve(dirNorm);
                if (Files.exists(dir) && Files.isDirectory(dir)) {
                    dirsToWatch.add(dir);
                    try (var stream = Files.walk(dir)) {
                        stream.filter(Files::isDirectory).forEach(dirsToWatch::add);
                    } catch (IOException ignored) {}
                }
            }
        }

        for (Path dir : dirsToWatch) {
            registerDirectory(dir);
        }

        watcherThread = new Thread(this::runWatcherLoop, "HiKAT-IntegrityWatcher");
        watcherThread.setDaemon(true);
        watcherThread.start();
    }

    private synchronized void registerDirectory(Path dir) {
        if (!running || watchService == null || !Files.isDirectory(dir)) return;
        try {
            WatchKey key = dir.register(
                watchService,
                StandardWatchEventKinds.ENTRY_CREATE,
                StandardWatchEventKinds.ENTRY_MODIFY,
                StandardWatchEventKinds.ENTRY_DELETE
            );
            keyPathMap.put(key, dir);
        } catch (IOException ignored) {}
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
            Set<Path> changedPaths = new HashSet<>();

            for (WatchEvent<?> event : key.pollEvents()) {
                if (event.kind() == StandardWatchEventKinds.OVERFLOW) {
                    hasOverflow = true;
                    continue;
                }

                @SuppressWarnings("unchecked")
                WatchEvent<Path> ev = (WatchEvent<Path>) event;
                Path filename = ev.context();
                Path fullPath = dir.resolve(filename);
                changedPaths.add(fullPath);

                // Register any new subdirectories
                if (event.kind() == StandardWatchEventKinds.ENTRY_CREATE && Files.isDirectory(fullPath)) {
                    registerDirectory(fullPath);
                    try (var stream = Files.walk(fullPath)) {
                        stream.filter(Files::isDirectory).forEach(this::registerDirectory);
                    } catch (IOException ignored) {}
                }
            }

            boolean valid = key.reset();
            if (!valid) {
                keyPathMap.remove(key);
            }

            if (!changedPaths.isEmpty() || hasOverflow) {
                try {
                    Thread.sleep(400); // 400ms debounce
                } catch (InterruptedException e) {
                    break;
                }

                synchronized (this) {
                    if (hasOverflow) {
                        rescanAll();
                    } else {
                        for (Path changed : changedPaths) {
                            if (Files.isDirectory(changed) && !Files.isSymbolicLink(changed)) {
                                try (var stream = Files.walk(changed)) {
                                    stream.filter(Files::isRegularFile).forEach(this::rehashFile);
                                } catch (IOException ignored) {}
                            } else {
                                rehashFile(changed);
                            }
                        }
                    }

                    String newFingerprint = FingerprintUtil.computeCanonicalFingerprint(currentHashes);
                    if (!newFingerprint.equals(lastReportedFingerprint)) {
                        lastReportedFingerprint = newFingerprint;
                        if (onFingerprintChanged != null) {
                            onFingerprintChanged.accept(newFingerprint);
                        }
                    }
                }
            }
        }
    }

    private void rehashFile(Path file) {
        String rel = null;
        try {
            rel = FingerprintUtil.normalizePath(gameRoot.relativize(file).toString());
            if (rel.isEmpty()) {
                return;
            }

            boolean isOfficial = officialProtected.contains(rel);

            if (isOfficial) {
                if (Files.isRegularFile(file) && FingerprintUtil.isSafePath(gameRoot, rel)) {
                    currentHashes.put(rel, FingerprintUtil.sha256Hex(file));
                } else {
                    currentHashes.put(rel, "MISSING");
                }
            } else {
                // Unknown / Extra file
                String policy = sessionData != null ? sessionData.resolveEffectivePolicy(rel) : null;
                if ("NO_MODIFICABLE".equalsIgnoreCase(policy)) {
                    if (Files.isRegularFile(file) && FingerprintUtil.isSafePath(gameRoot, rel)) {
                        currentHashes.put(rel, FingerprintUtil.sha256Hex(file));
                    } else if (!FingerprintUtil.isSafePath(gameRoot, rel)) {
                        currentHashes.put(rel, "ERROR");
                    } else {
                        currentHashes.remove(rel);
                    }
                } else {
                    currentHashes.remove(rel);
                }
            }
        } catch (Exception e) {
            if (rel != null) {
                if (officialProtected.contains(rel)) {
                    currentHashes.put(rel, "ERROR");
                } else {
                    String policy = sessionData != null ? sessionData.resolveEffectivePolicy(rel) : null;
                    if ("NO_MODIFICABLE".equalsIgnoreCase(policy)) {
                        currentHashes.put(rel, "ERROR");
                    }
                }
            }
        }
    }

    private void rescanAll() {
        // 1. Re-check official protected files
        for (String rel : officialProtected) {
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

        // 2. Remove extra files that no longer exist
        for (String rel : new HashSet<>(currentHashes.keySet())) {
            if (!officialProtected.contains(rel)) {
                Path file = gameRoot.resolve(rel);
                if (!Files.exists(file)) {
                    currentHashes.remove(rel);
                }
            }
        }

        // 3. Re-scan directoryPolicies for any extra files
        if (sessionData != null && sessionData.directoryPolicies() != null) {
            for (SessionData.PolicyEntry dp : sessionData.directoryPolicies()) {
                if (dp == null || dp.path() == null) continue;
                String dirNorm = FingerprintUtil.normalizePath(dp.path());
                Path dirPath = dirNorm.isEmpty() ? gameRoot : gameRoot.resolve(dirNorm);
                if (Files.exists(dirPath) && Files.isDirectory(dirPath)) {
                    try (var stream = Files.walk(dirPath)) {
                        stream.filter(Files::isRegularFile).forEach(file -> {
                            String rel = FingerprintUtil.normalizePath(gameRoot.relativize(file).toString());
                            if (!officialProtected.contains(rel) && FingerprintUtil.isSafePath(gameRoot, rel)) {
                                String policy = sessionData.resolveEffectivePolicy(rel);
                                if ("NO_MODIFICABLE".equalsIgnoreCase(policy)) {
                                    try {
                                        currentHashes.put(rel, FingerprintUtil.sha256Hex(file));
                                    } catch (IOException e) {
                                        currentHashes.put(rel, "ERROR");
                                    }
                                }
                            }
                        });
                    } catch (IOException ignored) {}
                }
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

    public Map<String, String> getCurrentHashes() {
        return new HashMap<>(currentHashes);
    }
}
