package com.hikat.server;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.ECDSAVerifier;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.io.InputStream;
import java.net.URI;
import java.util.Date;
import java.util.List;

public class GameTokenVerifier {
    public record VerifiedClaims(String sub, String displayName, String role) {}

    private final String expectedAudience;
    private final String jwksUrl;
    private JWKSet jwkSet;

    public GameTokenVerifier(String expectedAudience, String jwksUrl, JWKSet initialJwkSet) {
        this.expectedAudience = expectedAudience != null ? expectedAudience : "hikat-minecraft";
        this.jwksUrl = jwksUrl;
        this.jwkSet = initialJwkSet;
    }

    public synchronized void setJwkSet(JWKSet jwkSet) {
        this.jwkSet = jwkSet;
    }

    public synchronized void refreshJwks() {
        if (jwksUrl == null || jwksUrl.isBlank()) return;
        try (InputStream is = URI.create(jwksUrl).toURL().openStream()) {
            this.jwkSet = JWKSet.load(is);
        } catch (Exception e) {
            System.err.println("[HiKAT] Failed to refresh JWKS from " + jwksUrl + ": " + e.getMessage());
        }
    }

    public static final String EXPECTED_ISSUER = "https://auth.hikat.org";

    public VerifiedClaims verify(String token) throws Exception {
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("Token is missing");
        }

        SignedJWT signedJWT = SignedJWT.parse(token);

        if (!JWSAlgorithm.ES256.equals(signedJWT.getHeader().getAlgorithm())) {
            throw new SecurityException("Unsupported algorithm: " + signedJWT.getHeader().getAlgorithm());
        }

        String kid = signedJWT.getHeader().getKeyID();
        JWK key = findKey(kid);
        if (key == null && jwksUrl != null) {
            refreshJwks();
            key = findKey(kid);
        }

        if (key == null) {
            throw new SecurityException("Unknown signing key id (kid): " + kid);
        }

        if (!(key instanceof ECKey ecKey)) {
            throw new SecurityException("Signing key is not an EC key");
        }

        ECDSAVerifier verifier = new ECDSAVerifier(ecKey.toECPublicKey());
        if (!signedJWT.verify(verifier)) {
            throw new SecurityException("Invalid JWT signature");
        }

        JWTClaimsSet claims = signedJWT.getJWTClaimsSet();

        String issuer = claims.getIssuer();
        if (issuer == null || !EXPECTED_ISSUER.equals(issuer)) {
            throw new SecurityException("Invalid or missing issuer: " + issuer);
        }

        List<String> audience = claims.getAudience();
        if (audience == null || !audience.contains(expectedAudience)) {
            throw new SecurityException("Invalid audience: " + audience + ", expected: " + expectedAudience);
        }

        Date expirationTime = claims.getExpirationTime();
        if (expirationTime == null || new Date(System.currentTimeMillis() - 30000).after(expirationTime)) {
            throw new SecurityException("Token is expired");
        }

        String sub = claims.getSubject();
        if (sub == null || sub.isBlank()) {
            throw new SecurityException("Token missing subject (sub)");
        }

        String displayName = claims.getStringClaim("displayName");
        if (displayName == null || displayName.isBlank()) {
            throw new SecurityException("Token missing displayName claim");
        }

        String role = claims.getStringClaim("role");
        return new VerifiedClaims(sub, displayName, role != null ? role : "PLAYER");
    }

    private synchronized JWK findKey(String kid) {
        if (jwkSet == null) return null;
        if (kid == null) {
            List<JWK> keys = jwkSet.getKeys();
            return keys.isEmpty() ? null : keys.get(0);
        }
        return jwkSet.getKeyByKeyId(kid);
    }
}
