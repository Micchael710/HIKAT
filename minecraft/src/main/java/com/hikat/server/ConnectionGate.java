package com.hikat.server;

import com.hikat.network.HiKatProtocol;
import com.hikat.server.mixin.ServerConfigurationPacketListenerImplAccessor;
import com.mojang.authlib.GameProfile;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.function.Consumer;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.configuration.ServerConfigurationPacketListener;
import net.minecraft.server.network.ConfigurationTask;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;

public class ConnectionGate {
    public static class AuthConfigurationTask implements ConfigurationTask {
        public static final ConfigurationTask.Type TYPE = new ConfigurationTask.Type("hikat:auth");

        @Override
        public void start(Consumer<Packet<?>> sender) {
            sender.accept(new ClientboundCustomPayloadPacket(new HiKatProtocol.AuthRequestPayload("hikat-server")));
        }

        @Override
        public ConfigurationTask.Type type() {
            return TYPE;
        }
    }

    private final GameTokenVerifier tokenVerifier;
    private final IntegrityService integrityService;
    private final HiKatWhitelist whitelist;

    public ConnectionGate(
        GameTokenVerifier tokenVerifier,
        IntegrityService integrityService,
        HiKatWhitelist whitelist
    ) {
        this.tokenVerifier = tokenVerifier;
        this.integrityService = integrityService;
        this.whitelist = whitelist;
    }

    public static UUID computePlayerUuid(String userId) {
        if (userId == null || userId.isBlank()) {
            throw new IllegalArgumentException("userId cannot be null or blank");
        }
        return UUID.nameUUIDFromBytes(("hikat:" + userId.trim()).getBytes(StandardCharsets.UTF_8));
    }

    public void handleAuthResponse(
        ServerConfigurationPacketListener listener,
        HiKatProtocol.AuthResponsePayload payload,
        Runnable onTaskFinished
    ) {
        GameTokenVerifier.VerifiedClaims claims;
        try {
            // 1. Verify Game JWT
            claims = tokenVerifier.verify(payload.gameToken());
        } catch (Exception | LinkageError e) {
            System.err.println("[HiKAT] Game token verification failed: " + e.getMessage());
            listener.disconnect(Component.translatable("disconnect.hikat.auth_failed"));
            return;
        }

        // 2. Enforce Whitelist by userId (sub) or displayName
        if (!whitelist.isAllowed(claims.sub(), claims.displayName())) {
            listener.disconnect(Component.translatable("disconnect.hikat.whitelist"));
            return;
        }

        // 3. Enforce Release & File Integrity
        try {
            integrityService.verify(payload.releaseId(), payload.actualFingerprint());
        } catch (Exception e) {
            System.err.println("[HiKAT] Integrity verification failed: " + e.getMessage());
            listener.disconnect(Component.translatable("disconnect.hikat.integrity_failed"));
            return;
        }

        try {
            // 4. Identity & Permanent UUID replacement
            UUID permanentUuid = computePlayerUuid(claims.sub());
            GameProfile authenticatedProfile = new GameProfile(permanentUuid, claims.displayName());

            if (listener instanceof ServerConfigurationPacketListenerImplAccessor accessor) {
                accessor.hikat$setGameProfile(authenticatedProfile);
            }

            // 5. Complete Configuration Task strictly AFTER GameProfile mutation
            onTaskFinished.run();
        } catch (Exception | LinkageError e) {
            System.err.println("[HiKAT] Connection setup error: " + e.getMessage());
            listener.disconnect(Component.translatable("disconnect.hikat.server_error"));
        }
    }

    public void handleIntegrityUpdate(Consumer<Component> disconnector, HiKatProtocol.IntegrityUpdatePayload payload) {
        try {
            integrityService.verify(payload.releaseId(), payload.actualFingerprint());
        } catch (Exception e) {
            System.err.println("[HiKAT] Integrity violation during gameplay: " + e.getMessage());
            disconnector.accept(Component.translatable("disconnect.hikat.file_modified"));
        }
    }

    public GameTokenVerifier getTokenVerifier() {
        return tokenVerifier;
    }

    public IntegrityService getIntegrityService() {
        return integrityService;
    }

    public HiKatWhitelist getWhitelist() {
        return whitelist;
    }
}
