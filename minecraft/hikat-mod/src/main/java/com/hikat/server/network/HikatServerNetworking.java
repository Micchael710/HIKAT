package com.hikat.server.network;

import com.hikat.network.HikatHandshakeResponsePayload;
import com.hikat.server.auth.GameTokenClaims;
import com.hikat.server.auth.TokenValidator;
import com.hikat.server.i18n.HikatMessages;
import com.hikat.server.integrity.ServerIntegrityService;
import com.hikat.server.profile.GameProfileHelper;
import com.hikat.server.whitelist.HikatWhitelist;
import com.mojang.authlib.GameProfile;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;
import net.neoforged.neoforge.network.event.RegisterConfigurationTasksEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.UUID;

public class HikatServerNetworking {
    private static final Logger LOGGER = LoggerFactory.getLogger(HikatServerNetworking.class);
    private static final TokenValidator TOKEN_VALIDATOR = new TokenValidator();

    public static TokenValidator getTokenValidator() {
        return TOKEN_VALIDATOR;
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

            // Record known player identity for administrative convenience
            HikatWhitelist whitelist = HikatWhitelist.getInstance();
            if (whitelist != null) {
                whitelist.recordKnownPlayer(hikatUsername, hikatUuid);

                // 4: HiKAT Whitelist check using sub UUID
                if (!whitelist.isAllowed(hikatUuid)) {
                    LOGGER.warn("[HiKAT] Rejected: User '{}' (uuid: {}) is not on the HiKAT whitelist", hikatUsername, hikatUuid);
                    context.disconnect(HikatMessages.getWhitelistRejectedMessage(locale));
                    return;
                }
            }

            // 5: Official integrity manifest presence check (fail-closed)
            ServerIntegrityService integrityService = ServerIntegrityService.getInstance();
            if (integrityService == null || !integrityService.isLoaded()) {
                LOGGER.error("[HiKAT] Rejected connection: Official integrity manifest is missing or invalid on server");
                context.disconnect(HikatMessages.getIntegrityManifestMissingMessage(locale));
                return;
            }

            // 5b: Release version check
            if (!integrityService.isVersionMatch(payload.releaseVersion())) {
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
            if (!integrityService.isFingerprintMatch(payload.integrityFingerprint())) {
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

            // Impose permanent HiKAT UUID and username onto GameProfile via Mixin accessor (FAIL-CLOSED)
            if (context.listener() instanceof ServerConfigurationPacketListenerImpl listenerImpl) {
                GameProfile currentProfile = GameProfileHelper.getGameProfile(listenerImpl);
                GameProfile hikatProfile = new GameProfile(hikatUuid, hikatUsername);
                if (currentProfile != null) {
                    hikatProfile.getProperties().putAll(currentProfile.getProperties());
                }

                boolean setOk = GameProfileHelper.setGameProfile(listenerImpl, hikatProfile);
                GameProfile verified = GameProfileHelper.getGameProfile(listenerImpl);

                if (!setOk || verified == null || !hikatUuid.equals(verified.getId()) || !hikatUsername.equals(verified.getName())) {
                    LOGGER.error("[HiKAT] CRITICAL: Failed to impose HiKAT GameProfile for user '{}' (uuid: {}). Rejecting login fail-closed.",
                            hikatUsername, hikatUuid);
                    context.disconnect(HikatMessages.getProfileImposeFailedMessage(locale));
                    return; // DO NOT FINISH TASK! FAIL CLOSED!
                }

                LOGGER.info("[HiKAT] Successfully authenticated and verified player: '{}' with permanent UUID: {}",
                        hikatUsername, hikatUuid);
            } else {
                LOGGER.error("[HiKAT] CRITICAL: Listener is not ServerConfigurationPacketListenerImpl. Rejecting login fail-closed.");
                context.disconnect(HikatMessages.getProfileImposeFailedMessage(locale));
                return; // DO NOT FINISH TASK! FAIL CLOSED!
            }

            // Finish configuration task to proceed with player join ONLY if GameProfile was verified!
            context.finishCurrentTask(HikatConfigurationTask.TYPE);
        });
    }
}
