package com.hikat.client.integrity;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.neoforged.fml.loading.FMLPaths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

public class ClientIntegrityService {
    private static final Logger LOGGER = LoggerFactory.getLogger(ClientIntegrityService.class);

    public enum IntegrityState {
        VALID,
        PENDING,
        INVALID
    }

    private static ClientIntegrityService instance;

    private final Path gameDir;
    private final AtomicReference<IntegrityState> state = new AtomicReference<>(IntegrityState.INVALID);
    private final AtomicBoolean watcherFailed = new AtomicBoolean(false);
    private final AtomicInteger pendingTransitions = new AtomicInteger(0);
    private String releaseVersion = "0.0.0";
    private String integrityFingerprint = "INIT";

    private final Map<String, String> currentHashMap = new ConcurrentHashMap<>();
    private final Set<String> expectedProtectedPaths = Collections.newSetFromMap(new ConcurrentHashMap<>());
    private final Set<String> protectedDirectories = Collections.newSetFromMap(new ConcurrentHashMap<>());
    private final Map<String, String> explicitDirectoryPolicies = new ConcurrentHashMap<>();
    private final Map<String, String> explicitFilePolicies = new ConcurrentHashMap<>();

    private WatchService watchService;
    private Thread watcherThread;
    private final Map<WatchKey, Path> watchKeyPaths = new ConcurrentHashMap<>();

    public static synchronized ClientIntegrityService getInstance() {
        if (instance == null) {
            instance = new ClientIntegrityService(FMLPaths.GAMEDIR.get());
        }
        return instance;
    }

    public static synchronized ClientIntegrityService getInstance(Path gameDir) {
        if (instance == null) {
            instance = new ClientIntegrityService(gameDir);
        }
        return instance;
    }

    public ClientIntegrityService(Path gameDir) {
        this.gameDir = gameDir;
        loadAndInitialize();
    }

    public IntegrityState getState() {
        return state.get();
    }

    public int getPendingTransitions() {
        return pendingTransitions.get();
    }

    public String getFingerprint() {
        return integrityFingerprint;
    }

    public String getReleaseVersion() {
        return releaseVersion;
    }

    public Map<String, String> getCurrentHashMap() {
        return Collections.unmodifiableMap(currentHashMap);
    }

