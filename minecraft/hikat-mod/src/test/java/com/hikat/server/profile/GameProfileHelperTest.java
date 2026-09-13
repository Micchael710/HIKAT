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
        assertFalse(GameProfileHelper.setGameProfile(null, null));
    }

    @Test
    void testAccessorInterfaceDirectContract() {
        TestAccessorListener dummy = new TestAccessorListener();
        UUID uuid = UUID.randomUUID();
        GameProfile profile = new GameProfile(uuid, "AccessorUser");

        dummy.hikat$setGameProfile(profile);
        assertEquals(profile, dummy.hikat$getGameProfile());
        assertEquals(uuid, dummy.hikat$getGameProfile().getId());
        assertEquals("AccessorUser", dummy.hikat$getGameProfile().getName());
    }

    @Test
    void testNonAccessorListenerReturnsFalse() throws Exception {
        // Allocate raw ServerConfigurationPacketListenerImpl without Mixin injection (test env)
        Class<?> rfClass = Class.forName("sun.reflect.ReflectionFactory");
        Object rf = rfClass.getMethod("getReflectionFactory").invoke(null);
        Constructor<?> objCtor = Object.class.getDeclaredConstructor();
        Constructor<?> ctor = (Constructor<?>) rfClass.getMethod(
                "newConstructorForSerialization",
                Class.class,
                Constructor.class
        ).invoke(rf, ServerConfigurationPacketListenerImpl.class, objCtor);

        ServerConfigurationPacketListenerImpl rawListener = (ServerConfigurationPacketListenerImpl) ctor.newInstance();
        // Since raw un-transformed listener in unit test does not implement the Mixin interface:
        // Production GameProfileHelper must strictly reject it (fail-closed, no Unsafe/reflection)
        boolean result = GameProfileHelper.setGameProfile(rawListener, new GameProfile(UUID.randomUUID(), "Player"));
        assertFalse(result, "Listener without Mixin accessor must fail-closed");
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
