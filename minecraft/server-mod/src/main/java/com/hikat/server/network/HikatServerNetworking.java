package com.hikat.server.network;

import com.hikat.server.auth.GameTokenClaims;
import com.hikat.server.auth.TokenValidator;
import com.hikat.server.i18n.HikatMessages;
import com.hikat.server.integrity.ServerIntegrityService;
import com.hikat.server.profile.GameProfileHelper;
import com.hikat.server.whitelist.HikatWhitelist;
import com.mojang.authlib.GameProfile;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;
import net.neoforged.neoforge.network.event.RegisterConfigurationTasksEvent;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.UUID;

public class HikatServerNetworking {
    private static final Logger LOGGER = LoggerFactory.getLogger(HikatServerNetworking.class);
    private static final TokenValidator TOKEN_VALIDATOR = new TokenValidator();

    public static TokenValidator getTokenValidator() {
        return TOKEN_VALIDATOR;
    }

    public static void onRegisterPayloadHandlers(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar registrar = event.registrar("1.0.0");

        registrar.configurationToClient(
                HikatHandshakeRequestPayload.TYPE,
                HikatHandshakeRequestPayload.STREAM_CODEC,
                (payload, context) -> {}
        );

        registrar.configurationToServer(
                HikatHandshakeResponsePayload.TYPE,
                HikatHandshakeResponsePayload.STREAM_CODEC,
                HikatServerNetworking::handleHandshakeResponse
        );
    }

    public static void onRegisterConfigurationTasks(RegisterConfigurationTasksEvent event) {
        LOGGER.info("[HiKAT] Registering HiKAT authentication configuration task");
        event.register(new HikatConfigurationTask());
    }

    public static void handleHandshakeResponse(HikatHandshakeResponsePayload payload, IPayloadContext context) {
        context.enqueueWork(() -> {
            String locale = payload.locale();
            LOGGER.info("[HiKAT] Validating incoming handshake response (locale: {}, version: {}, state: {})",
                    locale, payload.releaseVersion(), payload.integrityState());

            // 1 & 2: Game Token validation
            TokenValidator.Result tokenResult = TOKEN_VALIDATOR.validate(payload.gameToken());
            if (tokenResult.status() == TokenValidator.Status.EXPIRED) {
                LOGGER.warn("[HiKAT] Rejected: Game Token expired");
                context.disconnect(HikatMessages.getSessionExpiredMessage(locale));
                return;
            }

            if (!tokenResult.isValid() || tokenResult.claims() == null) {
                LOGGER.warn("[HiKAT] Rejected: Invalid Game Token ({})", tokenResult.message());
                context.disconnect(HikatMessages.getInvalidTokenMessage(locale));
                return;
            }

            GameTokenClaims claims = tokenResult.claims();
            UUID hikatUuid = claims.sub();

            // 3: Valid sub/UUID
            if (hikatUuid == null) {
                LOGGER.warn("[HiKAT] Rejected: Missing UUID in token claims");
                context.disconnect(HikatMessages.getInvalidTokenMessage(locale));
                return;
            }

            String hikatUsername = claims.displayName();

            // 4: HiKAT Whitelist check
            HikatWhitelist whitelist = HikatWhitelist.getInstance();
            if (whitelist != null && !whitelist.isAllowed(hikatUsername)) {
                LOGGER.warn("[HiKAT] Rejected: User '{}' is not on the HiKAT whitelist", hikatUsername);
                context.disconnect(HikatMessages.getWhitelistRejectedMessage(locale));
                return;
            }

            // 5: Release version check
            ServerIntegrityService integrityService = ServerIntegrityService.getInstance();
            if (integrityService != null && !integrityService.isVersionMatch(payload.releaseVersion())) {
                LOGGER.warn("[HiKAT] Rejected: Release version mismatch (server: '{}', client: '{}')",
                        integrityService.getOfficialReleaseVersion(), payload.releaseVersion());
                context.disconnect(HikatMessages.getVersionMismatchMessage(
                        locale,
                        integrityService.getOfficialReleaseVersion(),
                        payload.releaseVersion()
                ));
                return;
            }

            // 6: Integrity fingerprint check
            if (integrityService != null && !integrityService.isFingerprintMatch(payload.integrityFingerprint())) {
                LOGGER.warn("[HiKAT] Rejected: Fingerprint mismatch (server: '{}', client: '{}')",
                        integrityService.getOfficialFingerprint(), payload.integrityFingerprint());
                context.disconnect(HikatMessages.getModifiedFilesMessage(locale));
                return;
            }

            // 7: Client integrity state check (PENDING or INVALID)
            if ("PENDING".equalsIgnoreCase(payload.integrityState())) {
                LOGGER.warn("[HiKAT] Rejected: Client integrity state is PENDING");
                context.disconnect(HikatMessages.getIntegrityPendingMessage(locale));
                return;
            }

            if ("INVALID".equalsIgnoreCase(payload.integrityState())) {
                LOGGER.warn("[HiKAT] Rejected: Client integrity state is INVALID");
                context.disconnect(HikatMessages.getModifiedFilesMessage(locale));
                return;
            }

            // Impose permanent HiKAT UUID and username onto GameProfile
            if (context.listener() instanceof ServerConfigurationPacketListenerImpl listenerImpl) {
                GameProfile currentProfile = GameProfileHelper.getGameProfile(listenerImpl);
                GameProfile hikatProfile = new GameProfile(hikatUuid, hikatUsername);
                if (currentProfile != null) {
                    hikatProfile.getProperties().putAll(currentProfile.getProperties());
                }

                boolean setOk = GameProfileHelper.setGameProfile(listenerImpl, hikatProfile);
                if (setOk) {
                    LOGGER.info("[HiKAT] Successfully authenticated player: '{}' with permanent UUID: {}",
                            hikatUsername, hikatUuid);
                } else {
                    LOGGER.warn("[HiKAT] Could not mutate GameProfile directly on listener");
                }
            }

            // Finish configuration task to proceed with player join
            context.finishCurrentTask(HikatConfigurationTask.TYPE);
        });
    }
}
