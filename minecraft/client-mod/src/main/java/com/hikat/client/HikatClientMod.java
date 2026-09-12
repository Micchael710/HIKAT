package com.hikat.client;

import com.hikat.client.integrity.ClientIntegrityService;
import com.hikat.client.network.HikatClientNetworking;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Mod("hikat_client")
public class HikatClientMod {
    public static final String MOD_ID = "hikat_client";
    private static final Logger LOGGER = LoggerFactory.getLogger(HikatClientMod.class);

    public HikatClientMod(IEventBus modEventBus) {
        LOGGER.info("[HiKAT] Initializing HiKAT Client Mod");

        modEventBus.addListener(HikatClientNetworking::onRegisterPayloadHandlers);
        modEventBus.addListener(this::onClientSetup);
    }

    private void onClientSetup(FMLClientSetupEvent event) {
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
