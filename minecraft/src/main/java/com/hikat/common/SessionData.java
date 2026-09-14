package com.hikat.common;

import com.google.gson.Gson;
import com.google.gson.JsonSyntaxException;
import java.util.List;

public record SessionData(
    int schemaVersion,
    String releaseId,
    String gameToken,
    List<String> protectedFiles
) {
    private static final Gson GSON = new Gson();

    public static SessionData fromJson(String json) throws JsonSyntaxException {
        if (json == null || json.isBlank()) {
            throw new JsonSyntaxException("Session data is empty");
        }
        SessionData data = GSON.fromJson(json, SessionData.class);
        if (data == null || data.releaseId() == null || data.gameToken() == null) {
            throw new JsonSyntaxException("Invalid session payload: missing required fields");
        }
        return data;
    }
}
