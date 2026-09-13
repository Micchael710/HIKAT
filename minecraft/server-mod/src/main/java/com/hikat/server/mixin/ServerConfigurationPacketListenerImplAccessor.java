package com.hikat.server.mixin;

import com.mojang.authlib.GameProfile;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Mutable;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ServerConfigurationPacketListenerImpl.class)
public interface ServerConfigurationPacketListenerImplAccessor {
    @Accessor("gameProfile")
    @Mutable
    void hikat$setGameProfile(GameProfile gameProfile);

    @Accessor("gameProfile")
    GameProfile hikat$getGameProfile();
}