    public synchronized void loadAndInitialize() {
        watcherFailed.set(false);
        currentHashMap.clear();
        expectedProtectedPaths.clear();
        protectedDirectories.clear();
        explicitDirectoryPolicies.clear();
        explicitFilePolicies.clear();

        Path hikatManifest = gameDir.resolve(".hikat").resolve("installed-manifest.json");
        Path rootManifest = gameDir.resolve("installed-manifest.json");
        Path manifestFile;
        if (Files.exists(hikatManifest)) {
            manifestFile = hikatManifest;
        } else if (Files.exists(rootManifest)) {
            manifestFile = rootManifest;
        } else {
            LOGGER.warn("[HiKAT] installed-manifest.json not found in .hikat/ or root of {}", gameDir);
            state.set(IntegrityState.INVALID);
            integrityFingerprint = "MANIFEST_NOT_FOUND";
            return;
        }

        try {
            String jsonContent = Files.readString(manifestFile);
            JsonObject manifest = JsonParser.parseString(jsonContent).getAsJsonObject();

            if (manifest.has("modpackVersion") && !manifest.get("modpackVersion").isJsonNull()) {
                releaseVersion = manifest.get("modpackVersion").getAsString().trim();
            } else if (manifest.has("version") && !manifest.get("version").isJsonNull()) {
                releaseVersion = manifest.get("version").getAsString().trim();
            }

            // 1. Directory policies
            if (manifest.has("directoryPolicies") && manifest.get("directoryPolicies").isJsonArray()) {
                JsonArray dirArr = manifest.getAsJsonArray("directoryPolicies");
                for (JsonElement el : dirArr) {
                    if (el.isJsonObject()) {
                        JsonObject obj = el.getAsJsonObject();
                        String dPath = obj.has("path") ? obj.get("path").getAsString() : "";
                        String dPol = obj.has("policy") ? obj.get("policy").getAsString() : "";
                        String norm = normalizePath(dPath);
                        if (!norm.isEmpty()) {
                            explicitDirectoryPolicies.put(norm, dPol);
                            if ("NO_MODIFICABLE".equalsIgnoreCase(dPol)) {
                                protectedDirectories.add(norm);
                            }
                        }
                    }
                }
            }

            // Always treat mods as protected directory unless explicitly configured otherwise
            if (!explicitDirectoryPolicies.containsKey("mods")) {
                protectedDirectories.add("mods");
            }

            // 2. Parse file entries and register explicit file policies
            if (manifest.has("files") && manifest.get("files").isJsonObject()) {
                JsonObject filesObj = manifest.getAsJsonObject("files");
                for (Map.Entry<String, JsonElement> entry : filesObj.entrySet()) {
                    String normPath = normalizePath(entry.getKey());
                    if (entry.getValue().isJsonObject()) {
                        JsonObject fileData = entry.getValue().getAsJsonObject();
                        String explicitPol = fileData.has("policy") && !fileData.get("policy").isJsonNull()
                                ? fileData.get("policy").getAsString()
                                : null;
                        if (explicitPol != null && !explicitPol.isBlank()) {
                            explicitFilePolicies.put(normPath, explicitPol.toUpperCase());
                        }
                        String effective = resolveEffectivePolicy(normPath, explicitPol);
                        if ("NO_MODIFICABLE".equalsIgnoreCase(effective)) {
                            expectedProtectedPaths.add(normPath);
                            int slashIdx = normPath.lastIndexOf('/');
                            if (slashIdx > 0) {
                                protectedDirectories.add(normPath.substring(0, slashIdx));
                            }
                        }
                    }
                }
            }

            // 3. Scan disk for expected files
            for (String p : expectedProtectedPaths) {
                Path fullPath = gameDir.resolve(p);
                if (Files.isRegularFile(fullPath)) {
                    String sha = computeFileSha256(fullPath);
                    if (sha != null) {
                        currentHashMap.put(p, sha.toLowerCase());
                    } else {
                        currentHashMap.put(p, "CORRUPT");
                    }
                } else {
                    currentHashMap.put(p, "MISSING");
                }
            }

            // 4. Detect extra files in protected directories (recursive walk)
            for (String dirRel : protectedDirectories) {
                Path dirPath = gameDir.resolve(dirRel);
                if (Files.isDirectory(dirPath)) {
                    try (Stream<Path> stream = Files.walk(dirPath)) {
                        stream.filter(Files::isRegularFile).forEach(file -> {
                            String rel = normalizePath(gameDir.relativize(file).toString());
                            String effective = resolveEffectivePolicy(rel, null);
                            if ("NO_MODIFICABLE".equalsIgnoreCase(effective)) {
                                if (!currentHashMap.containsKey(rel)) {
                                    String sha = computeFileSha256(file);
                                    if (sha != null) {
                                        currentHashMap.put(rel, sha.toLowerCase());
                                    }
                                }
                            }
                        });
                    } catch (Exception e) {
                        LOGGER.warn("[HiKAT] Error walking protected directory {}: {}", dirRel, e.getMessage());
                    }
                }
            }

            // 5. Generate initial deterministic fingerprint
            recalculateFingerprint();
            state.set(IntegrityState.VALID);

            // 6. Setup dynamic filesystem watcher (recursive, fail-closed)
            startWatcher();
        } catch (Exception e) {
            LOGGER.error("[HiKAT] Failed to initialize client integrity service: {}", e.getMessage(), e);
            state.set(IntegrityState.INVALID);
            integrityFingerprint = "INIT_ERROR";
        }
    }

