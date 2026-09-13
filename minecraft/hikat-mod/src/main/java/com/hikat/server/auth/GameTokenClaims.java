package com.hikat.server.auth;

import java.util.UUID;

public record GameTokenClaims(
        UUID sub,
        String displayName,
        String role,
        String sessionId,
        String issuer,
        String audience,
        long expirationTime,
        long issuedAt,
        String keyId
) {
    public boolean isExpired() {
        long nowSeconds = System.currentTimeMillis() / 1000L;
        return nowSeconds >= expirationTime;
    }
}
