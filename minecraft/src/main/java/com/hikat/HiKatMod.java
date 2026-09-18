package com.hikat;

import com.hikat.client.IntegrityWatcher;
import com.hikat.client.SessionReader;
import com.hikat.network.HiKatProtocol;
import com.hikat.server.ConnectionGate;
import com.hikat.server.GameTokenVerifier;
import com.hikat.server.HiKatWhitelist;
import com.hikat.server.IntegrityService;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.logging.LogUtils;
import org.slf4j.Logger;
import java.io.IOException;
import java.nio.file.Path;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLLoader;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.network.event.RegisterConfigurationTasksEvent;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;

@Mod("hikat")
public class HiKatMod {
    public static final String MODID = "hikat";
    private static final Logger LOGGER = LogUtils.getLogger();

    private static ConnectionGate connectionGate;
    private static SessionReader.ClientSnapshot clientSnapshot;
    private static IntegrityWatcher integrityWatcher;

    public HiKatMod(IEventBus modEventBus) {
        modEventBus.addListener(this::registerPayloads);

        if (FMLLoader.getDist() == Dist.DEDICATED_SERVER) {
            initServer();
            modEventBus.addListener(this::registerConfigurationTasks);
            NeoForge.EVENT_BUS.addListener(this::registerCommands);
        } else {
            NeoForge.EVENT_BUS.register(ClientEvents.class);
        }
    }

    private void initServer() {
        Path serverRoot = FMLPaths.GAMEDIR.get();
        String jwksUrl = System.getProperty("hikat.jwks.url", "https://auth.hikat.org/.well-known/jwks.json");
        GameTokenVerifier tokenVerifier = new GameTokenVerifier("hikat-minecraft", jwksUrl, null);
        IntegrityService integrityService = new IntegrityService(serverRoot);
        HiKatWhitelist whitelist = new HiKatWhitelist(serverRoot);
        connectionGate = new ConnectionGate(tokenVerifier, integrityService, whitelist);
    }

    private void registerPayloads(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar registrar = event.registrar("1.0.0");

        registrar.configurationToClient(
            HiKatProtocol.AuthRequestPayload.TYPE,
            HiKatProtocol.AuthRequestPayload.STREAM_CODEC,
            (payload, context) -> {
                context.enqueueWork(() -> {
                    try {
                        Path gameDir = FMLPaths.GAMEDIR.get();
                        clientSnapshot = SessionReader.loadSnapshot(gameDir);
                        context.reply(new HiKatProtocol.AuthResponsePayload(
                            clientSnapshot.sessionData().gameToken(),
                            clientSnapshot.sessionData().releaseId(),
                            clientSnapshot.fingerprint()
                        ));
                    } catch (Exception e) {
                        System.err.println("[HiKAT] Authentication error loading session: " + e.getMessage());
                        context.disconnect(Component.translatable("disconnect.hikat.auth_failed"));
                    }
                });
            }
        );

        registrar.configurationToServer(
            HiKatProtocol.AuthResponsePayload.TYPE,
            HiKatProtocol.AuthResponsePayload.STREAM_CODEC,
            (payload, context) -> {
                context.enqueueWork(() -> {
                    if (connectionGate != null && context.listener() instanceof ServerConfigurationPacketListenerImpl serverListener) {
                        connectionGate.handleAuthResponse(serverListener, payload, () -> {
                            context.finishCurrentTask(ConnectionGate.AuthConfigurationTask.TYPE);
                        });
                    }
                });
            }
        );

        registrar.playToServer(
            HiKatProtocol.IntegrityUpdatePayload.TYPE,
            HiKatProtocol.IntegrityUpdatePayload.STREAM_CODEC,
            (payload, context) -> {
                context.enqueueWork(() -> {
                    if (connectionGate != null) {
                        connectionGate.handleIntegrityUpdate(
                            reason -> context.disconnect(reason),
                            payload
                        );
                    }
                });
            }
        );
    }

    private void registerConfigurationTasks(RegisterConfigurationTasksEvent event) {
        event.register(new ConnectionGate.AuthConfigurationTask());
    }

