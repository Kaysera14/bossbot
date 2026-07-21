// ---- Jefes de The Valley of Gods y su llave correspondiente ----
export const BOSSES = {
  zeus:    { label: "Zeus",    key: "Godly key",        emoji: "⚡" },
  medusa:  { label: "Medusa",  key: "Stone key",        emoji: "🐍" },
  hades:   { label: "Hades",   key: "Underworld key",   emoji: "💀" },
  griffin: { label: "Griffin", key: "Mountain key",     emoji: "🦅" },
  devil:   { label: "Devil",   key: "Burning key",      emoji: "🔥" },
  chimera: { label: "Chimera", key: "Mutated key",      emoji: "🦁" },
  sobek:   { label: "Sobek",   key: "Ancient key",      emoji: "🐊" },
  kronos:  { label: "Kronos",  key: "Kronos' book",     emoji: "⏳" },
  mesines: { label: "Mesines", key: "Otherworldly key", emoji: "🐉" },
};

export const SCOPES = {
  daily:  { label: "Diario",  emoji: "🌙" },
  weekly: { label: "Semanal", emoji: "📅" },
};

// Tamaño objetivo de grupo (la wiki recomienda 3 con 90+ de combate).
export const GROUP_SIZE = 3;

// Nº mínimo de gente para cerrar un grupo si no se llega a GROUP_SIZE.
// Ponlo a GROUP_SIZE si solo quieres grupos completos.
export const MIN_GROUP_SIZE = 2;

// Una kill cuenta a la vez para la tarea diaria y la semanal, así que para
// emparejar se mezclan las dos bolsas. El ámbito solo decide cuándo se borra
// cada registro. Ponlo a false si prefieres grupos separados.
export const MATCH_ACROSS_SCOPES = true;

export const TIMEZONE = "Europe/Madrid";

// Hora del reset (diario todos los días, semanal los lunes).
export const RESET_HOUR = 2;

// El canal de anuncios y los roles admin se configuran por servidor
// con /configurar, no aquí.
