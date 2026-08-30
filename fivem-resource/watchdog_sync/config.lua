-- =========================================================================
-- WATCHDOG FIVEM REAL-TIME MODERATION & BAN SYNC CONFIGURATION
-- =========================================================================

Config = {}

-- URL del tuo server Watchdog (es. http://localhost:3000 o https://tuodominio.com)
Config.ApiUrl = "http://localhost:3000"

-- La tua Secret API Key (puoi vederla e rigenerarla dalla Dashboard Watchdog)
Config.ServerKey = "INSERISCI_LA_TUA_SECRET_KEY_QUI"

-- Timeout per la verifica HTTP in millisecondi (default 3500ms)
Config.Timeout = 3500

-- Messaggi mostrati a schermo al giocatore quando viene respinto
Config.Messages = {
    permBan = "\n[WATCHDOG] Sei stato PERMANENTEMENTE BANNATO da questo server.\nMotivo: %s\nStaffer: %s",
    tempBan = "\n[WATCHDOG] Sei stato TEMPORANEAMENTE SOSPESO da questo server.\nMotivo: %s\nStaffer: %s\nScadenza: %s",
    checking = "[WATCHDOG] Verifica credenziali e stato disciplinare in corso...",
    errorBypass = false -- Se true e l'API non risponde, lascia passare il player. Se false, blocca.
}
