package com.hikat;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

public class TranslationAssetsTest {

    private static final Set<String> REQUIRED_KEYS = Set.of(
        "disconnect.hikat.auth_failed",
        "disconnect.hikat.whitelist",
        "disconnect.hikat.integrity_failed",
        "disconnect.hikat.file_modified",
        "disconnect.hikat.server_error",
        "command.hikat.whitelist.enabled",
        "command.hikat.whitelist.disabled",
        "command.hikat.whitelist.added",
        "command.hikat.whitelist.already_added",
        "command.hikat.whitelist.removed",
        "command.hikat.whitelist.not_found",
        "command.hikat.whitelist.save_error",
        "command.hikat.whitelist.list.status_on",
        "command.hikat.whitelist.list.status_off",
        "command.hikat.whitelist.list.count",
        "command.hikat.whitelist.list.entry",
        "command.hikat.reload.success"
    );

    private static final List<String> LOCALES = List.of(
        // English
        "en_us", "en_gb", "en_au", "en_ca", "en_nz", "en_za",
        // Spanish
        "es_es", "es_ar", "es_cl", "es_ec", "es_mx", "es_uy", "es_ve",
        // Portuguese
        "pt_br", "pt_pt",
        // French
        "fr_fr", "fr_ca"
    );
    private static final Pattern ENTRY_PATTERN = Pattern.compile("\"([a-zA-Z0-9._]+)\"\\s*:\\s*\"([^\"]*)\"");

    @Test
    public void testAllLocalesExistAndHaveAllRequiredKeysWithoutTechnicalLeaks() throws Exception {
        for (String locale : LOCALES) {
            String path = "/assets/hikat/lang/" + locale + ".json";
            InputStream is = getClass().getResourceAsStream(path);
            assertNotNull(is, "Missing translation file: " + path);

            String content = new String(is.readAllBytes(), StandardCharsets.UTF_8);
            Matcher matcher = ENTRY_PATTERN.matcher(content);
            Map<String, String> translations = new HashMap<>();
            while (matcher.find()) {
                translations.put(matcher.group(1), matcher.group(2));
            }

            assertEquals(REQUIRED_KEYS, translations.keySet(),
                "Keys in " + locale + " must match REQUIRED_KEYS exactly without missing or extraneous keys");

            for (String requiredKey : REQUIRED_KEYS) {
                assertTrue(translations.containsKey(requiredKey),
                    "Locale " + locale + " missing required key: " + requiredKey);
                String val = translations.get(requiredKey);
                assertNotNull(val, "Value for key " + requiredKey + " in " + locale + " must not be null");
                assertFalse(val.isBlank(), "Value for key " + requiredKey + " in " + locale + " must not be blank");

                // Verify no technical terms or identifiers leak into translations
                assertFalse(val.contains("UUID"), "Locale " + locale + " key " + requiredKey + " must not mention UUID");
                assertFalse(val.contains("userId"), "Locale " + locale + " key " + requiredKey + " must not mention userId");
                assertFalse(val.contains("sub"), "Locale " + locale + " key " + requiredKey + " must not mention sub");
                assertFalse(val.contains("releaseId"), "Locale " + locale + " key " + requiredKey + " must not mention releaseId");
                assertFalse(val.contains("fingerprint"), "Locale " + locale + " key " + requiredKey + " must not mention fingerprint");
                assertFalse(val.contains("JWT"), "Locale " + locale + " key " + requiredKey + " must not mention JWT");
                assertFalse(val.contains("Exception"), "Locale " + locale + " key " + requiredKey + " must not mention Exception");
                assertFalse(val.contains("ID:"), "Locale " + locale + " key " + requiredKey + " must not mention ID:");
            }
        }
    }
}
