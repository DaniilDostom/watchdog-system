# Watchdog FiveM Sync Resource

## Installazione:
1. Copia la cartella `watchdog_sync` nella cartella `resources/` del tuo server FiveM (es. `resources/[watchdog]/watchdog_sync`).
2. Apri il file `config.lua`.
3. Incolla l'URL del tuo server Watchdog in `Config.ApiUrl` e la tua Secret API Key in `Config.ServerKey`.
4. Aggiungi nel tuo `server.cfg`:
   ```cfg
   ensure watchdog_sync
   ```
5. Riavvia il server FiveM o digita in console `refresh` e poi `start watchdog_sync`.
