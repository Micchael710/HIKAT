package com.hikat.server.network;

import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.server.network.ConfigurationTask;
import net.neoforged.neoforge.network.configuration.ICustomConfigurationTask;

import java.util.UUID;
import java.util.function.Consumer;

public class HikatConfigurationTask implements ICustomConfigurationTask {
    public static final ConfigurationTask.Type TYPE = new ConfigurationTask.Type("hikat:auth");

    @Override
    public ConfigurationTask.Type type() {
        return TYPE;
    }

    @Override
    public void run(Consumer<CustomPacketPayload> sender) {
        sender.accept(new HikatHandshakeRequestPayload(UUID.randomUUID().toString()));
    }
}
