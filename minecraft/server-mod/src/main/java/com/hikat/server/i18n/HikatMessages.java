package com.hikat.server.i18n;

import net.minecraft.network.chat.Component;

import java.util.Locale;

public class HikatMessages {

    public enum Lang {
        ES,
        EN,
        FR,
        PT;

        public static Lang fromLocaleString(String rawLocale) {
            if (rawLocale == null || rawLocale.isBlank()) {
                return EN;
            }
            String lower = rawLocale.toLowerCase(Locale.ROOT);
            if (lower.startsWith("es")) {
                return ES;
            } else if (lower.startsWith("fr")) {
                return FR;
            } else if (lower.startsWith("pt")) {
                return PT;
            } else {
                return EN;
            }
        }
    }

    public static Component getSessionExpiredMessage(String rawLocale) {
        Lang lang = Lang.fromLocaleString(rawLocale);
        String text = switch (lang) {
            case ES -> "Sesión expirada. Abre HiKAT Launcher y vuelve a intentarlo.";
            case EN -> "Session expired. Open HiKAT Launcher and try again.";
            case FR -> "Session expirée. Ouvrez le Launcher HiKAT et réessayez.";
            case PT -> "Sessão expirada. Abra o HiKAT Launcher e tente novamente.";
        };
        return Component.literal(text);
    }

    public static Component getModifiedFilesMessage(String rawLocale) {
        Lang lang = Lang.fromLocaleString(rawLocale);
        String text = switch (lang) {
            case ES -> "Se detectaron archivos modificados. Repara la instalación desde HiKAT Launcher y vuelve a intentarlo.";
            case EN -> "Modified files were detected. Repair the installation from HiKAT Launcher and try again.";
            case FR -> "Des fichiers modifiés ont été détectés. Réparez l'installation depuis le Launcher HiKAT et réessayez.";
            case PT -> "Arquivos modificados foram detectados. Repare a instalação pelo HiKAT Launcher e tente novamente.";
        };
        return Component.literal(text);
    }

    public static Component getWhitelistRejectedMessage(String rawLocale) {
        Lang lang = Lang.fromLocaleString(rawLocale);
        String text = switch (lang) {
            case ES -> "No estás en la lista blanca de HiKAT.";
            case EN -> "You are not on the HiKAT whitelist.";
            case FR -> "Vous n'êtes pas sur la liste blanche HiKAT.";
            case PT -> "Você não está na lista de permissões do HiKAT.";
        };
        return Component.literal(text);
    }

    public static Component getInvalidTokenMessage(String rawLocale) {
        Lang lang = Lang.fromLocaleString(rawLocale);
        String text = switch (lang) {
            case ES -> "Token de autenticación de HiKAT inválido.";
            case EN -> "Invalid HiKAT authentication token.";
            case FR -> "Jeton d'authentification HiKAT invalide.";
            case PT -> "Token de autenticação HiKAT inválido.";
        };
        return Component.literal(text);
    }

    public static Component getIntegrityPendingMessage(String rawLocale) {
        Lang lang = Lang.fromLocaleString(rawLocale);
        String text = switch (lang) {
            case ES -> "Verificación de integridad en curso. Vuelve a intentarlo en unos segundos.";
            case EN -> "Integrity check in progress. Please try again in a few seconds.";
            case FR -> "Vérification d'intégrité en cours. Veuillez réessayer dans quelques secondes.";
            case PT -> "Verificação de integridade em andamento. Tente novamente em alguns segundos.";
        };
        return Component.literal(text);
    }

    public static Component getVersionMismatchMessage(String rawLocale, String expected, String actual) {
        Lang lang = Lang.fromLocaleString(rawLocale);
        String text = switch (lang) {
            case ES -> "Versión de modpack incompatible con el servidor (esperada: " + expected + ", recibida: " + actual + ").";
            case EN -> "Incompatible modpack version with the server (expected: " + expected + ", received: " + actual + ").";
            case FR -> "Version du modpack incompatible avec le serveur (attendue: " + expected + ", reçue: " + actual + ").";
            case PT -> "Versão do modpack incompatível com o servidor (esperada: " + expected + ", recebida: " + actual + ").";
        };
        return Component.literal(text);
    }
}
