package com.hikat;

import com.hikat.server.HiKatWhitelist;
import java.io.IOException;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

public class HiKatWhitelistTest {

    @Test
    public void testWhitelistOperationsAndPersistence(@TempDir Path tempDir) throws IOException {
        HiKatWhitelist whitelist = new HiKatWhitelist(tempDir);

        // By default, whitelist is disabled -> all players allowed
        assertFalse(whitelist.isEnabled());
        assertTrue(whitelist.isAllowed("usr_anyone", "Anyone"));

        // Enable whitelist
        whitelist.setEnabled(true);
        assertTrue(whitelist.isEnabled());
        assertFalse(whitelist.isAllowed("usr_anyone", "Anyone"));

        // Add player by name only
        boolean added = whitelist.add("vbrayan06");
        assertTrue(added);

        // Case-insensitive duplicate rejected
        assertFalse(whitelist.add("VBRAYAN06"));
        assertFalse(whitelist.add("vBrayan06"));

        // Case-insensitive check works for allowed
        assertTrue(whitelist.isAllowed(null, "vbrayan06"));
        assertTrue(whitelist.isAllowed(null, "VBRAYAN06"));
        assertTrue(whitelist.isAllowed("any_id", "vBrayan06"));
        assertFalse(whitelist.isAllowed(null, "alex"));

        // Legacy entry with userId works
        boolean legacyAdded = whitelist.add("usr_legacy_steve", "Steve");
        assertTrue(legacyAdded);
        assertTrue(whitelist.isAllowed("usr_legacy_steve", null));
        assertTrue(whitelist.isAllowed("usr_legacy_steve", "AnyName"));
        assertTrue(whitelist.isAllowed("different_id", "Steve"));

        // Turn OFF whitelist -> does NOT remove entries
        whitelist.setEnabled(false);
        assertFalse(whitelist.isEnabled());
        assertEquals(2, whitelist.getEntries().size());
        assertTrue(whitelist.isAllowed("random_id", "random_player"));

        // Turn back ON -> entries still preserved and enforced
        whitelist.setEnabled(true);
        assertTrue(whitelist.isEnabled());
        assertEquals(2, whitelist.getEntries().size());
        assertTrue(whitelist.isAllowed(null, "VBRAYAN06"));
        assertFalse(whitelist.isAllowed(null, "intruder"));

        // Reload from disk in a fresh instance
        HiKatWhitelist reloaded = new HiKatWhitelist(tempDir);
        assertTrue(reloaded.isEnabled());
        assertTrue(reloaded.isAllowed(null, "vbrayan06"));
        assertEquals(2, reloaded.getEntries().size());

        // Remove player by name (case-insensitive)
        boolean removed = whitelist.remove("VBRAYAN06");
        assertTrue(removed);
        assertFalse(whitelist.isAllowed(null, "vbrayan06"));
        assertEquals(1, whitelist.getEntries().size());

        // Remove legacy player by userId
        boolean removedLegacy = whitelist.remove("usr_legacy_steve");
        assertTrue(removedLegacy);
        assertEquals(0, whitelist.getEntries().size());
    }
}
