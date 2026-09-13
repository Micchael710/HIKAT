package com.hikat;

import com.hikat.client.HikatClient;
import com.hikat.network.HikatNetworking;
import com.hikat.server.HikatServer;
import com.hikat.server.network.HikatServerNetworking;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLEnvironment;
import net.neoforged.neoforge.common.NeoForge;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Mod(HikatMod.MOD_ID)
public class HikatMod {
    public static final String MOD_ID = "hikat";
    private static final Logger LOGGER = LoggerFactory.getLogger(HikatMod.class);

    public HikatMod(IEventBus modEventBus) {
        LOGGER.info("[HiKAT] Initializing HiKAT Universal Mod");

        // 1. Unified networking registration
        modEventBus.addListener(HikatNetworking::onRegisterPayloadHandlers);

        // 2. Server configuration phase task
        modEventBus.addListener(HikatServerNetworking::onRegisterConfigurationTasks);

        // 3. Server lifecycle events on game bus
        NeoForge.EVENT_BUS.addListener(HikatServer::onServerStarting);
        NeoForge.EVENT_BUS.addListener(HikatServer::onRegisterCommands);

        // 4. Client-only subsystems
        if (FMLEnvironment.dist.isClient()) {
            HikatClient.init(modEventBus);
        }
    }
}
