package com.hikat.server.whitelist;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

public class HikatWhitelistTest {

    @Test
    void testWhitelistOperations(@TempDir Path tempDir) {
        Path configFile = tempDir.resolve("whitelist.json");
        HikatWhitelist whitelist = new HikatWhitelist(configFile);

        // Initially disabled: everyone allowed
        assertFalse(whitelist.isEnabled());
        assertTrue(whitelist.isAllowed("AnyPlayer"));

        // Enable whitelist
        whitelist.setEnabled(true);
        assertTrue(whitelist.isEnabled());
        assertFalse(whitelist.isAllowed("AnyPlayer"));

        // Add user
        assertTrue(whitelist.add("HiKATGamer"));
        assertFalse(whitelist.add("HiKATGamer")); // Duplicate returns false

        // Check case-insensitive match
        assertTrue(whitelist.isAllowed("hikatgamer"));
        assertTrue(whitelist.isAllowed("HIKATGAMER"));
        assertFalse(whitelist.isAllowed("UnknownPlayer"));

        // List
        assertEquals(1, whitelist.getAllowedUsernames().size());

        // Remove user
        assertTrue(whitelist.remove("hikatgamer"));
        assertFalse(whitelist.isAllowed("hikatgamer"));

        // Persistence test: reload from disk
        whitelist.add("PersistentUser");
        HikatWhitelist reloaded = new HikatWhitelist(configFile);
        assertTrue(reloaded.isEnabled());
        assertTrue(reloaded.isAllowed("persistentuser"));
    }
}
