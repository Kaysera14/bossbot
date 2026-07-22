import { dailyPeriodKey, weeklyPeriodKey } from "./time.js";

/* ---------- esquema autorreparable ---------- */

let esquemaOk = false;

/**
 * Crea lo que falte y añade columnas nuevas si no están. Así el bot no puede
 * quedarse a medias por una migración sin aplicar: se arregla solo.
 */
export async function ensureSchema(db) {
  if (esquemaOk) return;

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS guilds (
      guild_id TEXT PRIMARY KEY,
      announce_channel_id TEXT,
      admin_role_ids TEXT NOT NULL DEFAULT '[]',
      daily_period TEXT,
      weekly_period TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      boss TEXT NOT NULL,
      runs INTEGER NOT NULL,
      keys INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      channel_id TEXT,
      message_id TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS regs (
      guild_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      user_id TEXT NOT NULL,
      boss TEXT NOT NULL,
      need INTEGER NOT NULL DEFAULT 0,
      keys INTEGER NOT NULL DEFAULT 0,
      support INTEGER NOT NULL DEFAULT 0,
      group_id INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, scope, user_id, boss))`),
  ]);

  // Columnas añadidas después del despliegue inicial.
  const columnas = {
    groups: { closed: "INTEGER NOT NULL DEFAULT 0", locked: "INTEGER NOT NULL DEFAULT 0" },
  };
  for (const [tabla, cols] of Object.entries(columnas)) {
    const { results } = await db.prepare(`PRAGMA table_info(${tabla})`).all();
    const existentes = new Set(results.map((c) => c.name));
    for (const [nombre, tipo] of Object.entries(cols)) {
      if (existentes.has(nombre)) continue;
      try {
        await db.prepare(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${tipo}`).run();
        console.log(`Esquema: añadida la columna ${tabla}.${nombre}`);
      } catch (err) {
        console.error(`No se pudo añadir ${tabla}.${nombre}:`, err.message);
      }
    }
  }

  esquemaOk = true;
}

const row2reg = (r) => ({
  userId: r.user_id,
  boss: r.boss,
  need: r.need,
  keys: r.keys,
  support: !!r.support,
  groupId: r.group_id,
  scope: r.scope,
});

export async function ensureGuild(db, guildId) {
  await db
    .prepare(
      `INSERT INTO guilds (guild_id, daily_period, weekly_period)
       VALUES (?, ?, ?) ON CONFLICT(guild_id) DO NOTHING`
    )
    .bind(guildId, dailyPeriodKey(), weeklyPeriodKey())
    .run();
}

export async function getConfig(db, guildId) {
  const r = await db
    .prepare(`SELECT * FROM guilds WHERE guild_id = ?`)
    .bind(guildId)
    .first();
  if (!r) return { announceChannelId: null, adminRoleIds: [] };
  return {
    announceChannelId: r.announce_channel_id,
    adminRoleIds: JSON.parse(r.admin_role_ids || "[]"),
  };
}

export async function setConfig(db, guildId, { announceChannelId, adminRoleIds }) {
  await ensureGuild(db, guildId);
  if (announceChannelId !== undefined) {
    await db
      .prepare(`UPDATE guilds SET announce_channel_id = ? WHERE guild_id = ?`)
      .bind(announceChannelId, guildId)
      .run();
  }
  if (adminRoleIds !== undefined) {
    await db
      .prepare(`UPDATE guilds SET admin_role_ids = ? WHERE guild_id = ?`)
      .bind(JSON.stringify(adminRoleIds), guildId)
      .run();
  }
  return getConfig(db, guildId);
}

export async function upsertReg(db, guildId, scope, { userId, boss, need, keys, support }) {
  await ensureGuild(db, guildId);
  await db
    .prepare(
      `INSERT INTO regs (guild_id, scope, user_id, boss, need, keys, support, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, scope, user_id, boss)
       DO UPDATE SET need = excluded.need, keys = excluded.keys,
                     support = excluded.support, updated_at = excluded.updated_at`
    )
    .bind(guildId, scope, userId, boss, need, keys, support ? 1 : 0, Date.now())
    .run();
}

export async function getReg(db, guildId, scope, userId, boss) {
  const r = await db
    .prepare(
      `SELECT * FROM regs WHERE guild_id=? AND scope=? AND user_id=? AND boss=?`
    )
    .bind(guildId, scope, userId, boss)
    .first();
  return r ? row2reg(r) : null;
}

export async function removeReg(db, guildId, scope, userId, boss) {
  const r = await db
    .prepare(`DELETE FROM regs WHERE guild_id=? AND scope=? AND user_id=? AND boss=? RETURNING group_id`)
    .bind(guildId, scope, userId, boss)
    .first();
  return r ? { groupId: r.group_id } : null;
}

