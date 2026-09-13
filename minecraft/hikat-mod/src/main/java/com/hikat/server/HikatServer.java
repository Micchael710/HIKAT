package com.hikat.server;

import com.hikat.server.command.HikatCommand;
import com.hikat.server.integrity.ServerIntegrityService;
import com.hikat.server.network.HikatServerNetworking;
import com.hikat.server.whitelist.HikatWhitelist;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;

public class HikatServer {
    private static final Logger LOGGER = LoggerFactory.getLogger(HikatServer.class);

    public static void onServerStarting(ServerStartingEvent event) {
        Path configDir = FMLPaths.CONFIGDIR.get();
        Path gameDir = FMLPaths.GAMEDIR.get();

        LOGGER.info("[HiKAT] Loading server whitelist from config...");
        HikatWhitelist.getInstance(configDir);

        LOGGER.info("[HiKAT] Loading server integrity manifest from {}...", gameDir);
        ServerIntegrityService.getInstance(gameDir);

        LOGGER.info("[HiKAT] Loading auth public keys from config...");
        HikatServerNetworking.getTokenValidator().loadKeysFromConfig(configDir);
    }

    public static void onRegisterCommands(RegisterCommandsEvent event) {
        LOGGER.info("[HiKAT] Registering /hikat commands...");
        HikatCommand.register(event.getDispatcher());
    }
}
