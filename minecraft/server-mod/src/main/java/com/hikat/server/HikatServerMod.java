package com.hikat.server;

import com.hikat.server.command.HikatCommand;
import com.hikat.server.integrity.ServerIntegrityService;
import com.hikat.server.network.HikatServerNetworking;
import com.hikat.server.whitelist.HikatWhitelist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;

@Mod("hikat_server")
public class HikatServerMod {
    public static final String MOD_ID = "hikat_server";
    private static final Logger LOGGER = LoggerFactory.getLogger(HikatServerMod.class);

    public HikatServerMod(IEventBus modEventBus) {
        LOGGER.info("[HiKAT] Initializing HiKAT Server Mod");

        modEventBus.addListener(HikatServerNetworking::onRegisterPayloadHandlers);
        modEventBus.addListener(HikatServerNetworking::onRegisterConfigurationTasks);

        NeoForge.EVENT_BUS.addListener(this::onServerStarting);
        NeoForge.EVENT_BUS.addListener(this::onRegisterCommands);
    }

    private void onServerStarting(ServerStartingEvent event) {
        Path configDir = FMLPaths.CONFIGDIR.get();
        Path gameDir = FMLPaths.GAMEDIR.get();

        LOGGER.info("[HiKAT] Loading server whitelist from config...");
        HikatWhitelist.getInstance(configDir);

        LOGGER.info("[HiKAT] Loading server integrity manifest from {}...", gameDir);
        ServerIntegrityService.getInstance(gameDir);

        LOGGER.info("[HiKAT] Loading auth public keys from config...");
        HikatServerNetworking.getTokenValidator().loadKeysFromConfig(configDir);
    }

    private void onRegisterCommands(RegisterCommandsEvent event) {
        LOGGER.info("[HiKAT] Registering /hikat commands...");
        HikatCommand.register(event.getDispatcher());
    }
}
