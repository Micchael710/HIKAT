package com.hikat.server.profile;

import com.hikat.server.mixin.ServerConfigurationPacketListenerImplAccessor;
import com.mojang.authlib.GameProfile;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

public class GameProfileHelperTest {

    @Test
    void testNullListenerOrProfileReturnsFalse() {
        UUID uuid = UUID.randomUUID();
        GameProfile profile = new GameProfile(uuid, "TestUser");

        assertFalse(GameProfileHelper.setGameProfile(null, profile));
        assertNull(GameProfileHelper.getGameProfile(null));

        // When profile is null
        // Note: passing null profile should fail
        assertFalse(GameProfileHelper.setGameProfile(null, null));
    }

    @Test
    void testGameProfileReflectionImposition() throws Exception {
        // Allocate uninitialized ServerConfigurationPacketListenerImpl for isolated testing
        Class<?> rfClass = Class.forName("sun.reflect.ReflectionFactory");
        Object rf = rfClass.getMethod("getReflectionFactory").invoke(null);
        Constructor<?> objCtor = Object.class.getDeclaredConstructor();
        Constructor<?> ctor = (Constructor<?>) rfClass.getMethod(
                "newConstructorForSerialization",
                Class.class,
                Constructor.class
        ).invoke(rf, ServerConfigurationPacketListenerImpl.class, objCtor);

        ServerConfigurationPacketListenerImpl listener = (ServerConfigurationPacketListenerImpl) ctor.newInstance();

        UUID initialUuid = UUID.randomUUID();
        GameProfile initialProfile = new GameProfile(initialUuid, "InitialPlayer");
        GameProfileHelper.setGameProfile(listener, initialProfile);

        GameProfile retrievedInitial = GameProfileHelper.getGameProfile(listener);
        assertNotNull(retrievedInitial);
        assertEquals(initialUuid, retrievedInitial.getId());
        assertEquals("InitialPlayer", retrievedInitial.getName());

        // Now impose HiKAT profile
        UUID hikatUuid = UUID.randomUUID();
        GameProfile hikatProfile = new GameProfile(hikatUuid, "HiKATPlayer");

        boolean success = GameProfileHelper.setGameProfile(listener, hikatProfile);
        assertTrue(success, "GameProfileHelper.setGameProfile should succeed via reflection fallback");

        GameProfile verified = GameProfileHelper.getGameProfile(listener);
        assertNotNull(verified);
        assertEquals(hikatUuid, verified.getId(), "Verified UUID must match HiKAT sub");
        assertEquals("HiKATPlayer", verified.getName(), "Verified username must match HiKAT displayName");
    }

    @Test
    void testMixinAccessorVerification() {
        // Verify that ServerConfigurationPacketListenerImplAccessor interface contract is sound
        TestAccessorListener dummy = new TestAccessorListener();
        UUID uuid = UUID.randomUUID();
        GameProfile profile = new GameProfile(uuid, "AccessorUser");

        dummy.hikat$setGameProfile(profile);
        assertEquals(profile, dummy.hikat$getGameProfile());
        assertEquals(uuid, dummy.hikat$getGameProfile().getId());
        assertEquals("AccessorUser", dummy.hikat$getGameProfile().getName());
    }

    private static class TestAccessorListener implements ServerConfigurationPacketListenerImplAccessor {
        private GameProfile profile;

        @Override
        public GameProfile hikat$getGameProfile() {
            return profile;
        }

        @Override
        public void hikat$setGameProfile(GameProfile profile) {
            this.profile = profile;
        }
    }
}
