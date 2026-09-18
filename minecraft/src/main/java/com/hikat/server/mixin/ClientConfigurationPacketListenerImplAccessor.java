package com.hikat.server.mixin;

import com.mojang.authlib.GameProfile;
import net.minecraft.client.multiplayer.ClientConfigurationPacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Mutable;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ClientConfigurationPacketListenerImpl.class)
public interface ClientConfigurationPacketListenerImplAccessor {

    @Accessor("localGameProfile")
    @Mutable
    void hikat$setLocalGameProfile(GameProfile gameProfile);

    @Accessor("localGameProfile")
    GameProfile hikat$getLocalGameProfile();
}
