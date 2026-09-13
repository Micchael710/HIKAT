package com.hikat.server.auth;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.AlgorithmParameters;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class TokenValidator {
    private static final Logger LOGGER = LoggerFactory.getLogger(TokenValidator.class);
    public static final String EXPECTED_ISSUER = "https://auth.hikat.org";
    public static final String EXPECTED_AUDIENCE = "hikat-minecraft";

    public enum Status {
        VALID,
        EXPIRED,
        INVALID_SIGNATURE,
        INVALID_CLAIMS,
        NO_KEY,
        MALFORMED
    }

    public record Result(Status status, GameTokenClaims claims, String message) {
        public boolean isValid() {
            return status == Status.VALID && claims != null;
        }

        public static Result valid(GameTokenClaims claims) {
            return new Result(Status.VALID, claims, "Valid token");
        }

        public static Result expired(GameTokenClaims claims) {
            return new Result(Status.EXPIRED, claims, "Token has expired");
        }

        public static Result error(Status status, String message) {
            return new Result(status, null, message);
        }
    }

    private final Map<String, PublicKey> publicKeys = new ConcurrentHashMap<>();
    private volatile PublicKey defaultPublicKey;

    public void registerKey(String kid, PublicKey publicKey) {
        if (kid != null && !kid.isBlank()) {
            publicKeys.put(kid, publicKey);
        }
        if (defaultPublicKey == null) {
            defaultPublicKey = publicKey;
        }
    }

    public void clearKeys() {
        publicKeys.clear();
        defaultPublicKey = null;
    }

    public void loadKeysFromConfig(Path configDir) {
        if (configDir == null) return;
        Path hikatDir = configDir.resolve("hikat");

        Path jwksPath = hikatDir.resolve("jwks.json");
        if (Files.exists(jwksPath)) {
            try {
                String content = Files.readString(jwksPath);
                loadJwks(content);
                LOGGER.info("[HiKAT] Loaded public keys from {}", jwksPath);
                return;
            } catch (Exception e) {
                LOGGER.error("[HiKAT] Failed to load jwks.json: {}", e.getMessage());
            }
        }

        Path pemPath = hikatDir.resolve("public-key.pem");
        if (Files.exists(pemPath)) {
            try {
                String content = Files.readString(pemPath);
                PublicKey pk = parsePemToPublicKey(content);
                registerKey("default", pk);
                LOGGER.info("[HiKAT] Loaded public key from {}", pemPath);
            } catch (Exception e) {
                LOGGER.error("[HiKAT] Failed to load public-key.pem: {}", e.getMessage());
            }
        }
    }

    public void loadJwks(String jwksJson) {
        try {
            JsonObject root = JsonParser.parseString(jwksJson).getAsJsonObject();
            if (root.has("keys") && root.get("keys").isJsonArray()) {
                JsonArray keys = root.getAsJsonArray("keys");
                for (JsonElement el : keys) {
                    if (el.isJsonObject()) {
                        JsonObject k = el.getAsJsonObject();
                        String kid = k.has("kid") ? k.get("kid").getAsString() : null;
                        PublicKey pk = parseJwkToPublicKey(k);
                        registerKey(kid, pk);
                    }
                }
            } else if (root.has("kty")) {
                String kid = root.has("kid") ? root.get("kid").getAsString() : null;
                PublicKey pk = parseJwkToPublicKey(root);
                registerKey(kid, pk);
            }
        } catch (Exception e) {
            LOGGER.error("[HiKAT] Error parsing JWKS JSON: {}", e.getMessage());
        }
    }

    public Result validate(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            return Result.error(Status.MALFORMED, "Token is missing or blank");
        }

        String[] parts = rawToken.trim().split("\\.");
        if (parts.length != 3) {
            return Result.error(Status.MALFORMED, "Invalid JWT format (expected 3 parts)");
        }

        String headerB64 = parts[0];
        String payloadB64 = parts[1];
        String signatureB64 = parts[2];

        JsonObject header;
        JsonObject payload;
        try {
            String headerJson = new String(Base64.getUrlDecoder().decode(headerB64), StandardCharsets.UTF_8);
            header = JsonParser.parseString(headerJson).getAsJsonObject();

            String payloadJson = new String(Base64.getUrlDecoder().decode(payloadB64), StandardCharsets.UTF_8);
            payload = JsonParser.parseString(payloadJson).getAsJsonObject();
        } catch (Exception e) {
            return Result.error(Status.MALFORMED, "Failed to decode JWT base64/JSON: " + e.getMessage());
        }

        // Check algorithm
        String alg = header.has("alg") ? header.get("alg").getAsString() : null;
        if (!"ES256".equalsIgnoreCase(alg)) {
            return Result.error(Status.INVALID_CLAIMS, "Unsupported algorithm: " + alg + " (expected ES256)");
        }

        // Find key
        String kid = header.has("kid") ? header.get("kid").getAsString() : null;
        PublicKey publicKey = null;
        if (kid != null) {
            publicKey = publicKeys.get(kid);
        }
        if (publicKey == null) {
            publicKey = defaultPublicKey;
        }

        if (publicKey == null) {
            return Result.error(Status.NO_KEY, "No public key found to verify token (kid=" + kid + ")");
        }

        // Verify ES256 signature
        try {
            byte[] sigBytes = Base64.getUrlDecoder().decode(signatureB64);
            Signature sig = Signature.getInstance("SHA256withECDSAinP1363Format");
            sig.initVerify(publicKey);
            sig.update((headerB64 + "." + payloadB64).getBytes(StandardCharsets.US_ASCII));
            if (!sig.verify(sigBytes)) {
                return Result.error(Status.INVALID_SIGNATURE, "ES256 signature verification failed");
            }
        } catch (Exception e) {
            return Result.error(Status.INVALID_SIGNATURE, "Signature verification error: " + e.getMessage());
        }

        // Parse and validate claims
        try {
            String subStr = payload.has("sub") ? payload.get("sub").getAsString() : null;
            if (subStr == null || subStr.isBlank()) {
                return Result.error(Status.INVALID_CLAIMS, "Missing sub claim");
            }
            UUID uuid;
            try {
                uuid = UUID.fromString(subStr);
            } catch (IllegalArgumentException e) {
                return Result.error(Status.INVALID_CLAIMS, "sub claim is not a valid UUID: " + subStr);
            }

            String displayName = payload.has("displayName") && !payload.get("displayName").isJsonNull()
                    ? payload.get("displayName").getAsString().trim()
                    : null;
            if (displayName == null || displayName.isEmpty()) {
                return Result.error(Status.INVALID_CLAIMS, "Missing or empty displayName claim");
            }

            String iss = payload.has("iss") ? payload.get("iss").getAsString().trim() : "";
            if (!EXPECTED_ISSUER.equals(iss)) {
                return Result.error(Status.INVALID_CLAIMS, "Invalid issuer: " + iss + " (expected " + EXPECTED_ISSUER + ")");
            }

            String aud = payload.has("aud") ? payload.get("aud").getAsString() : "";
            if (!EXPECTED_AUDIENCE.equals(aud)) {
                return Result.error(Status.INVALID_CLAIMS, "Invalid audience: " + aud + " (expected " + EXPECTED_AUDIENCE + ")");
            }

            long exp = payload.has("exp") ? payload.get("exp").getAsLong() : 0L;
            long iat = payload.has("iat") ? payload.get("iat").getAsLong() : 0L;
            String role = payload.has("role") ? payload.get("role").getAsString() : "PLAYER";
            String sid = payload.has("sid") ? payload.get("sid").getAsString() : "";

            GameTokenClaims claims = new GameTokenClaims(
                    uuid,
                    displayName,
                    role,
                    sid,
                    iss,
                    aud,
                    exp,
                    iat,
                    kid
            );

            if (claims.isExpired()) {
                return Result.expired(claims);
            }

            return Result.valid(claims);
        } catch (Exception e) {
            return Result.error(Status.INVALID_CLAIMS, "Failed to parse claims: " + e.getMessage());
        }
    }

    public static PublicKey parseJwkToPublicKey(JsonObject jwk) throws Exception {
        String crv = jwk.has("crv") ? jwk.get("crv").getAsString() : "P-256";
        if (!"P-256".equals(crv) && !"secp256r1".equals(crv)) {
            throw new IllegalArgumentException("Unsupported curve: " + crv);
        }

        byte[] xBytes = Base64.getUrlDecoder().decode(jwk.get("x").getAsString());
        byte[] yBytes = Base64.getUrlDecoder().decode(jwk.get("y").getAsString());

        BigInteger x = new BigInteger(1, xBytes);
        BigInteger y = new BigInteger(1, yBytes);
        ECPoint point = new ECPoint(x, y);

        AlgorithmParameters params = AlgorithmParameters.getInstance("EC");
        params.init(new ECGenParameterSpec("secp256r1"));
        ECParameterSpec ecParameters = params.getParameterSpec(ECParameterSpec.class);

        ECPublicKeySpec keySpec = new ECPublicKeySpec(point, ecParameters);
        KeyFactory kf = KeyFactory.getInstance("EC");
        return kf.generatePublic(keySpec);
    }

    public static PublicKey parsePemToPublicKey(String pem) throws Exception {
        String clean = pem.replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s+", "");
        byte[] der = Base64.getDecoder().decode(clean);
        KeyFactory kf = KeyFactory.getInstance("EC");
        return kf.generatePublic(new X509EncodedKeySpec(der));
    }
}
