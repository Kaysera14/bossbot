import assert from "node:assert";
import fs from "node:fs";
import { makeD1 } from "./d1-shim.js";
import * as db from "../src/db.js";
import { matchAndAnnounce } from "../src/index.js";

const G = "guild-1";
const enviados = [];

// Intercepta las llamadas a Discord
globalThis.fetch = async (url, init) => {
  enviados.push({ url, body: JSON.parse(init.body || "{}") });
  return { ok: true, status: 200, json: async () => ({ id: `msg-${enviados.length}` }) };
};

const DB = makeD1(fs.readFileSync("schema.sql", "utf8"));
const env = { DB, DISCORD_TOKEN: "fake" };

await db.ensureGuild(DB, G);
await db.setConfig(DB, G, { announceChannelId: "canal-1" });

const apuntar = (user, scope, boss, need, keys) =>
  db.upsertReg(DB, G, scope, { userId: user, boss, need, keys, support: need === 0 });

/* --- 1. Dos personas: se forma un grupo abierto --- */

await apuntar("A", "weekly", "zeus", 3, 1);
await apuntar("B", "daily", "zeus", 2, 2);
await matchAndAnnounce(env, G);

let grupos = (await DB.prepare("SELECT * FROM groups").all()).results;
assert.equal(grupos.length, 1, "se crea un grupo");
assert.equal(grupos[0].closed, 0, "con 2 personas sigue abierto");
assert.equal(grupos[0].scope, "mixto", "mezcla diario y semanal");
console.log("✓ 2 personas → grupo abierto");

/* --- 2. Entra un tercero: debe cerrarse solo --- */

await apuntar("C", "daily", "zeus", 1, 0);
await matchAndAnnounce(env, G);

grupos = (await DB.prepare("SELECT * FROM groups").all()).results;
assert.equal(grupos.length, 1, "no se crea un grupo nuevo, se amplía el existente");

const miembros = (await DB.prepare("SELECT * FROM regs WHERE group_id=?").bind(grupos[0].id).all()).results;
assert.equal(miembros.length, 3, "el tercero entra en el grupo");
assert.equal(grupos[0].closed, 1, "al llegar a 3 el grupo se cierra solo");
console.log("✓ 3 personas → grupo cerrado automáticamente");

/* --- 3. Un cuarto ya no entra --- */

await apuntar("D", "daily", "zeus", 1, 5);
await matchAndAnnounce(env, G);

const restantes = (await DB.prepare("SELECT * FROM regs WHERE group_id IS NULL").all()).results;
assert.ok(restantes.some((r) => r.user_id === "D"), "el cuarto se queda en cola");
console.log("✓ el cuarto no entra en un grupo cerrado");

/* --- 4. Alguien se va: el grupo se reabre y admite al que esperaba --- */

await db.removeReg(DB, G, "daily", "C", "zeus");
await db.resyncGroup(DB, G, grupos[0].id, 3);
let g4 = (await DB.prepare("SELECT * FROM groups WHERE id=?").bind(grupos[0].id).first());
assert.equal(g4.closed, 0, "al bajar de 3 el grupo se reabre");

await matchAndAnnounce(env, G);
const dentro = (await DB.prepare("SELECT user_id FROM regs WHERE group_id=?").bind(grupos[0].id).all()).results;
assert.ok(dentro.some((r) => r.user_id === "D"), "el que esperaba en cola entra al hueco");
console.log("✓ una baja reabre el grupo y entra quien esperaba");

/* --- 5. Grupo lleno heredado de una versión anterior --- */

await DB.prepare("UPDATE groups SET closed=0 WHERE id=?").bind(grupos[0].id).run();
await matchAndAnnounce(env, G);
g4 = await DB.prepare("SELECT * FROM groups WHERE id=?").bind(grupos[0].id).first();
assert.equal(g4.closed, 1, "un grupo ya lleno se cierra aunque no entre nadie nuevo");
console.log("✓ se cierra un grupo lleno que estaba marcado como abierto");

/* --- 6. Cierre manual: no se reabre al llenarse ni al salir alguien --- */

await db.upsertReg(DB, G, "daily", { userId: "X", boss: "hades", need: 2, keys: 2 });
await db.upsertReg(DB, G, "daily", { userId: "Y", boss: "hades", need: 1, keys: 1 });
await matchAndAnnounce(env, G);
const gh = await DB.prepare("SELECT * FROM groups WHERE boss='hades'").first();
assert.equal(gh.closed, 0, "empieza abierto con 2");

await db.updateGroup(DB, gh.id, { runs: 2, keys: 3, closed: true, locked: true });
await db.upsertReg(DB, G, "daily", { userId: "Z", boss: "hades", need: 1, keys: 0 });
await matchAndAnnounce(env, G);
const dentroH = (await DB.prepare("SELECT user_id FROM regs WHERE group_id=?").bind(gh.id).all()).results;
assert.equal(dentroH.length, 2, "un grupo cerrado a mano no admite a nadie más");
console.log("✓ el cierre manual se respeta");

/* --- 7. Deshacer todos los grupos --- */

const antes = (await DB.prepare("SELECT COUNT(*) AS n FROM groups").first()).n;
assert.ok(antes > 0, "hay grupos que deshacer");

const deshechos = await db.dissolveAllGroups(DB, G);
assert.equal(deshechos.length, antes);
assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM groups").first()).n, 0, "no queda ningún grupo");

const huerfanos = (await DB.prepare("SELECT COUNT(*) AS n FROM regs WHERE group_id IS NOT NULL").first()).n;
assert.equal(huerfanos, 0, "nadie se queda apuntado a un grupo que ya no existe");

const sigueApuntada = (await DB.prepare("SELECT COUNT(*) AS n FROM regs").first()).n;
assert.ok(sigueApuntada > 0, "los registros se conservan: solo se deshacen los grupos");
console.log(`✓ /borrargrupos deshace ${deshechos.length} grupos y conserva ${sigueApuntada} registros`);

// Y se pueden volver a formar
await matchAndAnnounce(env, G);
assert.ok((await DB.prepare("SELECT COUNT(*) AS n FROM groups").first()).n > 0, "se vuelven a formar");
console.log("✓ tras deshacerlos, /emparejar los rehace");

console.log("\nTodo OK");
