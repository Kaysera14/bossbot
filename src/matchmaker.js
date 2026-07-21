import { GROUP_SIZE, MIN_GROUP_SIZE } from "./config.js";

const sumKeys = (regs) => regs.reduce((a, r) => a + r.keys, 0);
const maxNeed = (regs) => Math.max(0, ...regs.map((r) => r.need));

/**
 * Función pura: recibe los registros SIN grupo de un ámbito y devuelve
 * los grupos que se pueden formar. No toca la base de datos.
 *
 * @param {Array<{userId, boss, need, keys, support}>} pool
 * @returns {Array<{boss, members: string[], runs: number, keys: number}>}
 */
export function matchPool(pool, opts = {}) {
  const size = opts.groupSize ?? GROUP_SIZE;
  const min = opts.minGroupSize ?? MIN_GROUP_SIZE;
  const out = [];

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

/** Reparte quién abre cada puerta, empezando por quien más llaves tiene. */
export function keyPlan(regs, runs) {
  const pool = regs
    .filter((r) => r.keys > 0)
    .map((r) => ({ userId: r.userId, keys: r.keys, use: 0 }))
    .sort((a, b) => b.keys - a.keys);
  let left = runs;
  let i = 0;
  while (left > 0 && pool.some((p) => p.use < p.keys)) {
    const p = pool[i % pool.length];
    if (p.use < p.keys) {
      p.use++;
      left--;
    }
    i++;
  }
  return pool.filter((p) => p.use > 0);
}

export const groupStats = (regs) => ({
  runs: maxNeed(regs),
  keys: sumKeys(regs),
  deficit: Math.max(0, maxNeed(regs) - sumKeys(regs)),
});

/**
 * Elige a quién meter en un grupo que ya existe y sigue abierto.
 * Si al grupo le faltan llaves, prioriza a quien más aporte; si no,
 * a quien de verdad necesite el jefe.
 */
export function pickForGroup(groupRegs, candidates, size = GROUP_SIZE) {
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
