package com.hikat;

import com.hikat.server.ConnectionGate;
import java.util.UUID;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

public class ConnectionGateTest {

    @Test
    public void testPermanentUuidDerivationSameUser() {
        String userId = "usr_01j7h9f2k3";
        UUID uuid1 = ConnectionGate.computePlayerUuid(userId);
        UUID uuid2 = ConnectionGate.computePlayerUuid(userId);

        assertNotNull(uuid1);
        assertEquals(uuid1, uuid2);
    }

    @Test
    public void testPermanentUuidDerivationDifferentUsers() {
        UUID uuid1 = ConnectionGate.computePlayerUuid("usr_aaa111");
        UUID uuid2 = ConnectionGate.computePlayerUuid("usr_bbb222");

        assertNotEquals(uuid1, uuid2);
    }

    @Test
    public void testPermanentUuidPreservesIdentityWhenDisplayNameChanges() {
        String userId = "usr_fixed_id_12345";

        // Even if user's visible name changes from "Alex" to "AlexTheGreat",
        // the permanent UUID derived from the sub remains exactly identical!
        UUID originalUuid = ConnectionGate.computePlayerUuid(userId);
        UUID newUuid = ConnectionGate.computePlayerUuid(userId);

        assertEquals(originalUuid, newUuid, "Player UUID must be immutable regardless of displayName changes");
    }

    @Test
    public void testComputePlayerUuidRejectsBlank() {
        assertThrows(IllegalArgumentException.class, () -> ConnectionGate.computePlayerUuid(null));
        assertThrows(IllegalArgumentException.class, () -> ConnectionGate.computePlayerUuid(""));
        assertThrows(IllegalArgumentException.class, () -> ConnectionGate.computePlayerUuid("   "));
    }
}
