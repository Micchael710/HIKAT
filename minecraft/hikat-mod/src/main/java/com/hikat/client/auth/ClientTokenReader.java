package com.hikat.client.auth;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.neoforged.fml.loading.FMLPaths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Files;
import java.nio.file.Path;

public class ClientTokenReader {
    private static final Logger LOGGER = LoggerFactory.getLogger(ClientTokenReader.class);

    public static String readCurrentToken() {
        Path gameDir = FMLPaths.GAMEDIR.get();
        return readCurrentToken(gameDir);
    }

    public static String readCurrentToken(Path gameDir) {
        if (gameDir == null) return null;
        Path tokenFile = gameDir.resolve(".hikat").resolve("game-token.json");

        if (!Files.exists(tokenFile)) {
            // Check fallback in root
            Path fallback = gameDir.resolve("game-token.json");
            if (Files.exists(fallback)) {
                tokenFile = fallback;
            } else {
                return null;
            }
        }

        // Retry once in case of atomic rename in-flight
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                String content = Files.readString(tokenFile).trim();
                if (content.isEmpty()) {
                    return null;
                }

                if (content.startsWith("{")) {
                    JsonObject obj = JsonParser.parseString(content).getAsJsonObject();
                    if (obj.has("token") && !obj.get("token").isJsonNull()) {
                        return obj.get("token").getAsString().trim();
                    }
                } else {
                    return content;
                }
            } catch (Exception e) {
                if (attempt == 0) {
                    try {
                        Thread.sleep(15);
                    } catch (InterruptedException ignored) {}
                } else {
                    LOGGER.warn("[HiKAT] Could not read game token file: {}", e.getMessage());
                }
            }
        }
        return null;
    }
}
