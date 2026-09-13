package com.hikat.client;

import com.hikat.client.integrity.ClientIntegrityService;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class HikatClient {
    private static final Logger LOGGER = LoggerFactory.getLogger(HikatClient.class);

    public static void init(IEventBus modEventBus) {
        LOGGER.info("[HiKAT] Initializing HiKAT Client subsystems");
        modEventBus.addListener(HikatClient::onClientSetup);
    }

    private static void onClientSetup(FMLClientSetupEvent event) {
        event.enqueueWork(() -> {
            LOGGER.info("[HiKAT] Starting HiKAT Client Integrity Service...");
            ClientIntegrityService integrityService = ClientIntegrityService.getInstance();
            LOGGER.info("[HiKAT] Initial integrity status: {} (fingerprint: {}, version: {})",
                    integrityService.getState(),
                    integrityService.getFingerprint(),
                    integrityService.getReleaseVersion()
            );
        });
    }
}
