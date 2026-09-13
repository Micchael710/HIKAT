package com.hikat.client.auth;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

public class ClientTokenReaderTest {

    @Test
    void testReadTokenFromJson(@TempDir Path tempDir) throws Exception {
        Path hikatDir = tempDir.resolve(".hikat");
        Files.createDirectories(hikatDir);
        Path tokenFile = hikatDir.resolve("game-token.json");

        String json = "{\"token\":\"eyJhbGciOiJFUzI1NiJ9.sample.signature\"}";
        Files.writeString(tokenFile, json);

        String token = ClientTokenReader.readCurrentToken(tempDir);
        assertEquals("eyJhbGciOiJFUzI1NiJ9.sample.signature", token);
    }

    @Test
    void testReadTokenFromPlainText(@TempDir Path tempDir) throws Exception {
        Path hikatDir = tempDir.resolve(".hikat");
        Files.createDirectories(hikatDir);
        Path tokenFile = hikatDir.resolve("game-token.json");

        String rawToken = "raw-jwt-token-string";
        Files.writeString(tokenFile, rawToken);

        String token = ClientTokenReader.readCurrentToken(tempDir);
        assertEquals("raw-jwt-token-string", token);
    }

    @Test
    void testReadTokenMissingReturnsNull(@TempDir Path tempDir) {
        String token = ClientTokenReader.readCurrentToken(tempDir);
        assertNull(token);
    }
}
