-- =========================================================================
-- WATCHDOG FIVEM SERVER SYNC
-- =========================================================================

local function getFivemLicense(source)
    local identifiers = GetPlayerIdentifiers(source)
    for _, id in ipairs(identifiers) do
        if string.find(id, "license:") then
            return id
        end
    end
    return nil
end

local function getDiscordId(source)
    local identifiers = GetPlayerIdentifiers(source)
    for _, id in ipairs(identifiers) do
        if string.find(id, "discord:") then
            return string.gsub(id, "discord:", "")
        end
    end
    return nil
end

AddEventHandler('playerConnecting', function(name, setKickReason, deferrals)
    local src = source
    deferrals.defer()
    Wait(50)

    deferrals.update(Config.Messages.checking or "[WATCHDOG] Verifica in corso...")

    local rawLicense = getFivemLicense(src)
    if not rawLicense then
        -- Nessuna licenza FiveM trovata
        deferrals.done("[WATCHDOG] Errore: Impossibile rilevare la tua licenza FiveM.")
        return
    end

    local cleanLicense = string.gsub(rawLicense, "license:", "")
    local endpoint = string.format("%s/api/check-license/%s", Config.ApiUrl, cleanLicense)

    PerformHttpRequest(endpoint, function(statusCode, responseText, headers)
        if statusCode == 200 and responseText then
            local data = json.decode(responseText)
            if data and data.activeBan then
                local reason = data.banReason or "Nessun motivo specificato"
                local issuer = data.banIssuer or "Staff"
                
                if data.activePermanentBan then
                    local msg = string.format(Config.Messages.permBan, reason, issuer)
                    deferrals.done(msg)
                    print(string.format("^1[WATCHDOG]^7 Connessione rifiutata a %s (Permaban): %s", name, reason))
                    return
                else
                    local msg = string.format(Config.Messages.tempBan, reason, issuer, "Vedi Dashboard")
                    deferrals.done(msg)
                    print(string.format("^1[WATCHDOG]^7 Connessione rifiutata a %s (Tempban): %s", name, reason))
                    return
                end
            end

            -- Giocatore pulito, autorizzato ad entrare
            deferrals.done()
            print(string.format("^2[WATCHDOG]^7 Giocatore %s autorizzato (Warn: %s)", name, (data and data.warnCount) or 0))
        elseif statusCode == 401 then
            print("^1[WATCHDOG ERROR]^7 Secret API Key non valida o scaduta nel config.lua!")
            if Config.Messages.errorBypass then
                deferrals.done()
            else
                deferrals.done("[WATCHDOG] Errore di configurazione del server. Contatta l'amministrazione.")
            end
        else
            print(string.format("^3[WATCHDOG WARNING]^7 Impossibile contattare l'API (HTTP %s).", tostring(statusCode)))
            if Config.Messages.errorBypass then
                deferrals.done()
            else
                deferrals.done("[WATCHDOG] Sistema di moderazione momentaneamente non disponibile. Riprova tra poco.")
            end
        end
    end, "GET", "", {
        ["Content-Type"] = "application/json",
        ["x-watchdog-key"] = Config.ServerKey or ""
    })
end)

print("^2[WATCHDOG]^7 Risorsa watchdog_sync avviata correttamente e connessa a: " .. Config.ApiUrl)