    private void recalculateFingerprint() {
        try {
            List<String> sortedPaths = new ArrayList<>(currentHashMap.keySet());
            Collections.sort(sortedPaths); // Unicode code-unit lexicographical ordering

            StringBuilder canonical = new StringBuilder();
            for (String path : sortedPaths) {
                canonical.append(path).append(":").append(currentHashMap.get(path)).append("\n");
            }

            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) {
                hex.append(String.format("%02x", b));
            }
            this.integrityFingerprint = hex.toString();
        } catch (Exception e) {
            LOGGER.error("[HiKAT] Failed to calculate fingerprint: {}", e.getMessage());
            this.integrityFingerprint = "CALC_ERROR";
        }
    }

    private void startWatcher() {
        stopWatcher();
        try {
            watchService = FileSystems.getDefault().newWatchService();
            watchKeyPaths.clear();

            boolean allRegistered = true;
            for (String dirRel : protectedDirectories) {
                Path dirPath = gameDir.resolve(dirRel);
                if (Files.isDirectory(dirPath)) {
                    boolean ok = registerTree(dirPath);
                    if (!ok) {
                        allRegistered = false;
                    }
                }
            }

            if (!allRegistered) {
                LOGGER.error("[HiKAT] Fail-closed: Could not register all protected directories for dynamic integrity");
                watcherFailed.set(true);
                state.set(IntegrityState.INVALID);
            }

            watcherThread = new Thread(this::watchLoop, "HiKAT-IntegrityWatcher");
            watcherThread.setDaemon(true);
            watcherThread.start();
        } catch (Exception e) {
            LOGGER.error("[HiKAT] Fail-closed: Could not start WatchService: {}", e.getMessage());
            watcherFailed.set(true);
            state.set(IntegrityState.INVALID);
        }
    }

    public boolean registerTree(Path startDir) {
        if (!Files.isDirectory(startDir)) return true;
        if (watchService == null) {
            watcherFailed.set(true);
            state.set(IntegrityState.INVALID);
            return false;
        }
        final boolean[] success = {true};
        try {
            Files.walkFileTree(startDir, new SimpleFileVisitor<Path>() {
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                    try {
                        WatchKey key = dir.register(
                                watchService,
                                StandardWatchEventKinds.ENTRY_CREATE,
                                StandardWatchEventKinds.ENTRY_DELETE,
                                StandardWatchEventKinds.ENTRY_MODIFY
                        );
                        watchKeyPaths.put(key, dir);
                    } catch (Exception e) {
                        LOGGER.warn("[HiKAT] Could not register directory {}: {}", dir, e.getMessage());
                        success[0] = false;
                    }
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (Exception e) {
            LOGGER.warn("[HiKAT] Error walking directory tree {}: {}", startDir, e.getMessage());
            success[0] = false;
        }
        if (!success[0]) {
            watcherFailed.set(true);
            state.set(IntegrityState.INVALID);
        }
        return success[0];
    }

    private void watchLoop() {
        while (!Thread.currentThread().isInterrupted() && watchService != null) {
            WatchKey key;
            try {
                key = watchService.take();
            } catch (InterruptedException | ClosedWatchServiceException e) {
                break;
            }

            handleWatchKey(key);
        }
    }

    void handleWatchKey(WatchKey key) {
        Path parentDir = watchKeyPaths.get(key);
        if (parentDir == null) {
            boolean valid = key.reset();
            if (!valid) {
                watcherFailed.set(true);
                state.set(IntegrityState.INVALID);
            }
            return;
        }

        boolean integrityAffected = false;

        for (WatchEvent<?> event : key.pollEvents()) {
            WatchEvent.Kind<?> kind = event.kind();

            // Handle OVERFLOW: reconcile protected tree
            if (kind == StandardWatchEventKinds.OVERFLOW) {
                markPending();
                boolean ok = reconcileTree(parentDir);
                if (!ok) {
                    watcherFailed.set(true);
                    state.set(IntegrityState.INVALID);
                }
                integrityAffected = true;
                continue;
            }

            @SuppressWarnings("unchecked")
            WatchEvent<Path> ev = (WatchEvent<Path>) event;
            Path filename = ev.context();
            Path fullPath = parentDir.resolve(filename);
            String relPath = normalizePath(gameDir.relativize(fullPath).toString());

            String effective = resolveEffectivePolicy(relPath, null);
            if (!"NO_MODIFICABLE".equalsIgnoreCase(effective)) {
                continue;
            }

            // 1. Mark immediately as PENDING during rehash/mutation (unless already permanently INVALID)
            markPending();
            integrityAffected = true;

            if (kind == StandardWatchEventKinds.ENTRY_DELETE) {
                // Check if a directory was deleted
                boolean wasDir = false;
                String dirPrefix = relPath + "/";
                List<String> removedPaths = new ArrayList<>();
                for (String existing : currentHashMap.keySet()) {
                    if (existing.startsWith(dirPrefix)) {
                        removedPaths.add(existing);
                        wasDir = true;
                    }
                }

                if (wasDir) {
                    for (String r : removedPaths) {
                        currentHashMap.put(r, "DELETED_DIR");
                    }
                    LOGGER.info("[HiKAT] Integrity change: Protected directory deleted: {}", relPath);
                } else {
                    if (expectedProtectedPaths.contains(relPath)) {
                        currentHashMap.put(relPath, "MISSING");
                    } else {
                        currentHashMap.remove(relPath);
                    }
                    LOGGER.info("[HiKAT] Integrity change: Deleted protected file: {}", relPath);
                }
            } else if (kind == StandardWatchEventKinds.ENTRY_CREATE) {
                if (Files.isDirectory(fullPath)) {
                    // Recursively register the new directory tree and hash files
                    LOGGER.info("[HiKAT] Integrity change: Protected subdirectory created: {}", relPath);
                    boolean ok = registerTree(fullPath);
                    if (!ok) {
                        watcherFailed.set(true);
                        state.set(IntegrityState.INVALID);
                    }
                    try (Stream<Path> s = Files.walk(fullPath)) {
                        s.filter(Files::isRegularFile).forEach(subFile -> {
                            String subRel = normalizePath(gameDir.relativize(subFile).toString());
                            if ("NO_MODIFICABLE".equalsIgnoreCase(resolveEffectivePolicy(subRel, null))) {
                                String sha = computeFileSha256(subFile);
                                if (sha != null) {
                                    currentHashMap.put(subRel, sha.toLowerCase());
                                }
                            }
                        });
                    } catch (Exception e) {
                        LOGGER.warn("[HiKAT] Error walking newly created directory: {}", e.getMessage());
                    }
                } else if (Files.isRegularFile(fullPath)) {
                    waitForFileReady(fullPath);
                    String sha = computeFileSha256(fullPath);
                    if (sha != null) {
                        currentHashMap.put(relPath, sha.toLowerCase());
                        LOGGER.info("[HiKAT] Integrity change: Created protected file: {}", relPath);
                    }
                }
            } else if (kind == StandardWatchEventKinds.ENTRY_MODIFY) {
                if (Files.isRegularFile(fullPath)) {
                    waitForFileReady(fullPath);
                    String sha = computeFileSha256(fullPath);
                    if (sha != null) {
                        currentHashMap.put(relPath, sha.toLowerCase());
                        LOGGER.info("[HiKAT] Integrity change: Modified protected file: {}", relPath);
                    }
                }
            }
        }

        if (integrityAffected) {
            recalculateFingerprint();
            // Return to VALID only after rehash finishes AND watcher has not failed
            if (!watcherFailed.get()) {
                state.set(IntegrityState.VALID);
            } else {
                state.set(IntegrityState.INVALID);
            }
        }

        boolean valid = key.reset();
        if (!valid) {
            watchKeyPaths.remove(key);
            watcherFailed.set(true);
            state.set(IntegrityState.INVALID);
            LOGGER.warn("[HiKAT] Fail-closed: WatchKey became invalid for directory: {}", parentDir);
        }
    }

    private boolean reconcileTree(Path rootDir) {
        if (!Files.exists(rootDir)) {
            String dirRel = normalizePath(gameDir.relativize(rootDir).toString());
            String dirPrefix = dirRel + "/";
            for (String k : new ArrayList<>(currentHashMap.keySet())) {
                if (k.startsWith(dirPrefix)) {
                    currentHashMap.put(k, "MISSING");
                }
            }
            return true;
        }

        try (Stream<Path> stream = Files.walk(rootDir)) {
            Set<String> onDisk = new HashSet<>();
            stream.filter(Files::isRegularFile).forEach(file -> {
                String rel = normalizePath(gameDir.relativize(file).toString());
                if ("NO_MODIFICABLE".equalsIgnoreCase(resolveEffectivePolicy(rel, null))) {
                    onDisk.add(rel);
                    String sha = computeFileSha256(file);
                    if (sha != null) {
                        currentHashMap.put(rel, sha.toLowerCase());
                    }
                }
            });

            String dirRel = normalizePath(gameDir.relativize(rootDir).toString());
            String dirPrefix = dirRel.isEmpty() ? "" : dirRel + "/";
            for (String existing : new ArrayList<>(currentHashMap.keySet())) {
                if (existing.startsWith(dirPrefix) && !onDisk.contains(existing)) {
                    if (expectedProtectedPaths.contains(existing)) {
                        currentHashMap.put(existing, "MISSING");
                    } else {
                        currentHashMap.remove(existing);
                    }
                }
            }
            return true;
        } catch (Exception e) {
            LOGGER.warn("[HiKAT] Failed to reconcile tree {}: {}", rootDir, e.getMessage());
            watcherFailed.set(true);
            state.set(IntegrityState.INVALID);
            return false;
        }
    }

    private void markPending() {
        if (!watcherFailed.get()) {
            state.set(IntegrityState.PENDING);
        }
        pendingTransitions.incrementAndGet();
    }

    public boolean isWatcherFailed() {
        return watcherFailed.get();
    }

    Map<WatchKey, Path> getWatchKeyPaths() {
        return Collections.unmodifiableMap(watchKeyPaths);
    }

    private void waitForFileReady(Path file) {
        for (int i = 0; i < 10; i++) {
            try (InputStream is = Files.newInputStream(file)) {
                if (is.read() != -1 || Files.size(file) == 0) {
                    return;
                }
            } catch (Exception ignored) {
                try {
                    Thread.sleep(10);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    public synchronized void stopWatcher() {
        if (watchService != null) {
            try {
                watchService.close();
            } catch (Exception ignored) {}
            watchService = null;
        }
        if (watcherThread != null) {
            watcherThread.interrupt();
            watcherThread = null;
        }
        watchKeyPaths.clear();
    }

    public String resolveEffectivePolicy(String logicalPath, String explicitPolicy) {
        if ("NO_MODIFICABLE".equalsIgnoreCase(explicitPolicy) || "MODIFICABLE".equalsIgnoreCase(explicitPolicy)) {
            return explicitPolicy.toUpperCase();
        }

        String normalized = normalizePath(logicalPath);

        // 1. Explicit file policy from manifest
        String fileOverride = explicitFilePolicies.get(normalized);
        if (fileOverride != null) {
            return fileOverride;
        }

        // 2. Closest parent directory policy
        String[] segments = normalized.split("/");
        if (segments.length > 1) {
            for (int i = segments.length - 1; i >= 1; i--) {
                StringBuilder parent = new StringBuilder();
                for (int j = 0; j < i; j++) {
                    if (j > 0) parent.append("/");
                    parent.append(segments[j]);
                }
                String pol = explicitDirectoryPolicies.get(parent.toString());
                if (pol != null && !pol.isEmpty()) {
                    return pol.toUpperCase();
                }
            }
        }

        // 3. Fallback policies
        String root = segments.length > 0 ? segments[0].toLowerCase() : "";
        if ("mods".equals(root) || "datapacks".equals(root)) {
            return "NO_MODIFICABLE";
        }
        if ("config".equals(root) || "defaultconfigs".equals(root) || "resourcepacks".equals(root)
                || "shaderpacks".equals(root) || "options.txt".equalsIgnoreCase(normalized)) {
            return "MODIFICABLE";
        }

        return "NO_MODIFICABLE";
    }

    public static String computeFileSha256(Path file) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream is = Files.newInputStream(file)) {
                byte[] buf = new byte[8192];
                int read;
                while ((read = is.read(buf)) != -1) {
                    md.update(buf, 0, read);
                }
            }
            byte[] digest = md.digest();
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private static String normalizePath(String path) {
        if (path == null) return "";
        return path.replace('\\', '/').replaceAll("^/+", "").replaceAll("/+$", "").replaceAll("/+", "/").trim();
    }
}
