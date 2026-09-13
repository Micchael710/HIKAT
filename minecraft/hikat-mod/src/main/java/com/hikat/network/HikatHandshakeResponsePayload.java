package com.hikat.network;

import io.netty.buffer.ByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

public record HikatHandshakeResponsePayload(
        String gameToken,
        String releaseVersion,
        String integrityFingerprint,
        String integrityState,
        String locale
) implements CustomPacketPayload {
    public static final Type<HikatHandshakeResponsePayload> TYPE =
            new Type<>(ResourceLocation.fromNamespaceAndPath("hikat", "handshake_response"));

    public static final StreamCodec<ByteBuf, HikatHandshakeResponsePayload> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.STRING_UTF8, HikatHandshakeResponsePayload::gameToken,
            ByteBufCodecs.STRING_UTF8, HikatHandshakeResponsePayload::releaseVersion,
            ByteBufCodecs.STRING_UTF8, HikatHandshakeResponsePayload::integrityFingerprint,
            ByteBufCodecs.STRING_UTF8, HikatHandshakeResponsePayload::integrityState,
            ByteBufCodecs.STRING_UTF8, HikatHandshakeResponsePayload::locale,
            HikatHandshakeResponsePayload::new
    );

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
