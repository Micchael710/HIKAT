package com.hikat;

import com.hikat.server.GameTokenVerifier;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.util.Collections;
import java.util.Date;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

public class GameTokenVerifierTest {

    private ECKey ecJWK;
    private GameTokenVerifier verifier;

    @BeforeEach
    public void setup() throws Exception {
        ecJWK = new ECKeyGenerator(Curve.P_256)
            .keyID("hikat-test-key-1")
            .generate();
        JWKSet jwkSet = new JWKSet(ecJWK);
        verifier = new GameTokenVerifier("hikat-minecraft", null, jwkSet);
    }

    private String createToken(String sub, String displayName, String role, String audience, long ttlMillis) throws Exception {
        ECDSASigner signer = new ECDSASigner(ecJWK);

        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .subject(sub)
            .claim("displayName", displayName)
            .claim("role", role)
            .audience(Collections.singletonList(audience))
            .issuer("https://auth.hikat.org")
            .expirationTime(new Date(System.currentTimeMillis() + ttlMillis))
            .issueTime(new Date())
            .build();

        SignedJWT signedJWT = new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.ES256).keyID(ecJWK.getKeyID()).build(),
            claims
        );
        signedJWT.sign(signer);
        return signedJWT.serialize();
    }

    @Test
    public void testVerifyValidToken() throws Exception {
        String token = createToken("usr_123", "Steve", "PLAYER", "hikat-minecraft", 180000);
        GameTokenVerifier.VerifiedClaims claims = verifier.verify(token);

        assertNotNull(claims);
        assertEquals("usr_123", claims.sub());
        assertEquals("Steve", claims.displayName());
        assertEquals("PLAYER", claims.role());
    }

    @Test
    public void testVerifyExpiredToken() throws Exception {
        String token = createToken("usr_123", "Steve", "PLAYER", "hikat-minecraft", -50000);
        assertThrows(SecurityException.class, () -> verifier.verify(token));
    }

    @Test
    public void testVerifyInvalidAudience() throws Exception {
        String token = createToken("usr_123", "Steve", "PLAYER", "wrong-audience", 180000);
        assertThrows(SecurityException.class, () -> verifier.verify(token));
    }

    @Test
    public void testVerifyForgedSignature() throws Exception {
        ECKey anotherKey = new ECKeyGenerator(Curve.P_256).keyID(ecJWK.getKeyID()).generate();
        ECDSASigner rogueSigner = new ECDSASigner(anotherKey);

        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .subject("usr_rogue")
            .claim("displayName", "Rogue")
            .audience("hikat-minecraft")
            .expirationTime(new Date(System.currentTimeMillis() + 180000))
            .build();

        SignedJWT rogueJwt = new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.ES256).keyID(ecJWK.getKeyID()).build(),
            claims
        );
        rogueJwt.sign(rogueSigner);

        assertThrows(SecurityException.class, () -> verifier.verify(rogueJwt.serialize()));
    }
}
