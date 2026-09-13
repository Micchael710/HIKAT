package com.hikat.server.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

public class TokenValidatorTest {

    private KeyPair keyPair;
    private TokenValidator validator;

    @BeforeEach
    void setUp() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("EC");
        kpg.initialize(new ECGenParameterSpec("secp256r1"));
        keyPair = kpg.generateKeyPair();

        validator = new TokenValidator();
        validator.registerKey("test-key-1", keyPair.getPublic());
    }

    private String createJwt(String sub, String displayName, String iss, String aud, long exp, KeyPair signer) throws Exception {
        String headerJson = "{\"alg\":\"ES256\",\"typ\":\"JWT\",\"kid\":\"test-key-1\"}";
        String payloadJson = String.format(
                "{\"sub\":\"%s\",\"displayName\":\"%s\",\"iss\":\"%s\",\"aud\":\"%s\",\"exp\":%d,\"role\":\"PLAYER\"}",
                sub, displayName, iss, aud, exp
        );

        String b64Header = Base64.getUrlEncoder().withoutPadding().encodeToString(headerJson.getBytes(StandardCharsets.UTF_8));
        String b64Payload = Base64.getUrlEncoder().withoutPadding().encodeToString(payloadJson.getBytes(StandardCharsets.UTF_8));
        String signingInput = b64Header + "." + b64Payload;

        Signature sig = Signature.getInstance("SHA256withECDSAinP1363Format");
        sig.initSign(signer.getPrivate());
        sig.update(signingInput.getBytes(StandardCharsets.US_ASCII));
        byte[] signatureBytes = sig.sign();

        String b64Sig = Base64.getUrlEncoder().withoutPadding().encodeToString(signatureBytes);
        return signingInput + "." + b64Sig;
    }

    @Test
    void testValidToken() throws Exception {
        UUID expectedUuid = UUID.randomUUID();
        long now = System.currentTimeMillis() / 1000L;
        String token = createJwt(
                expectedUuid.toString(),
                "HiKATPlayer",
                "https://auth.hikat.org",
                "hikat-minecraft",
                now + 300,
                keyPair
        );

        TokenValidator.Result result = validator.validate(token);
        assertTrue(result.isValid());
        assertEquals(TokenValidator.Status.VALID, result.status());
        assertNotNull(result.claims());
        assertEquals(expectedUuid, result.claims().sub());
        assertEquals("HiKATPlayer", result.claims().displayName());
        assertEquals("https://auth.hikat.org", result.claims().issuer());
    }

    @Test
    void testExpiredToken() throws Exception {
        UUID expectedUuid = UUID.randomUUID();
        long past = (System.currentTimeMillis() / 1000L) - 100;
        String token = createJwt(
                expectedUuid.toString(),
                "HiKATPlayer",
                "https://auth.hikat.org",
                "hikat-minecraft",
                past,
                keyPair
        );

        TokenValidator.Result result = validator.validate(token);
        assertFalse(result.isValid());
        assertEquals(TokenValidator.Status.EXPIRED, result.status());
        assertNotNull(result.claims());
        assertEquals("HiKATPlayer", result.claims().displayName());
    }

    @Test
    void testInvalidSignature() throws Exception {
        KeyPair otherKeys = KeyPairGenerator.getInstance("EC").generateKeyPair();
        long now = System.currentTimeMillis() / 1000L;
        String token = createJwt(
                UUID.randomUUID().toString(),
                "Impostor",
                "https://auth.hikat.org",
                "hikat-minecraft",
                now + 300,
                otherKeys
        );

        TokenValidator.Result result = validator.validate(token);
        assertFalse(result.isValid());
        assertEquals(TokenValidator.Status.INVALID_SIGNATURE, result.status());
    }

    @Test
    void testInvalidAudience() throws Exception {
        long now = System.currentTimeMillis() / 1000L;
        String token = createJwt(
                UUID.randomUUID().toString(),
                "HiKATPlayer",
                "https://auth.hikat.org",
                "wrong-audience",
                now + 300,
                keyPair
        );

        TokenValidator.Result result = validator.validate(token);
        assertFalse(result.isValid());
        assertEquals(TokenValidator.Status.INVALID_CLAIMS, result.status());
    }

    @Test
    void testIssuerValidationExactMatch() throws Exception {
        long now = System.currentTimeMillis() / 1000L;
        String validToken = createJwt(
                UUID.randomUUID().toString(),
                "HiKATPlayer",
                "https://auth.hikat.org",
                "hikat-minecraft",
                now + 300,
                keyPair
        );
        TokenValidator.Result validRes = validator.validate(validToken);
        assertTrue(validRes.isValid());

        // Lookalike issuer
        String fakeToken = createJwt(
                UUID.randomUUID().toString(),
                "HiKATPlayer",
                "https://fake-hikat.org",
                "hikat-minecraft",
                now + 300,
                keyPair
        );
        TokenValidator.Result fakeRes = validator.validate(fakeToken);
        assertFalse(fakeRes.isValid());
        assertEquals(TokenValidator.Status.INVALID_CLAIMS, fakeRes.status());

        // Subdomain / path lookalike
        String evilToken = createJwt(
                UUID.randomUUID().toString(),
                "HiKATPlayer",
                "https://auth.hikat.org.attacker.com",
                "hikat-minecraft",
                now + 300,
                keyPair
        );
        TokenValidator.Result evilRes = validator.validate(evilToken);
        assertFalse(evilRes.isValid());
        assertEquals(TokenValidator.Status.INVALID_CLAIMS, evilRes.status());
    }

    @Test
    void testInvalidSubUuid() throws Exception {
        long now = System.currentTimeMillis() / 1000L;
        String token = createJwt(
                "not-a-uuid",
                "HiKATPlayer",
                "https://auth.hikat.org",
                "hikat-minecraft",
                now + 300,
                keyPair
        );

        TokenValidator.Result result = validator.validate(token);
        assertFalse(result.isValid());
        assertEquals(TokenValidator.Status.INVALID_CLAIMS, result.status());
    }

    @Test
    void testLoadJwksFormat() throws Exception {
        ECPublicKey ecPub = (ECPublicKey) keyPair.getPublic();
        byte[] xBytes = ecPub.getW().getAffineX().toByteArray();
        byte[] yBytes = ecPub.getW().getAffineY().toByteArray();

        // Ensure 32 bytes
        byte[] x32 = new byte[32];
        byte[] y32 = new byte[32];
        System.arraycopy(xBytes, Math.max(0, xBytes.length - 32), x32, Math.max(0, 32 - xBytes.length), Math.min(32, xBytes.length));
        System.arraycopy(yBytes, Math.max(0, yBytes.length - 32), y32, Math.max(0, 32 - yBytes.length), Math.min(32, yBytes.length));

        String b64x = Base64.getUrlEncoder().withoutPadding().encodeToString(x32);
        String b64y = Base64.getUrlEncoder().withoutPadding().encodeToString(y32);

        String jwks = String.format(
                "{\"keys\":[{\"kty\":\"EC\",\"crv\":\"P-256\",\"kid\":\"jwk-key-1\",\"x\":\"%s\",\"y\":\"%s\"}]}",
                b64x, b64y
        );

        TokenValidator jwksValidator = new TokenValidator();
        jwksValidator.loadJwks(jwks);

        UUID expectedUuid = UUID.randomUUID();
        long now = System.currentTimeMillis() / 1000L;

        String headerJson = "{\"alg\":\"ES256\",\"typ\":\"JWT\",\"kid\":\"jwk-key-1\"}";
        String payloadJson = String.format(
                "{\"sub\":\"%s\",\"displayName\":\"JwkUser\",\"iss\":\"https://auth.hikat.org\",\"aud\":\"hikat-minecraft\",\"exp\":%d}",
                expectedUuid, now + 300
        );
        String b64Header = Base64.getUrlEncoder().withoutPadding().encodeToString(headerJson.getBytes(StandardCharsets.UTF_8));
        String b64Payload = Base64.getUrlEncoder().withoutPadding().encodeToString(payloadJson.getBytes(StandardCharsets.UTF_8));
        String signingInput = b64Header + "." + b64Payload;

        Signature sig = Signature.getInstance("SHA256withECDSAinP1363Format");
        sig.initSign(keyPair.getPrivate());
        sig.update(signingInput.getBytes(StandardCharsets.US_ASCII));
        byte[] signatureBytes = sig.sign();
        String token = signingInput + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(signatureBytes);

        TokenValidator.Result res = jwksValidator.validate(token);
        assertTrue(res.isValid());
        assertEquals("JwkUser", res.claims().displayName());
        assertEquals(expectedUuid, res.claims().sub());
    }
}
