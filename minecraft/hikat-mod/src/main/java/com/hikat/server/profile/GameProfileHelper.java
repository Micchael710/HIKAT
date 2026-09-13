package com.hikat.server.profile;

import com.hikat.server.mixin.ServerConfigurationPacketListenerImplAccessor;
import com.mojang.authlib.GameProfile;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class GameProfileHelper {
    private static final Logger LOGGER = LoggerFactory.getLogger(GameProfileHelper.class);

    public static GameProfile getGameProfile(ServerConfigurationPacketListenerImpl listener) {
        if (listener == null) return null;

        if (listener instanceof ServerConfigurationPacketListenerImplAccessor accessor) {
            return accessor.hikat$getGameProfile();
        }

        LOGGER.error("[HiKAT] Listener does not implement Mixin accessor ServerConfigurationPacketListenerImplAccessor");
        return null;
    }

    public static boolean setGameProfile(ServerConfigurationPacketListenerImpl listener, GameProfile newProfile) {
        if (listener == null || newProfile == null) return false;

        if (listener instanceof ServerConfigurationPacketListenerImplAccessor accessor) {
            try {
                accessor.hikat$setGameProfile(newProfile);
                GameProfile current = accessor.hikat$getGameProfile();
                if (current != null && newProfile.getId().equals(current.getId()) && newProfile.getName().equals(current.getName())) {
                    LOGGER.info("[HiKAT] Imposed HiKAT GameProfile via Mixin accessor: name='{}', uuid={}",
                            newProfile.getName(), newProfile.getId());
                    return true;
                }
            } catch (Throwable t) {
                LOGGER.error("[HiKAT] Mixin accessor set failed: {}", t.getMessage());
            }
        } else {
            LOGGER.error("[HiKAT] Listener does not implement Mixin accessor ServerConfigurationPacketListenerImplAccessor");
        }

        return false;
    }
}