export async function unassignedRegs(db, guildId, scope) {
  const { results } = await db
    .prepare(`SELECT * FROM regs WHERE guild_id=? AND scope=? AND group_id IS NULL`)
    .bind(guildId, scope)
    .all();
  return results.map(row2reg);
}

/** Cola completa del servidor, mezclando diario y semanal. */
export async function unassignedAll(db, guildId) {
  const { results } = await db
    .prepare(`SELECT * FROM regs WHERE guild_id=? AND group_id IS NULL`)
    .bind(guildId)
    .all();
  return results.map(row2reg);
}

export async function userRegs(db, guildId, userId) {
  const { results } = await db
    .prepare(`SELECT * FROM regs WHERE guild_id=? AND user_id=?`)
    .bind(guildId, userId)
    .all();
  return results.map(row2reg);
}

/**
 * Crea el grupo y marca a sus miembros. `miembros` son los registros reales,
 * porque un grupo puede mezclar gente de diario y de semanal.
 */
export async function createGroup(db, guildId, miembros, g) {
  const scopes = [...new Set(miembros.map((r) => r.scope))];
  const scope = scopes.length === 1 ? scopes[0] : "mixto";

  const created = await db
    .prepare(
      `INSERT INTO groups (guild_id, scope, boss, runs, keys, created_at, closed)
       VALUES (?, ?, ?, ?, ?, ?, 0) RETURNING id`
    )
    .bind(guildId, scope, g.boss, g.runs, g.keys, Date.now())
    .first();

  const id = created.id;
  const personas = [...new Set(miembros.map((r) => r.userId))];
  await db.batch(
    personas.map((uid) =>
      db
        .prepare(`UPDATE regs SET group_id=? WHERE guild_id=? AND user_id=? AND boss=?`)
        .bind(id, guildId, uid, g.boss)
    )
  );
  return { ...g, id, scope };
}

export async function getGroup(db, guildId, groupId) {
  const g = await db
    .prepare(`SELECT * FROM groups WHERE id=? AND guild_id=?`)
    .bind(groupId, guildId)
    .first();
  if (!g) return null;
  const { results } = await db
    .prepare(`SELECT * FROM regs WHERE group_id=?`)
    .bind(groupId)
    .all();
  return { group: g, regs: results.map(row2reg) };
}

export async function setGroupMessage(db, groupId, channelId, messageId) {
  await db
    .prepare(`UPDATE groups SET channel_id=?, message_id=? WHERE id=?`)
    .bind(channelId, messageId, groupId)
    .run();
}

export async function completeGroup(db, guildId, groupId) {
  await db.batch([
    db.prepare(`DELETE FROM regs WHERE group_id=?`).bind(groupId),
    db.prepare(`DELETE FROM groups WHERE id=? AND guild_id=?`).bind(groupId, guildId),
  ]);
}

/** Todos los grupos del servidor, con cuánta gente tiene cada uno. */
export async function allGroups(db, guildId) {
  const { results } = await db
    .prepare(
      `SELECT g.*, COUNT(DISTINCT r.user_id) AS n
         FROM groups g LEFT JOIN regs r ON r.group_id = g.id
        WHERE g.guild_id = ?
        GROUP BY g.id
        ORDER BY g.id`
    )
    .bind(guildId)
    .all();
  return results;
}

/**
 * Deshace todos los grupos del servidor: la gente vuelve a la cola con sus
 * registros intactos. Devuelve los grupos borrados para poder editar sus
 * mensajes en el canal.
 */
export async function dissolveAllGroups(db, guildId) {
  const grupos = await allGroups(db, guildId);
  if (!grupos.length) return [];

  await db.batch([
    db
      .prepare(
        `UPDATE regs SET group_id=NULL
          WHERE guild_id=? AND group_id IN (SELECT id FROM groups WHERE guild_id=?)`
      )
      .bind(guildId, guildId),
    db.prepare(`DELETE FROM groups WHERE guild_id=?`).bind(guildId),
  ]);

  return grupos;
}

/** IDs de los grupos abiertos, para detectar cuáles se cierran después. */
export async function openGroupIds(db, guildId) {
  const { results } = await db
    .prepare(`SELECT id FROM groups WHERE guild_id=? AND closed=0`)
    .bind(guildId)
    .all();
  return new Set(results.map((r) => r.id));
}

