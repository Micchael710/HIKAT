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
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentSkipListSet;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

public class ClientIntegrityService {
    private static final Logger LOGGER = LoggerFactory.getLogger(ClientIntegrityService.class);
    private static ClientIntegrityService INSTANCE;

    public enum IntegrityState {
        VALID,
        PENDING,
        INVALID
    }

    private final Path gameDir;
    private final AtomicReference<IntegrityState> state = new AtomicReference<>(IntegrityState.PENDING);
    private final ConcurrentHashMap<String, String> currentHashMap = new ConcurrentHashMap<>();
    private final Set<String> expectedProtectedPaths = new ConcurrentSkipListSet<>();
    private final Set<String> protectedDirectories = new ConcurrentSkipListSet<>();
    private final Map<String, String> explicitDirectoryPolicies = new ConcurrentHashMap<>();

    private volatile String releaseVersion = "0.0.0";
    private volatile String integrityFingerprint = "";
    private WatchService watchService;
    private Thread watcherThread;
    private final Map<WatchKey, Path> watchKeyPaths = new ConcurrentHashMap<>();

    public static synchronized ClientIntegrityService getInstance() {
        if (INSTANCE == null) {
            INSTANCE = new ClientIntegrityService(FMLPaths.GAMEDIR.get());
        }
        return INSTANCE;
    }

    public ClientIntegrityService(Path gameDir) {
        this.gameDir = gameDir;
        initialize();
    }

