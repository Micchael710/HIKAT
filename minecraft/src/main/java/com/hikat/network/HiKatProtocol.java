package com.hikat.network;

import io.netty.buffer.ByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

public final class HiKatProtocol {
    private HiKatProtocol() {}

    public static final String VERSION = "1.0.0";

    public record AuthRequestPayload(String serverId) implements CustomPacketPayload {
        public static final CustomPacketPayload.Type<AuthRequestPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath("hikat", "auth_request"));

        public static final StreamCodec<ByteBuf, AuthRequestPayload> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.stringUtf8(32767), AuthRequestPayload::serverId,
            AuthRequestPayload::new
        );

        @Override
        public CustomPacketPayload.Type<AuthRequestPayload> type() {
            return TYPE;
        }
    }

    public record AuthResponsePayload(String gameToken, String releaseId, String actualFingerprint) implements CustomPacketPayload {
        public static final CustomPacketPayload.Type<AuthResponsePayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath("hikat", "auth_response"));

        public static final StreamCodec<ByteBuf, AuthResponsePayload> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.stringUtf8(32767), AuthResponsePayload::gameToken,
            ByteBufCodecs.stringUtf8(32767), AuthResponsePayload::releaseId,
            ByteBufCodecs.stringUtf8(32767), AuthResponsePayload::actualFingerprint,
            AuthResponsePayload::new
        );

        @Override
        public CustomPacketPayload.Type<AuthResponsePayload> type() {
            return TYPE;
        }
    }

    public record IntegrityUpdatePayload(String releaseId, String actualFingerprint) implements CustomPacketPayload {
        public static final CustomPacketPayload.Type<IntegrityUpdatePayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath("hikat", "integrity_update"));

        public static final StreamCodec<ByteBuf, IntegrityUpdatePayload> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.stringUtf8(32767), IntegrityUpdatePayload::releaseId,
            ByteBufCodecs.stringUtf8(32767), IntegrityUpdatePayload::actualFingerprint,
            IntegrityUpdatePayload::new
        );

        @Override
        public CustomPacketPayload.Type<IntegrityUpdatePayload> type() {
            return TYPE;
        }
    }
}
