package com.hikat.client.network;

import io.netty.buffer.ByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

public record HikatHandshakeRequestPayload(String serverNonce) implements CustomPacketPayload {
    public static final Type<HikatHandshakeRequestPayload> TYPE =
            new Type<>(ResourceLocation.fromNamespaceAndPath("hikat", "handshake_request"));

    public static final StreamCodec<ByteBuf, HikatHandshakeRequestPayload> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.STRING_UTF8, HikatHandshakeRequestPayload::serverNonce,
            HikatHandshakeRequestPayload::new
    );

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
