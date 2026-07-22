// ---- Jefes del Valle de los Dioses y su llave ----
// Las claves internas (zeus, medusa...) NO se tocan: están guardadas en la
// base de datos. Solo cambia lo que se muestra.
export const BOSSES = {
  zeus:    { label: "Zeus",    key: "Llave divina",        emoji: "⚡" },
  medusa:  { label: "Medusa",  key: "Llave de piedra",     emoji: "🐍" },
  hades:   { label: "Hades",   key: "Llave del inframundo", emoji: "💀" },
  griffin: { label: "Grifo",   key: "Llave de la montaña", emoji: "🦅" },
  devil:   { label: "Diablo",  key: "Llave ardiente",      emoji: "🔥" },
  chimera: { label: "Quimera", key: "Llave mutada",        emoji: "🦁" },
  sobek:   { label: "Sobek",   key: "Llave antigua",       emoji: "🐊" },
  kronos:  { label: "Cronos",  key: "Libro de Cronos",     emoji: "⏳" },
  mesines: { label: "Mesines", key: "Llave de otro mundo", emoji: "🐉" },
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
