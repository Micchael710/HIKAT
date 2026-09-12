package com.hikat.server.command;

import com.hikat.server.whitelist.HikatWhitelist;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

import java.util.Set;

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
                                            Set<String> list = wl.getAllowedUsernames();
                                            ctx.getSource().sendSuccess(() -> Component.literal(
                                                    "§6[HiKAT] Whitelist status: " + (on ? "§aON" : "§cOFF")
                                                            + " §7(" + list.size() + " players)§r\n"
                                                            + (list.isEmpty() ? "§7(empty)" : "§f" + String.join(", ", list))
                                            ), false);
                                            return 1;
                                        })
                                )
                                .then(Commands.literal("add")
                                        .then(Commands.argument("username", StringArgumentType.word())
                                                .executes(ctx -> {
                                                    String user = StringArgumentType.getString(ctx, "username");
                                                    boolean added = HikatWhitelist.getInstance().add(user);
                                                    if (added) {
                                                        ctx.getSource().sendSuccess(() -> Component.literal("§a[HiKAT] Added '" + user + "' to HiKAT whitelist."), true);
                                                    } else {
                                                        ctx.getSource().sendFailure(Component.literal("§c[HiKAT] User '" + user + "' is already on the whitelist."));
                                                    }
                                                    return added ? 1 : 0;
                                                })
                                        )
                                )
                                .then(Commands.literal("remove")
                                        .then(Commands.argument("username", StringArgumentType.word())
                                                .executes(ctx -> {
                                                    String user = StringArgumentType.getString(ctx, "username");
                                                    boolean removed = HikatWhitelist.getInstance().remove(user);
                                                    if (removed) {
                                                        ctx.getSource().sendSuccess(() -> Component.literal("§e[HiKAT] Removed '" + user + "' from HiKAT whitelist."), true);
                                                    } else {
                                                        ctx.getSource().sendFailure(Component.literal("§c[HiKAT] User '" + user + "' was not found on the whitelist."));
                                                    }
                                                    return removed ? 1 : 0;
                                                })
                                        )
                                )
                        )
        );
    }
}
