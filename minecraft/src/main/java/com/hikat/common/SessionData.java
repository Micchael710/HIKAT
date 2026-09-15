package com.hikat.common;

import com.google.gson.Gson;
import com.google.gson.JsonSyntaxException;
import java.util.Collections;
import java.util.List;

public record SessionData(
    int schemaVersion,
    String releaseId,
    String gameToken,
    List<String> protectedFiles,
    List<PolicyEntry> filePolicies,
    List<PolicyEntry> directoryPolicies
) {
    public record PolicyEntry(String path, String policy) {}

    private static final Gson GSON = new Gson();

    public static SessionData fromJson(String json) throws JsonSyntaxException {
        if (json == null || json.isBlank()) {
            throw new JsonSyntaxException("Session data is empty");
        }
        SessionData data = GSON.fromJson(json, SessionData.class);
        if (data == null || data.releaseId() == null || data.gameToken() == null) {
            throw new JsonSyntaxException("Invalid session payload: missing required fields");
        }
        return data;
    }

    public List<String> getSafeProtectedFiles() {
        return protectedFiles != null ? protectedFiles : Collections.emptyList();
    }

    public List<PolicyEntry> getSafeFilePolicies() {
        return filePolicies != null ? filePolicies : Collections.emptyList();
    }

    public List<PolicyEntry> getSafeDirectoryPolicies() {
        return directoryPolicies != null ? directoryPolicies : Collections.emptyList();
    }

    /**
     * Resolves the effective policy for any relative path:
     * 1. If the path matches a known manifest file, uses its received policy.
     * 2. For unknown/new files, finds the directoryPolicy of the most specific (longest matching) ancestor.
     * 3. Returns null (or non-protected) if no policy applies.
     */
    public String resolveEffectivePolicy(String relPath) {
        if (relPath == null || relPath.isBlank()) return null;
        String normPath = FingerprintUtil.normalizePath(relPath);

        // 1. Known manifest file policy match
        if (filePolicies != null) {
            for (PolicyEntry fp : filePolicies) {
                if (fp != null && fp.path() != null) {
                    if (FingerprintUtil.normalizePath(fp.path()).equals(normPath)) {
                        return fp.policy();
                    }
                }
            }
        }

        // Fallback: check protectedFiles list if filePolicies is empty/missing
        if (protectedFiles != null) {
            for (String p : protectedFiles) {
                if (p != null && FingerprintUtil.normalizePath(p).equals(normPath)) {
                    return "NO_MODIFICABLE";
                }
            }
        }

        // 2. Directory policy resolution (longest matching ancestor)
        if (directoryPolicies != null && !directoryPolicies.isEmpty()) {
            PolicyEntry bestMatch = null;
            int bestLen = -1;

            for (PolicyEntry dp : directoryPolicies) {
                if (dp == null || dp.path() == null) continue;
                String dirNorm = FingerprintUtil.normalizePath(dp.path());
                boolean matches;
                if (dirNorm.isEmpty()) {
                    matches = true;
                } else {
                    matches = normPath.startsWith(dirNorm + "/");
                }

                if (matches && dirNorm.length() > bestLen) {
                    bestMatch = dp;
                    bestLen = dirNorm.length();
                }
            }

            if (bestMatch != null) {
                return bestMatch.policy();
            }
        }

        return null;
    }
}
