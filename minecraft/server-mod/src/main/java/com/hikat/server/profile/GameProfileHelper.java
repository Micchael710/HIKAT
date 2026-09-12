package com.hikat.server.profile;

import com.mojang.authlib.GameProfile;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import sun.misc.Unsafe;

import java.lang.reflect.Field;

public class GameProfileHelper {
    private static final Logger LOGGER = LoggerFactory.getLogger(GameProfileHelper.class);
    private static Field GAME_PROFILE_FIELD;
    private static Unsafe UNSAFE;
    private static long FIELD_OFFSET = -1L;

    static {
        try {
            Field unsafeField = Unsafe.class.getDeclaredField("theUnsafe");
            unsafeField.setAccessible(true);
            UNSAFE = (Unsafe) unsafeField.get(null);
        } catch (Throwable t) {
            LOGGER.warn("[HiKAT] Could not acquire sun.misc.Unsafe: {}", t.getMessage());
        }

        try {
            Field f = null;
            try {
                f = ServerConfigurationPacketListenerImpl.class.getDeclaredField("gameProfile");
            } catch (NoSuchFieldException e) {
                for (Field declared : ServerConfigurationPacketListenerImpl.class.getDeclaredFields()) {
                    if (declared.getType().equals(GameProfile.class)) {
                        f = declared;
                        break;
                    }
                }
            }

            if (f != null) {
                f.setAccessible(true);
                GAME_PROFILE_FIELD = f;
                if (UNSAFE != null) {
                    FIELD_OFFSET = UNSAFE.objectFieldOffset(f);
                }
                LOGGER.info("[HiKAT] Successfully resolved gameProfile field on ServerConfigurationPacketListenerImpl (offset: {})", FIELD_OFFSET);
            } else {
                LOGGER.error("[HiKAT] Failed to find gameProfile field on ServerConfigurationPacketListenerImpl");
            }
        } catch (Throwable t) {
            LOGGER.error("[HiKAT] Error initializing GameProfileHelper: {}", t.getMessage(), t);
        }
    }

    public static GameProfile getGameProfile(ServerConfigurationPacketListenerImpl listener) {
        if (listener == null) return null;
        try {
            if (GAME_PROFILE_FIELD != null) {
                return (GameProfile) GAME_PROFILE_FIELD.get(listener);
            }
        } catch (Exception e) {
            LOGGER.error("[HiKAT] Could not get gameProfile: {}", e.getMessage());
        }
        return null;
    }

    public static boolean setGameProfile(ServerConfigurationPacketListenerImpl listener, GameProfile newProfile) {
        if (listener == null || newProfile == null) return false;

        // Try Unsafe first as it safely updates private final fields without JVM restriction
        if (UNSAFE != null && FIELD_OFFSET != -1L) {
            try {
                UNSAFE.putObject(listener, FIELD_OFFSET, newProfile);
                LOGGER.info("[HiKAT] Imposed HiKAT GameProfile via Unsafe: name='{}', uuid={}",
                        newProfile.getName(), newProfile.getId());
                return true;
            } catch (Throwable t) {
                LOGGER.warn("[HiKAT] Unsafe set failed, trying reflection: {}", t.getMessage());
            }
        }

        // Fallback to reflection
        if (GAME_PROFILE_FIELD != null) {
            try {
                GAME_PROFILE_FIELD.set(listener, newProfile);
                LOGGER.info("[HiKAT] Imposed HiKAT GameProfile via reflection: name='{}', uuid={}",
                        newProfile.getName(), newProfile.getId());
                return true;
            } catch (Throwable t) {
                LOGGER.error("[HiKAT] Reflection set failed: {}", t.getMessage());
            }
        }

        return false;
    }
}