    public synchronized void initialize() {
        state.set(IntegrityState.PENDING);
        currentHashMap.clear();
        expectedProtectedPaths.clear();
        protectedDirectories.clear();
        explicitDirectoryPolicies.clear();

        Path manifestPath = gameDir.resolve(".hikat").resolve("installed-manifest.json");
        if (!Files.exists(manifestPath)) {
            // Check fallback
            manifestPath = gameDir.resolve("installed-manifest.json");
        }

        if (!Files.exists(manifestPath)) {
            LOGGER.warn("[HiKAT] installed-manifest.json not found in {}", gameDir);
            state.set(IntegrityState.INVALID);
            integrityFingerprint = "MANIFEST_NOT_FOUND";
            return;
        }

        try {
            String jsonContent = Files.readString(manifestPath, StandardCharsets.UTF_8);
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

            // 2. Parse file entries
            if (manifest.has("files") && manifest.get("files").isJsonObject()) {
                JsonObject filesObj = manifest.getAsJsonObject("files");
                for (Map.Entry<String, JsonElement> entry : filesObj.entrySet()) {
                    String normPath = normalizePath(entry.getKey());
                    if (entry.getValue().isJsonObject()) {
                        JsonObject fileData = entry.getValue().getAsJsonObject();
                        String explicitPol = fileData.has("policy") && !fileData.get("policy").isJsonNull()
                                ? fileData.get("policy").getAsString()
                                : null;
                        String effective = resolveEffectivePolicy(normPath, explicitPol);
                        if ("NO_MODIFICABLE".equalsIgnoreCase(effective)) {
                            expectedProtectedPaths.add(normPath);
                            // Track parent directory as protected
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

            // 4. Detect extra files in protected directories (e.g. unauthorized mods)
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

            // 6. Setup dynamic filesystem watcher
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
            Collections.sort(sortedPaths);

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

            for (String dirRel : protectedDirectories) {
                Path dirPath = gameDir.resolve(dirRel);
                if (Files.isDirectory(dirPath)) {
                    WatchKey key = dirPath.register(
                            watchService,
                            StandardWatchEventKinds.ENTRY_CREATE,
                            StandardWatchEventKinds.ENTRY_DELETE,
                            StandardWatchEventKinds.ENTRY_MODIFY
                    );
                    watchKeyPaths.put(key, dirPath);
                }
            }

            watcherThread = new Thread(this::watchLoop, "HiKAT-IntegrityWatcher");
            watcherThread.setDaemon(true);
            watcherThread.start();
        } catch (Exception e) {
            LOGGER.warn("[HiKAT] Could not start WatchService: {}", e.getMessage());
        }
    }

    private void watchLoop() {
        while (!Thread.currentThread().isInterrupted() && watchService != null) {
            WatchKey key;
            try {
                key = watchService.take();
            } catch (InterruptedException | ClosedWatchServiceException e) {
                break;
            }

            Path parentDir = watchKeyPaths.get(key);
            if (parentDir == null) {
                key.reset();
                continue;
            }

            boolean integrityAffected = false;

            for (WatchEvent<?> event : key.pollEvents()) {
                WatchEvent.Kind<?> kind = event.kind();
                if (kind == StandardWatchEventKinds.OVERFLOW) {
                    continue;
                }

                @SuppressWarnings("unchecked")
                WatchEvent<Path> ev = (WatchEvent<Path>) event;
                Path filename = ev.context();
                Path fullPath = parentDir.resolve(filename);
                String relPath = normalizePath(gameDir.relativize(fullPath).toString());

                String effective = resolveEffectivePolicy(relPath, null);
                if (!"NO_MODIFICABLE".equalsIgnoreCase(effective)) {
                    // MODIFICABLE files do NOT alter fingerprint or trigger PENDING
                    continue;
                }

                // 1. Mark immediately as PENDING during rehash
                state.set(IntegrityState.PENDING);
                integrityAffected = true;

                if (kind == StandardWatchEventKinds.ENTRY_DELETE) {
                    if (expectedProtectedPaths.contains(relPath)) {
                        currentHashMap.put(relPath, "MISSING");
                    } else {
                        currentHashMap.remove(relPath);
                    }
                } else {
                    // ENTRY_CREATE or ENTRY_MODIFY: rehash only affected file
                    try {
                        Thread.sleep(10); // Allow OS write flush
                    } catch (InterruptedException ignored) {}

                    if (Files.isRegularFile(fullPath)) {
                        String newSha = computeFileSha256(fullPath);
                        if (newSha != null) {
                            currentHashMap.put(relPath, newSha.toLowerCase());
                        } else {
                            currentHashMap.put(relPath, "READ_ERROR");
                        }
                    } else if (!Files.exists(fullPath)) {
                        if (expectedProtectedPaths.contains(relPath)) {
                            currentHashMap.put(relPath, "MISSING");
                        } else {
                            currentHashMap.remove(relPath);
                        }
                    }
                }
            }

            if (integrityAffected) {
                // Recompute global fingerprint from updated in-memory map
                recalculateFingerprint();
                state.set(IntegrityState.VALID);
            }

            boolean valid = key.reset();
            if (!valid) {
                watchKeyPaths.remove(key);
            }
        }
    }

    public synchronized void stopWatcher() {
        if (watcherThread != null) {
            watcherThread.interrupt();
            watcherThread = null;
        }
        if (watchService != null) {
            try {
                watchService.close();
            } catch (Exception ignored) {}
            watchService = null;
        }
        watchKeyPaths.clear();
    }

    public String resolveEffectivePolicy(String logicalPath, String explicitPolicy) {
        if ("NO_MODIFICABLE".equalsIgnoreCase(explicitPolicy) || "MODIFICABLE".equalsIgnoreCase(explicitPolicy)) {
            return explicitPolicy.toUpperCase();
        }

        String normalized = normalizePath(logicalPath);
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

    public static String normalizePath(String path) {
        if (path == null) return "";
        return path.trim().replace('\\', '/').replaceAll("^/+|/+$", "");
    }

    public String getFingerprint() {
        return integrityFingerprint;
    }

    public IntegrityState getState() {
        return state.get();
    }

    public String getReleaseVersion() {
        return releaseVersion;
    }

    public Map<String, String> getCurrentHashMap() {
        return Collections.unmodifiableMap(currentHashMap);
    }
}
