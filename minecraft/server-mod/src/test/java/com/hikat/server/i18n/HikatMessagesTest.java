package com.hikat.server.i18n;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class HikatMessagesTest {

    @Test
    void testExactSessionExpiredMessages() {
        assertEquals(
                "Sesión expirada. Abre HiKAT Launcher y vuelve a intentarlo.",
                HikatMessages.getSessionExpiredMessage("es_es").getString()
        );
        assertEquals(
                "Session expired. Open HiKAT Launcher and try again.",
                HikatMessages.getSessionExpiredMessage("en_us").getString()
        );
        assertEquals(
                "Session expirée. Ouvrez le Launcher HiKAT et réessayez.",
                HikatMessages.getSessionExpiredMessage("fr_fr").getString()
        );
        assertEquals(
                "Sessão expirada. Abra o HiKAT Launcher e tente novamente.",
                HikatMessages.getSessionExpiredMessage("pt_br").getString()
        );
        // Default to English for other locales
        assertEquals(
                "Session expired. Open HiKAT Launcher and try again.",
                HikatMessages.getSessionExpiredMessage("de_de").getString()
        );
    }

    @Test
    void testExactModifiedFilesMessages() {
        assertEquals(
                "Se detectaron archivos modificados. Repara la instalación desde HiKAT Launcher y vuelve a intentarlo.",
                HikatMessages.getModifiedFilesMessage("es_es").getString()
        );
        assertEquals(
                "Modified files were detected. Repair the installation from HiKAT Launcher and try again.",
                HikatMessages.getModifiedFilesMessage("en_us").getString()
        );
        assertEquals(
                "Des fichiers modifiés ont été détectés. Réparez l'installation depuis le Launcher HiKAT et réessayez.",
                HikatMessages.getModifiedFilesMessage("fr_ca").getString()
        );
        assertEquals(
                "Arquivos modificados foram detectados. Repare a instalação pelo HiKAT Launcher e tente novamente.",
                HikatMessages.getModifiedFilesMessage("pt_pt").getString()
        );
        assertEquals(
                "Modified files were detected. Repair the installation from HiKAT Launcher and try again.",
                HikatMessages.getModifiedFilesMessage("it_it").getString()
        );
    }
}
