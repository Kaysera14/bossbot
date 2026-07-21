import { dailyPeriodKey, weeklyPeriodKey } from "./time.js";

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
  await db.batch(
    miembros.map((r) =>
      db
        .prepare(
          `UPDATE regs SET group_id=? WHERE guild_id=? AND scope=? AND user_id=? AND boss=?`
        )
        .bind(id, guildId, r.scope, r.userId, r.boss)
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
      `SELECT g.*, COUNT(r.user_id) AS n
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

/** Grupos abiertos de un jefe, con su gente, para poder ampliarlos. */
export async function openGroups(db, guildId) {
  const { results } = await db
    .prepare(`SELECT * FROM groups WHERE guild_id=? AND closed=0`)
    .bind(guildId)
    .all();

  const out = [];
  for (const g of results) {
    const { results: miembros } = await db
      .prepare(`SELECT * FROM regs WHERE group_id=?`)
      .bind(g.id)
      .all();
    out.push({ group: g, regs: miembros.map(row2reg) });
  }
  return out;
}

/** Mete a alguien en un grupo ya existente. */
export async function addToGroup(db, guildId, scope, groupId, userId, boss) {
  await db
    .prepare(`UPDATE regs SET group_id=? WHERE guild_id=? AND scope=? AND user_id=? AND boss=?`)
    .bind(groupId, guildId, scope, userId, boss)
    .run();
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

  const runs = Math.max(0, ...g.regs.map((r) => r.need));
  const keys = g.regs.reduce((a, r) => a + r.keys, 0);
  const closed = !!g.group.locked || g.regs.length >= groupSize;

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
      `SELECT g.*, COUNT(r.user_id) AS n
         FROM groups g LEFT JOIN regs r ON r.group_id = g.id
        WHERE g.guild_id = ?
        GROUP BY g.id
       HAVING n < ?`
    )
    .bind(guildId, min)
    .all();
  return results;
}
