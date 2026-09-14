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
        assertTrue(whitelist.isAllowed("usr_anyone"));

        // Enable whitelist
        whitelist.setEnabled(true);
        assertTrue(whitelist.isEnabled());
        assertFalse(whitelist.isAllowed("usr_anyone"));

        // Add player
        boolean added = whitelist.add("usr_steve", "Steve");
        assertTrue(added);
        assertTrue(whitelist.isAllowed("usr_steve"));
        assertFalse(whitelist.isAllowed("usr_alex"));

        // Duplicate add returns false
        assertFalse(whitelist.add("usr_steve", "Steve2"));

        // Reload from disk in a fresh instance
        HiKatWhitelist reloaded = new HiKatWhitelist(tempDir);
        assertTrue(reloaded.isEnabled());
        assertTrue(reloaded.isAllowed("usr_steve"));
        assertEquals(1, reloaded.getEntries().size());

        // Remove player
        boolean removed = whitelist.remove("usr_steve");
        assertTrue(removed);
        assertFalse(whitelist.isAllowed("usr_steve"));
        assertFalse(whitelist.remove("usr_steve"));
    }
}
