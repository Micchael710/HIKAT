package com.hikat.network;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class CanonicalFingerprintTest {

    @Test
    void testCanonicalSortingMatchesUnicodeCodeUnitOrder() {
        // Files with uppercase, lowercase, numbers, underscores, and dashes
        List<String> paths = new ArrayList<>(List.of(
                "mods/z-mod.jar",
                "mods/A_Mod.jar",
                "mods/10_mod.jar",
                "mods/a-mod.jar",
                "mods/a_mod.jar"
        ));

        // Java Collections.sort uses String.compareTo (Unicode code units)
        Collections.sort(paths);

        List<String> expectedOrder = List.of(
                "mods/10_mod.jar",
                "mods/A_Mod.jar",
                "mods/a-mod.jar",
                "mods/a_mod.jar",
                "mods/z-mod.jar"
        );

        assertEquals(expectedOrder, paths, "Java sort order must strictly match Unicode code units");
    }

    @Test
    void testCanonicalFingerprintComputation() throws Exception {
        Map<String, String> testFiles = Map.of(
                "mods/10_mod.jar", "0000000000000000000000000000000000000000000000000000000000000010",
                "mods/A_Mod.jar",  "000000000000000000000000000000000000000000000000000000000000000a",
                "mods/a-mod.jar",  "0000000000000000000000000000000000000000000000000000000000000001",
                "mods/a_mod.jar",  "0000000000000000000000000000000000000000000000000000000000000002",
                "mods/z-mod.jar",  "000000000000000000000000000000000000000000000000000000000000007a"
        );

        List<String> sortedPaths = new ArrayList<>(testFiles.keySet());
        Collections.sort(sortedPaths);

        StringBuilder canonical = new StringBuilder();
        for (String p : sortedPaths) {
            canonical.append(p).append(":").append(testFiles.get(p)).append("\n");
        }

        String expectedCanonical =
                "mods/10_mod.jar:0000000000000000000000000000000000000000000000000000000000000010\n" +
                "mods/A_Mod.jar:000000000000000000000000000000000000000000000000000000000000000a\n" +
                "mods/a-mod.jar:0000000000000000000000000000000000000000000000000000000000000001\n" +
                "mods/a_mod.jar:0000000000000000000000000000000000000000000000000000000000000002\n" +
                "mods/z-mod.jar:000000000000000000000000000000000000000000000000000000000000007a\n";

        assertEquals(expectedCanonical, canonical.toString());

        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] hash = md.digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : hash) {
            hex.append(String.format("%02x", b));
        }

        assertEquals(64, hex.length());
    }
}