    private void registerCommands(RegisterCommandsEvent event) {
        CommandDispatcher<CommandSourceStack> dispatcher = event.getDispatcher();
        dispatcher.register(
            Commands.literal("hikat")
                .requires(source -> source.hasPermission(3))
                .then(Commands.literal("whitelist")
                    .then(Commands.literal("on").executes(ctx -> {
                        try {
                            connectionGate.getWhitelist().setEnabled(true);
                            ctx.getSource().sendSuccess(() -> Component.translatable("command.hikat.whitelist.enabled"), true);
                        } catch (IOException e) {
                            System.err.println("[HiKAT] Failed to enable whitelist: " + e.getMessage());
                            ctx.getSource().sendFailure(Component.translatable("command.hikat.whitelist.save_error"));
                        }
                        return 1;
                    }))
                    .then(Commands.literal("off").executes(ctx -> {
                        try {
                            connectionGate.getWhitelist().setEnabled(false);
                            ctx.getSource().sendSuccess(() -> Component.translatable("command.hikat.whitelist.disabled"), true);
                        } catch (IOException e) {
                            System.err.println("[HiKAT] Failed to disable whitelist: " + e.getMessage());
                            ctx.getSource().sendFailure(Component.translatable("command.hikat.whitelist.save_error"));
                        }
                        return 1;
                    }))
                    .then(Commands.literal("add")
                        .then(Commands.argument("displayName", StringArgumentType.string())
                            .executes(ctx -> {
                                String displayName = StringArgumentType.getString(ctx, "displayName");
                                try {
                                    boolean added = connectionGate.getWhitelist().add(displayName);
                                    if (added) {
                                        ctx.getSource().sendSuccess(() -> Component.translatable("command.hikat.whitelist.added", displayName), true);
                                    } else {
                                        ctx.getSource().sendFailure(Component.translatable("command.hikat.whitelist.already_added", displayName));
                                    }
                                } catch (IOException e) {
                                    System.err.println("[HiKAT] Error saving whitelist: " + e.getMessage());
                                    ctx.getSource().sendFailure(Component.translatable("command.hikat.whitelist.save_error"));
                                }
                                return 1;
                            })
                        )
                    )
                    .then(Commands.literal("remove")
                        .then(Commands.argument("displayName", StringArgumentType.string())
                            .executes(ctx -> {
                                String displayName = StringArgumentType.getString(ctx, "displayName");
                                try {
                                    boolean removed = connectionGate.getWhitelist().remove(displayName);
                                    if (removed) {
                                        ctx.getSource().sendSuccess(() -> Component.translatable("command.hikat.whitelist.removed", displayName), true);
                                    } else {
                                        ctx.getSource().sendFailure(Component.translatable("command.hikat.whitelist.not_found", displayName));
                                    }
                                } catch (IOException e) {
                                    System.err.println("[HiKAT] Error saving whitelist: " + e.getMessage());
                                    ctx.getSource().sendFailure(Component.translatable("command.hikat.whitelist.save_error"));
                                }
                                return 1;
                            })
                        )
                    )
                    .then(Commands.literal("list").executes(ctx -> {
                        var entries = connectionGate.getWhitelist().getEntries();
                        boolean enabled = connectionGate.getWhitelist().isEnabled();
                        ctx.getSource().sendSuccess(() -> Component.translatable(
                            enabled ? "command.hikat.whitelist.list.status_on" : "command.hikat.whitelist.list.status_off"
                        ), false);

                        java.util.List<String> visibleNames = new java.util.ArrayList<>();
                        for (var entry : entries) {
                            if (entry.displayName() != null && !entry.displayName().isBlank()) {
                                visibleNames.add(entry.displayName());
                            }
                        }

                        ctx.getSource().sendSuccess(() -> Component.translatable(
                            "command.hikat.whitelist.list.count", visibleNames.size()
                        ), false);

                        for (String name : visibleNames) {
                            ctx.getSource().sendSuccess(() -> Component.translatable(
                                "command.hikat.whitelist.list.entry", name
                            ), false);
                        }
                        return entries.size();
                    }))
                )
                .then(Commands.literal("reload").executes(ctx -> {
                    connectionGate.getWhitelist().load();
                    connectionGate.getTokenVerifier().refreshJwks();
                    ctx.getSource().sendSuccess(() -> Component.translatable("command.hikat.reload.success"), true);
                    return 1;
                }))
        );
    }

    public static class ClientEvents {
        @SubscribeEvent
        public static void onLoggingIn(ClientPlayerNetworkEvent.LoggingIn event) {
            var player = event.getPlayer();
            var connection = player.connection;

            LOGGER.info("[HiKAT DEBUG] player UUID = {}", player.getUUID());

            LOGGER.info(
                "[HiKAT DEBUG] player GameProfile UUID = {}",
                player.getGameProfile().getId()
            );

            LOGGER.info(
                "[HiKAT DEBUG] localGameProfile UUID = {}",
                connection.getLocalGameProfile().getId()
            );

            var info = connection.getListedOnlinePlayers().stream()
                .filter(p -> "vBrayan06".equalsIgnoreCase(p.getProfile().getName()))
                .findFirst()
                .orElse(null);

            LOGGER.info(
                "[HiKAT DEBUG] PlayerInfo UUID = {}",
                info != null ? info.getProfile().getId() : "NULL"
            );

            LOGGER.info(
                "[HiKAT DEBUG] PlayerInfo name = {}",
                info != null ? info.getProfile().getName() : "NULL"
            );

            if (clientSnapshot != null) {
                try {
                    Path gameDir = FMLPaths.GAMEDIR.get();
                    integrityWatcher = new IntegrityWatcher(
                        gameDir,
                        clientSnapshot.sessionData(),
                        clientSnapshot.fileHashes(),
                        clientSnapshot.fingerprint(),
                        newFingerprint -> {
                            event.getPlayer().connection.send(
                                new net.minecraft.network.protocol.common.ServerboundCustomPayloadPacket(
                                    new HiKatProtocol.IntegrityUpdatePayload(
                                        clientSnapshot.sessionData().releaseId(),
                                        newFingerprint
                                    )
                                )
                            );
                        }
                    );
                    integrityWatcher.start();
                } catch (Exception e) {
                    System.err.println("[HiKAT] Could not start IntegrityWatcher: " + e.getMessage());
                }
            }
        }

        @SubscribeEvent
        public static void onLoggingOut(ClientPlayerNetworkEvent.LoggingOut event) {
            if (integrityWatcher != null) {
                integrityWatcher.stop();
                integrityWatcher = null;
            }
            clientSnapshot = null;
        }
    }
}
