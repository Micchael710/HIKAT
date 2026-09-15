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

    @Test
    public void testAuthResponseLinkageErrorDuringVerifyDisconnectsWithAuthFailed(@org.junit.jupiter.api.io.TempDir java.nio.file.Path tempDir) throws Exception {
        com.hikat.server.GameTokenVerifier brokenVerifier = new com.hikat.server.GameTokenVerifier("hikat-minecraft", null, null) {
            @Override
            public VerifiedClaims verify(String token) {
                throw new NoClassDefFoundError("Simulated LinkageError during JWT parsing or crypto");
            }
        };

        com.hikat.server.HiKatWhitelist whitelist = new com.hikat.server.HiKatWhitelist(tempDir);
        com.hikat.server.IntegrityService integrityService = new com.hikat.server.IntegrityService(tempDir);
        ConnectionGate gate = new ConnectionGate(brokenVerifier, integrityService, whitelist);

        Class<?> listenerClass = Class.forName("net.minecraft.network.protocol.configuration.ServerConfigurationPacketListener");
        java.util.concurrent.atomic.AtomicReference<Object> disconnectedComponent = new java.util.concurrent.atomic.AtomicReference<>();

        Object proxyListener = java.lang.reflect.Proxy.newProxyInstance(
            listenerClass.getClassLoader(),
            new Class<?>[]{listenerClass},
            (proxy, method, args) -> {
                if ("disconnect".equals(method.getName()) && args != null && args.length == 1) {
                    disconnectedComponent.set(args[0]);
                }
                return null;
            }
        );

        java.lang.reflect.Method handleAuthMethod = ConnectionGate.class.getMethod(
            "handleAuthResponse",
            listenerClass,
            com.hikat.network.HiKatProtocol.AuthResponsePayload.class,
            Runnable.class
        );

        com.hikat.network.HiKatProtocol.AuthResponsePayload payload =
            new com.hikat.network.HiKatProtocol.AuthResponsePayload("dummy-token", "rel-1", "fingerprint-1");

        handleAuthMethod.invoke(gate, proxyListener, payload, (Runnable) () -> {});

        assertNotNull(disconnectedComponent.get(), "Player must be disconnected on LinkageError");
        Object comp = disconnectedComponent.get();

        Object contents = comp.getClass().getMethod("getContents").invoke(comp);
        String key = (String) contents.getClass().getMethod("getKey").invoke(contents);
        assertEquals("disconnect.hikat.auth_failed", key);
    }
}
