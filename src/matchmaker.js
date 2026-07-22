import { GROUP_SIZE, MIN_GROUP_SIZE } from "./config.js";

/**
 * Una misma persona puede estar apuntada al mismo jefe en diario Y en semanal.
 * Son dos registros, pero UNA persona con UN inventario de llaves: si no se
 * fusionan, cuenta doble para llenar el grupo y sus llaves se suman dos veces.
 */
export function dedupePool(pool) {
  const porPersona = new Map();

  for (const r of pool) {
    const k = `${r.userId}|${r.boss}`;
    const scopes = r.scopes ?? [r.scope];
    const prev = porPersona.get(k);
    if (!prev) {
      porPersona.set(k, { ...r, scopes });
      continue;
    }
    porPersona.set(k, {
      ...prev,
      need: Math.max(prev.need, r.need),        // le basta con la tarea más larga
      keys: Math.max(prev.keys, r.keys),        // mismas llaves, no se suman
      support: prev.support && r.support,       // solo es apoyo si lo es en todo
      // Idempotente: pasarlo dos veces no debe perder los ámbitos.
      scopes: [...new Set([...prev.scopes, ...scopes])],
    });
  }
  return [...porPersona.values()];
}

const sumKeys = (regs) => regs.reduce((a, r) => a + r.keys, 0);
const maxNeed = (regs) => Math.max(0, ...regs.map((r) => r.need));

/**
 * Función pura: recibe los registros SIN grupo de un ámbito y devuelve
 * los grupos que se pueden formar. No toca la base de datos.
 *
 * @param {Array<{userId, boss, need, keys, support}>} pool
 * @returns {Array<{boss, members: string[], runs: number, keys: number}>}
 */
export function matchPool(poolBruto, opts = {}) {
  const size = opts.groupSize ?? GROUP_SIZE;
  const min = opts.minGroupSize ?? MIN_GROUP_SIZE;
  const out = [];

  const pool = dedupePool(poolBruto);
  const bosses = [...new Set(pool.map((r) => r.boss))];

  for (const boss of bosses) {
    const forBoss = pool.filter((r) => r.boss === boss);
    let needers = forBoss
      .filter((r) => !r.support && r.need > 0)
      .sort((a, b) => b.need - a.need || b.keys - a.keys);
    const supports = forBoss
      .filter((r) => r.support || r.need === 0)
      .sort((a, b) => b.keys - a.keys);

    // Basta con UNA persona que necesite el jefe: los apoyos completan el grupo.
    while (needers.length) {
      const group = [needers.shift()];

      // 1) Rellena con otra gente que también lo necesite, priorizando llaves.
      const byKeys = [...needers].sort((a, b) => b.keys - a.keys);
      while (group.length < size && byKeys.length) {
        const pick = byKeys.shift();
        group.push(pick);
        needers = needers.filter((r) => r !== pick);
      }

      // 2) Completa hasta el mínimo con apoyos (aunque no falten llaves).
      while (group.length < min && supports.length) group.push(supports.shift());

      // 3) Si aún faltan llaves, mete más apoyos mientras quepan.
      while (sumKeys(group) < maxNeed(group) && supports.length && group.length < size) {
        group.push(supports.shift());
      }

      // 4) Grupo lleno y sin llaves suficientes: cambia al que menos aporta
      //    por un apoyo con más llaves.
      while (sumKeys(group) < maxNeed(group) && supports.length) {
        const help = supports[0];
        const weakest = [...group]
          .filter((r) => !r.support)
          .sort((a, b) => a.keys - b.keys || a.need - b.need)[0];
        if (!weakest || help.keys <= weakest.keys) break;
        group.splice(group.indexOf(weakest), 1);
        group.push(supports.shift());
        needers.push(weakest);
        needers.sort((a, b) => b.need - a.need || b.keys - a.keys);
      }

      // No hay gente suficiente: se devuelve a la cola y se deja de intentar.
      if (group.length < min) {
        needers.unshift(...group.filter((r) => !r.support));
        supports.unshift(...group.filter((r) => r.support));
        break;
      }

      out.push({
        boss,
        members: group.map((r) => r.userId),
        runs: maxNeed(group),
        keys: sumKeys(group),
      });
    }
  }

  return out;
}

/**
 * Reparte quién abre cada puerta: empieza por quien más llaves tiene y gasta
 * las suyas antes de pasar al siguiente. Así el que va sobrado carga con las
 * aperturas y quien tiene una sola llave se la guarda salvo que haga falta.
 */
export function keyPlan(regs, runs) {
  const pool = dedupePool(regs)
    .filter((r) => r.keys > 0)
    .map((r) => ({ userId: r.userId, keys: r.keys, use: 0 }))
    .sort((a, b) => b.keys - a.keys || String(a.userId).localeCompare(String(b.userId)));

  let left = runs;
  for (const p of pool) {
    if (left <= 0) break;
    p.use = Math.min(p.keys, left);
    left -= p.use;
  }
  return pool.filter((p) => p.use > 0);
}

export const groupStats = (regsBruto) => {
  const regs = dedupePool(regsBruto);
  return {
    runs: maxNeed(regs),
    keys: sumKeys(regs),
    deficit: Math.max(0, maxNeed(regs) - sumKeys(regs)),
    personas: regs.length,
  };
};

/**
 * Elige a quién meter en un grupo que ya existe y sigue abierto.
 * Si al grupo le faltan llaves, prioriza a quien más aporte; si no,
 * a quien de verdad necesite el jefe.
 */
export function pickForGroup(groupRegsBruto, candidatesBruto, size = GROUP_SIZE) {
  const groupRegs = dedupePool(groupRegsBruto);
  const dentro = new Set(groupRegs.map((r) => r.userId));

  // Nunca se mete a alguien que ya está en el grupo (puede aparecer como
  // candidato por su registro del otro ámbito).
  const candidates = dedupePool(candidatesBruto).filter((r) => !dentro.has(r.userId));

  const libres = size - groupRegs.length;
  if (libres <= 0) return [];

  const { deficit } = groupStats(groupRegs);
  const orden = [...candidates].sort((a, b) =>
    deficit > 0
      ? b.keys - a.keys || b.need - a.need
      : (b.need > 0) - (a.need > 0) || b.need - a.need || b.keys - a.keys
  );
  return orden.slice(0, libres);
}