/**
 * Recalcula TODOS los grupos del servidor de golpe. Sustituye a llamar a
 * resyncGroup en bucle: 4 consultas en vez de 3 por grupo, que con muchos
 * grupos se comía el límite de 3 segundos de Discord.
 *
 * Ojo: se cuenta gente distinta (COUNT DISTINCT), no filas, porque alguien
 * apuntado en diario y semanal al mismo jefe son dos filas y una persona.
 */
export async function syncAllGroups(db, guildId, groupSize) {
  const miembros = `(SELECT COUNT(DISTINCT user_id) FROM regs WHERE regs.group_id = groups.id)`;

  await db.batch([
    // Runs y llaves al día (llaves: una vez por persona, no por fila)
    db
      .prepare(
        `UPDATE groups SET
           runs = COALESCE((SELECT MAX(need) FROM regs WHERE regs.group_id = groups.id), 0),
           keys = COALESCE((SELECT SUM(k) FROM
                    (SELECT MAX(keys) AS k FROM regs
                      WHERE regs.group_id = groups.id GROUP BY user_id)), 0)
         WHERE guild_id = ?`
      )
      .bind(guildId),
    // Lleno o bloqueado -> cerrado
    db
      .prepare(`UPDATE groups SET closed=1 WHERE guild_id=? AND closed=0 AND (locked=1 OR ${miembros} >= ?)`)
      .bind(guildId, groupSize),
    // Ya no está lleno y no lo cerrasteis a mano -> se reabre
    db
      .prepare(`UPDATE groups SET closed=0 WHERE guild_id=? AND closed=1 AND locked=0 AND ${miembros} < ?`)
      .bind(guildId, groupSize),
    // Sin nadie dentro -> se borra
    db
      .prepare(
        `DELETE FROM groups WHERE guild_id=?
           AND id NOT IN (SELECT group_id FROM regs WHERE group_id IS NOT NULL)`
      )
      .bind(guildId),
  ]);
}

/** Grupos abiertos de un jefe, con su gente, para poder ampliarlos. */
export async function openGroups(db, guildId) {
  const { results: grupos } = await db
    .prepare(`SELECT * FROM groups WHERE guild_id=? AND closed=0`)
    .bind(guildId)
    .all();
  if (!grupos.length) return [];

  // Una sola consulta para todos los miembros, en vez de una por grupo.
  const { results: todos } = await db
    .prepare(
      `SELECT * FROM regs
        WHERE guild_id=? AND group_id IN (SELECT id FROM groups WHERE guild_id=? AND closed=0)`
    )
    .bind(guildId, guildId)
    .all();

  const porGrupo = new Map();
  for (const r of todos) {
    if (!porGrupo.has(r.group_id)) porGrupo.set(r.group_id, []);
    porGrupo.get(r.group_id).push(row2reg(r));
  }
  return grupos.map((g) => ({ group: g, regs: porGrupo.get(g.id) ?? [] }));
}

/** Mete a alguien en un grupo ya existente. */
/**
 * Mete a alguien en un grupo. Marca TODOS sus registros de ese jefe (diario y
 * semanal), porque es una sola persona ocupando un solo hueco.
 */
export async function addToGroup(db, guildId, groupId, userId, boss) {
  await db
    .prepare(`UPDATE regs SET group_id=? WHERE guild_id=? AND user_id=? AND boss=?`)
    .bind(groupId, guildId, userId, boss)
    .run();
}

/** Saca a alguien de un jefe por completo (los dos ámbitos). */
export async function removeUserBoss(db, guildId, userId, boss) {
  const { results } = await db
    .prepare(
      `DELETE FROM regs WHERE guild_id=? AND user_id=? AND boss=? RETURNING scope, group_id`
    )
    .bind(guildId, userId, boss)
    .all();
  return results;
}

/** Actualiza runs/llaves y el estado de cierre. */
export async function updateGroup(db, groupId, { runs, keys, closed, locked }) {
  await db
    .prepare(
      `UPDATE groups SET runs=?, keys=?, closed=?, locked=COALESCE(?, locked) WHERE id=?`
    )
    .bind(runs, keys, closed ? 1 : 0, locked === undefined ? null : locked ? 1 : 0, groupId)
    .run();
}

/**
 * Recalcula un grupo a partir de quién queda dentro. Es el único sitio que
 * decide si un grupo está cerrado, así que no puede quedar descuadrado.
 *   - sin nadie dentro  -> se borra
 *   - lleno o bloqueado -> cerrado
 *   - si no             -> abierto
 */
