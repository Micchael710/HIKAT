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
                        context.disconnect(Component.literal("HiKAT Authentication Error: " + e.getMessage()));
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
                            ctx.getSource().sendSuccess(() -> Component.literal("HiKAT whitelist ENABLED"), true);
                        } catch (IOException e) {
                            ctx.getSource().sendFailure(Component.literal("Failed to enable whitelist: " + e.getMessage()));
                        }
                        return 1;
                    }))
                    .then(Commands.literal("off").executes(ctx -> {
                        try {
                            connectionGate.getWhitelist().setEnabled(false);
                            ctx.getSource().sendSuccess(() -> Component.literal("HiKAT whitelist DISABLED"), true);
                        } catch (IOException e) {
                            ctx.getSource().sendFailure(Component.literal("Failed to disable whitelist: " + e.getMessage()));
                        }
                        return 1;
                    }))
                    .then(Commands.literal("add")
                        .then(Commands.argument("userId", StringArgumentType.string())
                            .then(Commands.argument("displayName", StringArgumentType.string())
                                .executes(ctx -> {
                                    String userId = StringArgumentType.getString(ctx, "userId");
                                    String displayName = StringArgumentType.getString(ctx, "displayName");
                                    try {
                                        boolean added = connectionGate.getWhitelist().add(userId, displayName);
                                        if (added) {
                                            ctx.getSource().sendSuccess(() -> Component.literal("Added " + displayName + " (" + userId + ") to HiKAT whitelist"), true);
                                        } else {
                                            ctx.getSource().sendFailure(Component.literal("Player " + userId + " already in whitelist"));
                                        }
                                    } catch (IOException e) {
                                        ctx.getSource().sendFailure(Component.literal("Error saving whitelist: " + e.getMessage()));
                                    }
                                    return 1;
                                })
                            )
                        )
                    )
                    .then(Commands.literal("remove")
                        .then(Commands.argument("userId", StringArgumentType.string())
                            .executes(ctx -> {
                                String userId = StringArgumentType.getString(ctx, "userId");
                                try {
                                    boolean removed = connectionGate.getWhitelist().remove(userId);
                                    if (removed) {
                                        ctx.getSource().sendSuccess(() -> Component.literal("Removed " + userId + " from HiKAT whitelist"), true);
                                    } else {
                                        ctx.getSource().sendFailure(Component.literal("Player " + userId + " not found in whitelist"));
                                    }
                                } catch (IOException e) {
                                    ctx.getSource().sendFailure(Component.literal("Error saving whitelist: " + e.getMessage()));
                                }
                                return 1;
                            })
                        )
                    )
                    .then(Commands.literal("list").executes(ctx -> {
                        var entries = connectionGate.getWhitelist().getEntries();
                        boolean enabled = connectionGate.getWhitelist().isEnabled();
                        ctx.getSource().sendSuccess(() -> Component.literal("HiKAT Whitelist (enabled: " + enabled + ", total: " + entries.size() + "):"), false);
                        for (var entry : entries) {
                            ctx.getSource().sendSuccess(() -> Component.literal(" - " + entry.displayName() + " [" + entry.userId() + "] (added: " + entry.addedAt() + ")"), false);
                        }
                        return entries.size();
                    }))
                )
                .then(Commands.literal("reload").executes(ctx -> {
                    connectionGate.getWhitelist().load();
                    connectionGate.getTokenVerifier().refreshJwks();
                    ctx.getSource().sendSuccess(() -> Component.literal("HiKAT server configuration reloaded"), true);
                    return 1;
                }))
        );
    }

    public static class ClientEvents {
        @SubscribeEvent
        public static void onLoggingIn(ClientPlayerNetworkEvent.LoggingIn event) {
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
