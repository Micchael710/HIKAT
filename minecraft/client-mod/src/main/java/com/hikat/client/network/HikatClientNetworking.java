package com.hikat.client.network;

import com.hikat.client.auth.ClientTokenReader;
import com.hikat.client.integrity.ClientIntegrityService;
import net.minecraft.client.Minecraft;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class HikatClientNetworking {
    private static final Logger LOGGER = LoggerFactory.getLogger(HikatClientNetworking.class);

    public static void onRegisterPayloadHandlers(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar registrar = event.registrar("1.0.0");

        registrar.configurationToClient(
                HikatHandshakeRequestPayload.TYPE,
                HikatHandshakeRequestPayload.STREAM_CODEC,
                (payload, context) -> {
                    context.enqueueWork(() -> {
                        LOGGER.info("[HiKAT] Received handshake request from server (nonce: {})", payload.serverNonce());

                        String gameToken = ClientTokenReader.readCurrentToken();
                        if (gameToken == null) {
                            gameToken = "";
                        }

                        ClientIntegrityService integrityService = ClientIntegrityService.getInstance();
                        String releaseVersion = integrityService.getReleaseVersion();
                        String fingerprint = integrityService.getFingerprint();
                        String integrityState = integrityService.getState().name();

                        String locale = "en_us";
                        try {
                            if (Minecraft.getInstance() != null && Minecraft.getInstance().options != null) {
                                locale = Minecraft.getInstance().options.languageCode;
                            }
                        } catch (Throwable t) {
                            locale = "en_us";
                        }

                        LOGGER.info("[HiKAT] Responding with release: {}, state: {}, locale: {}",
                                releaseVersion, integrityState, locale);

                        HikatHandshakeResponsePayload response = new HikatHandshakeResponsePayload(
                                gameToken,
                                releaseVersion,
                                fingerprint,
                                integrityState,
                                locale
                        );

                        context.reply(response);
                    });
                }
        );

        registrar.configurationToServer(
                HikatHandshakeResponsePayload.TYPE,
                HikatHandshakeResponsePayload.STREAM_CODEC,
                (payload, context) -> {}
        );
    }
}