export async function resyncGroup(db, guildId, groupId, groupSize) {
  const g = await getGroup(db, guildId, groupId);
  if (!g) return null;

  if (!g.regs.length) {
    await db.prepare(`DELETE FROM groups WHERE id=? AND guild_id=?`).bind(groupId, guildId).run();
    return { deleted: true, group: g.group };
  }

  const porPersona = new Map();
  for (const r of g.regs) {
    const prev = porPersona.get(r.userId);
    porPersona.set(r.userId, prev ? { need: Math.max(prev.need, r.need), keys: Math.max(prev.keys, r.keys) } : r);
  }
  const personas = [...porPersona.values()];

  const runs = Math.max(0, ...personas.map((r) => r.need));
  const keys = personas.reduce((a, r) => a + r.keys, 0);
  const closed = !!g.group.locked || personas.length >= groupSize;

  await db
    .prepare(`UPDATE groups SET runs=?, keys=?, closed=? WHERE id=?`)
    .bind(runs, keys, closed ? 1 : 0, groupId)
    .run();

  return { deleted: false, closed, group: { ...g.group, runs, keys, closed: closed ? 1 : 0 }, regs: g.regs };
}

/** Borra registros y grupos de un ámbito. */
export async function wipeScope(db, guildId, scope) {
  // Un grupo puede mezclar gente de diario y de semanal: se borran los
  // registros del ámbito y solo caen los grupos que se quedan sin nadie.
  await db.batch([
    db.prepare(`DELETE FROM regs WHERE guild_id=? AND scope=?`).bind(guildId, scope),
    db
      .prepare(
        `DELETE FROM groups
          WHERE guild_id=?
            AND id NOT IN (SELECT group_id FROM regs WHERE group_id IS NOT NULL)`
      )
      .bind(guildId),
  ]);
}

/**
 * Resetea los servidores cuyo periodo haya cambiado.
 * @returns [{ guildId, scopes: ["daily"], announceChannelId }]
 */
export async function applyResets(db, guildId = null) {
  const dk = dailyPeriodKey();
  const wk = weeklyPeriodKey();

  const q = guildId
    ? db.prepare(`SELECT * FROM guilds WHERE guild_id=? AND (daily_period IS NOT ? OR weekly_period IS NOT ?)`).bind(guildId, dk, wk)
    : db.prepare(`SELECT * FROM guilds WHERE daily_period IS NOT ? OR weekly_period IS NOT ?`).bind(dk, wk);

  const { results } = await q.all();
  const out = [];

  for (const g of results) {
    const scopes = [];
    if (g.daily_period !== dk) scopes.push("daily");
    if (g.weekly_period !== wk) scopes.push("weekly");
    for (const s of scopes) await wipeScope(db, g.guild_id, s);
    await db
      .prepare(`UPDATE guilds SET daily_period=?, weekly_period=? WHERE guild_id=?`)
      .bind(dk, wk, g.guild_id)
      .run();
    out.push({ guildId: g.guild_id, scopes, announceChannelId: g.announce_channel_id });
  }
  return out;
}

/** Limpia servidores que ya no tienen actividad (barrido del cron). */
export async function purgeOrphans(db, guildIdsActivos) {
  if (!guildIdsActivos.length) return;
  const marks = guildIdsActivos.map(() => "?").join(",");
  await db
    .prepare(`DELETE FROM regs WHERE guild_id NOT IN (${marks})`)
    .bind(...guildIdsActivos)
    .run();
}

/* ---------- salidas y disolución de grupos ---------- */

/** Borra TODOS los registros de un usuario en el servidor. */
export async function removeAllRegs(db, guildId, userId) {
  const { results } = await db
    .prepare(`DELETE FROM regs WHERE guild_id=? AND user_id=? RETURNING scope, boss, group_id`)
    .bind(guildId, userId)
    .all();
  return results.map((r) => ({ scope: r.scope, boss: r.boss, groupId: r.group_id }));
}

/** Devuelve a los miembros de un grupo a la cola y borra el grupo. */
export async function dissolveGroup(db, guildId, groupId) {
  await db.batch([
    db.prepare(`UPDATE regs SET group_id=NULL WHERE group_id=?`).bind(groupId),
    db.prepare(`DELETE FROM groups WHERE id=? AND guild_id=?`).bind(groupId, guildId),
  ]);
}

/** Grupos del servidor que están por debajo del mínimo tras una baja. */
export async function undersizedGroups(db, guildId, min) {
  const { results } = await db
    .prepare(
      `SELECT g.*, COUNT(DISTINCT r.user_id) AS n
         FROM groups g LEFT JOIN regs r ON r.group_id = g.id
        WHERE g.guild_id = ?
        GROUP BY g.id
       HAVING n < ?`
    )
    .bind(guildId, min)
    .all();
  return results;
}
