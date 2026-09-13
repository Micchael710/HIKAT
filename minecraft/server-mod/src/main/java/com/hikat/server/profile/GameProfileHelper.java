package com.hikat.server.profile;

import com.hikat.server.mixin.ServerConfigurationPacketListenerImplAccessor;
import com.mojang.authlib.GameProfile;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.lang.reflect.Field;

public class GameProfileHelper {
    private static final Logger LOGGER = LoggerFactory.getLogger(GameProfileHelper.class);

    public static GameProfile getGameProfile(ServerConfigurationPacketListenerImpl listener) {
        if (listener == null) return null;

        // 1. Primary: Mixin accessor
        if (listener instanceof ServerConfigurationPacketListenerImplAccessor accessor) {
            return accessor.hikat$getGameProfile();
        }

        // 2. Reflection fallback for untransformed/test environments
        try {
            Field f = findGameProfileField(listener.getClass());
            if (f != null) {
                f.setAccessible(true);
                return (GameProfile) f.get(listener);
            }
        } catch (Exception e) {
            LOGGER.error("[HiKAT] Could not get gameProfile via reflection: {}", e.getMessage());
        }

        return null;
    }

    public static boolean setGameProfile(ServerConfigurationPacketListenerImpl listener, GameProfile newProfile) {
        if (listener == null || newProfile == null) return false;

        // 1. Primary: SpongePowered Mixin accessor
        if (listener instanceof ServerConfigurationPacketListenerImplAccessor accessor) {
            try {
                accessor.hikat$setGameProfile(newProfile);
                GameProfile current = accessor.hikat$getGameProfile();
                if (current != null && current.getId().equals(newProfile.getId()) && current.getName().equals(newProfile.getName())) {
                    LOGGER.info("[HiKAT] Imposed HiKAT GameProfile via Mixin accessor: name='{}', uuid={}",
                            newProfile.getName(), newProfile.getId());
                    return true;
                }
            } catch (Throwable t) {
                LOGGER.error("[HiKAT] Mixin accessor set failed: {}", t.getMessage());
            }
        }

        // 2. Reflection fallback for test environments
        try {
            Field f = findGameProfileField(listener.getClass());
            if (f != null) {
                f.setAccessible(true);
                f.set(listener, newProfile);
                GameProfile current = (GameProfile) f.get(listener);
                if (current != null && current.getId().equals(newProfile.getId()) && current.getName().equals(newProfile.getName())) {
                    LOGGER.info("[HiKAT] Imposed HiKAT GameProfile via reflection: name='{}', uuid={}",
                            newProfile.getName(), newProfile.getId());
                    return true;
                }
            }
        } catch (Throwable t) {
            LOGGER.error("[HiKAT] Reflection set failed: {}", t.getMessage());
        }

        return false;
    }

    private static Field findGameProfileField(Class<?> clazz) {
        Class<?> curr = clazz;
        while (curr != null && curr != Object.class) {
            for (Field f : curr.getDeclaredFields()) {
                if (f.getType().equals(GameProfile.class)) {
                    return f;
                }
            }
            curr = curr.getSuperclass();
        }
        return null;
    }
}
