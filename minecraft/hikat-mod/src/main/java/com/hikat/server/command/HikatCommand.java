package com.hikat.server.command;

import com.hikat.server.whitelist.HikatWhitelist;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public class HikatCommand {

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(
                Commands.literal("hikat")
                        .requires(source -> source.hasPermission(2))
                        .then(Commands.literal("whitelist")
                                .then(Commands.literal("on")
                                        .executes(ctx -> {
                                            HikatWhitelist.getInstance().setEnabled(true);
                                            ctx.getSource().sendSuccess(() -> Component.literal("§a[HiKAT] Whitelist is now ON."), true);
                                            return 1;
                                        })
                                )
                                .then(Commands.literal("off")
                                        .executes(ctx -> {
                                            HikatWhitelist.getInstance().setEnabled(false);
                                            ctx.getSource().sendSuccess(() -> Component.literal("§e[HiKAT] Whitelist is now OFF."), true);
                                            return 1;
                                        })
                                )
                                .then(Commands.literal("list")
                                        .executes(ctx -> {
                                            HikatWhitelist wl = HikatWhitelist.getInstance();
                                            boolean on = wl.isEnabled();
                                            Set<UUID> list = wl.getAllowedUuids();
                                            List<String> formatted = new ArrayList<>();
                                            for (UUID u : list) {
                                                String name = wl.getDisplayName(u);
                                                if (name != null) {
                                                    formatted.add(name + " (" + u + ")");
                                                } else {
                                                    formatted.add(u.toString());
                                                }
                                            }
                                            ctx.getSource().sendSuccess(() -> Component.literal(
                                                    "§6[HiKAT] Whitelist status: " + (on ? "§aON" : "§cOFF")
                                                            + " §7(" + list.size() + " players)§r\n"
                                                            + (formatted.isEmpty() ? "§7(empty)" : "§f" + String.join(", ", formatted))
                                            ), false);
                                            return 1;
                                        })
                                )
                                .then(Commands.literal("add")
                                        .then(Commands.argument("username", StringArgumentType.word())
                                                .executes(ctx -> {
                                                    String user = StringArgumentType.getString(ctx, "username");
                                                    HikatWhitelist wl = HikatWhitelist.getInstance();
                                                    UUID uuid = wl.findKnownUuid(user);
                                                    if (uuid == null) {
                                                        ctx.getSource().sendFailure(Component.literal("§c[HiKAT] Player '" + user + "' is not known. Player must authenticate with HiKAT first."));
                                                        return 0;
                                                    }
                                                    boolean added = wl.add(uuid);
                                                    String display = wl.getDisplayName(uuid);
                                                    String label = display != null ? display + " (" + uuid + ")" : uuid.toString();
                                                    if (added) {
                                                        ctx.getSource().sendSuccess(() -> Component.literal("§a[HiKAT] Added '" + label + "' to HiKAT whitelist."), true);
                                                    } else {
                                                        ctx.getSource().sendFailure(Component.literal("§c[HiKAT] Player '" + label + "' is already on the whitelist."));
                                                    }
                                                    return added ? 1 : 0;
                                                })
                                        )
                                )
                                .then(Commands.literal("remove")
                                        .then(Commands.argument("username", StringArgumentType.word())
                                                .executes(ctx -> {
                                                    String user = StringArgumentType.getString(ctx, "username");
                                                    HikatWhitelist wl = HikatWhitelist.getInstance();
                                                    UUID uuid = wl.findKnownUuid(user);
                                                    if (uuid == null) {
                                                        ctx.getSource().sendFailure(Component.literal("§c[HiKAT] Player '" + user + "' was not found or is not known."));
                                                        return 0;
                                                    }
                                                    boolean removed = wl.remove(uuid);
                                                    String display = wl.getDisplayName(uuid);
                                                    String label = display != null ? display + " (" + uuid + ")" : uuid.toString();
                                                    if (removed) {
                                                        ctx.getSource().sendSuccess(() -> Component.literal("§e[HiKAT] Removed '" + label + "' from HiKAT whitelist."), true);
                                                    } else {
                                                        ctx.getSource().sendFailure(Component.literal("§c[HiKAT] Player '" + label + "' was not on the whitelist."));
                                                    }
                                                    return removed ? 1 : 0;
                                                })
                                        )
                                )
                        )
        );
    }
}
