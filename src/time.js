import { TIMEZONE, RESET_HOUR } from "./config.js";

function partsIn(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(date).map((x) => [x.type, x.value])
  );
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hh: Number(p.hour) % 24,
    mi: Number(p.minute),
    weekday: p.weekday,
  };
}

/**
 * "Día de juego": el día natural en España desplazado RESET_HOUR horas.
 * Antes de las 02:00 seguimos contando como el día anterior.
 */
function gameDate(now = new Date()) {
  const shifted = new Date(now.getTime() - RESET_HOUR * 3600000);
  return partsIn(shifted, TIMEZONE);
}

export function dailyPeriodKey(now = new Date()) {
  const { y, m, d } = gameDate(now);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Clave ISO de semana (los lunes a las 02:00 empieza una nueva). */
export function weeklyPeriodKey(now = new Date()) {
  const { y, m, d } = gameDate(now);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7; // lunes = 1
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Timestamp (ms) del próximo reset diario. */
export function nextDailyReset(now = new Date()) {
  const p = partsIn(now, TIMEZONE);
  const nowFloor = Math.floor(now.getTime() / 60000) * 60000;
  let target = Date.UTC(p.y, p.m - 1, p.d, RESET_HOUR, 0, 0);
  // corrige el offset de la zona horaria
  const off = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi) - nowFloor;
  target -= off;
  if (target <= now.getTime()) target += 86400000;
  return target;
}

export const discordTime = (ms, style = "R") =>
  `<t:${Math.floor(ms / 1000)}:${style}>`;
