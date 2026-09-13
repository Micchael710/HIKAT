package com.hikat.server.whitelist;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

public class HikatWhitelistTest {

    @Test
    void testWhitelistUsesSubUuidAndNotUsername(@TempDir Path tempDir) throws Exception {
        Path configFile = tempDir.resolve("whitelist.json");
        HikatWhitelist whitelist = new HikatWhitelist(configFile);

        UUID playerUuid = UUID.fromString("11111111-2222-3333-4444-555555555555");
        UUID otherUuid = UUID.fromString("99999999-8888-7777-6666-555555555555");

        // Initially disabled: everyone allowed
        assertFalse(whitelist.isEnabled());
        assertTrue(whitelist.isAllowed(playerUuid));
        assertTrue(whitelist.isAllowed(otherUuid));

        // Enable whitelist
        whitelist.setEnabled(true);
        assertTrue(whitelist.isEnabled());
        assertFalse(whitelist.isAllowed(playerUuid));
        assertFalse(whitelist.isAllowed(otherUuid));

        // Record a known HiKAT player (sub UUID and username)
        whitelist.recordKnownPlayer("HiKATGamer", playerUuid);
        assertEquals(playerUuid, whitelist.findKnownUuid("hikatgamer"));
        assertEquals("HiKATGamer", whitelist.getDisplayName(playerUuid));

        // Admin adds via username -> resolved to sub UUID
        assertTrue(whitelist.add("HiKATGamer"));
        assertFalse(whitelist.add("HiKATGamer")); // Duplicate returns false

        // Check identity check uses sub UUID
        assertTrue(whitelist.isAllowed(playerUuid));
        assertFalse(whitelist.isAllowed(otherUuid));

        // Verify that whitelist.json stores allowedUuids and does NOT store the username
        String jsonContent = Files.readString(configFile);
        assertTrue(jsonContent.contains("allowedUuids"));
        assertTrue(jsonContent.contains(playerUuid.toString()));
        assertFalse(jsonContent.contains("HiKATGamer"), "whitelist.json must store UUIDs, not usernames");

        // Verify persistence: reloaded whitelist checks sub UUID properly
        HikatWhitelist reloaded = new HikatWhitelist(configFile);
        assertTrue(reloaded.isEnabled());
        assertTrue(reloaded.isAllowed(playerUuid));
        assertFalse(reloaded.isAllowed(otherUuid));

        // Remove via UUID
        assertTrue(whitelist.remove(playerUuid));
        assertFalse(whitelist.isAllowed(playerUuid));
    }
}
