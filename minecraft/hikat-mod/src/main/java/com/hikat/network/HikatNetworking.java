package com.hikat.network;

import com.hikat.client.network.HikatClientNetworking;
import com.hikat.server.network.HikatServerNetworking;
import net.neoforged.fml.loading.FMLEnvironment;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class HikatNetworking {
    private static final Logger LOGGER = LoggerFactory.getLogger(HikatNetworking.class);

    public static void onRegisterPayloadHandlers(RegisterPayloadHandlersEvent event) {
        LOGGER.info("[HiKAT] Registering unified HiKAT network payloads");
        PayloadRegistrar registrar = event.registrar("1.0.0");

        if (FMLEnvironment.dist.isClient()) {
            registrar.configurationToClient(
                    HikatHandshakeRequestPayload.TYPE,
                    HikatHandshakeRequestPayload.STREAM_CODEC,
                    HikatClientNetworking::handleHandshakeRequest
            );
        } else {
            registrar.configurationToClient(
                    HikatHandshakeRequestPayload.TYPE,
                    HikatHandshakeRequestPayload.STREAM_CODEC,
                    (payload, context) -> {}
            );
        }

        registrar.configurationToServer(
                HikatHandshakeResponsePayload.TYPE,
                HikatHandshakeResponsePayload.STREAM_CODEC,
                HikatServerNetworking::handleHandshakeResponse
        );
    }
}
