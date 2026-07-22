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

/* --- 8. La misma persona apuntada al mismo jefe en diario Y semanal --- */

await db.dissolveAllGroups(DB, G);
await DB.prepare("DELETE FROM regs").run();

await db.upsertReg(DB, G, "daily",  { userId: "K", boss: "sobek", need: 1, keys: 2 });
await db.upsertReg(DB, G, "weekly", { userId: "K", boss: "sobek", need: 3, keys: 2 });
await db.upsertReg(DB, G, "daily",  { userId: "W", boss: "sobek", need: 1, keys: 1 });
await matchAndAnnounce(env, G);

const gs = await DB.prepare("SELECT * FROM groups WHERE boss='sobek'").first();
const filas = (await DB.prepare("SELECT user_id FROM regs WHERE group_id=?").bind(gs.id).all()).results;
const personas = new Set(filas.map((r) => r.user_id));

assert.equal(personas.size, 2, "son 2 personas, no 3");
assert.equal(gs.closed, 0, "con 2 personas el grupo sigue abierto aunque haya 3 filas");
assert.equal(gs.keys, 3, "las llaves de K cuentan una vez (2), no dos (4)");
assert.equal(gs.runs, 3, "las runs son las de la tarea más larga de cada uno");
console.log("✓ diario + semanal de la misma persona = 1 hueco y 1 juego de llaves");

// Y al entrar un tercero real, ahí sí se cierra
await db.upsertReg(DB, G, "daily", { userId: "Z", boss: "sobek", need: 1, keys: 0 });
await matchAndAnnounce(env, G);
const gs2 = await DB.prepare("SELECT * FROM groups WHERE boss='sobek'").first();
assert.equal(gs2.closed, 1, "con la tercera persona real sí se cierra");
console.log("✓ y con la tercera persona real se cierra");

// Al salirse, se le quitan los dos registros del jefe
await db.removeUserBoss(DB, G, "K", "sobek");
const quedan = (await DB.prepare("SELECT * FROM regs WHERE user_id='K' AND boss='sobek'").all()).results;
assert.equal(quedan.length, 0, "salir quita el registro de los dos ámbitos");
console.log("✓ salir de un grupo te quita de los dos ámbitos");

/* --- 9. Base de datos sin la migración: el bot se repara solo --- */

const schemaViejo = fs
  .readFileSync("schema.sql", "utf8")
  .replace(/\n\s*locked\s+INTEGER NOT NULL DEFAULT 0,/, "")
  .replace(/\n\s*closed\s+INTEGER NOT NULL DEFAULT 0,/, "");
const DB2 = makeD1(schemaViejo);
const env2 = { DB: DB2, DISCORD_TOKEN: "fake" };

await db.ensureSchema(DB2);
const cols = (await DB2.prepare("PRAGMA table_info(groups)").all()).results.map((c) => c.name);
assert.ok(cols.includes("closed") && cols.includes("locked"), "las columnas que faltaban se crean solas");

await db.ensureGuild(DB2, G);
await db.setConfig(DB2, G, { announceChannelId: "canal-1" });
for (const [u, n, k] of [["P", 3, 1], ["Q", 2, 1], ["R", 1, 1]]) {
  await db.upsertReg(DB2, G, "daily", { userId: u, boss: "kronos", need: n, keys: k });
}
await matchAndAnnounce(env2, G);
const gk = await DB2.prepare("SELECT * FROM groups WHERE boss='kronos'").first();
assert.equal(gk.closed, 1, "sobre una base sin migrar, el grupo de 3 se cierra igual");
console.log("✓ una base de datos sin migrar se repara sola y funciona");

/* --- 10. Reset diario con un grupo mixto --- */

await db.dissolveAllGroups(DB, G);
await DB.prepare("DELETE FROM regs").run();

await db.upsertReg(DB, G, "weekly", { userId: "M1", boss: "mesines", need: 4, keys: 2 });
await db.upsertReg(DB, G, "daily",  { userId: "M2", boss: "mesines", need: 1, keys: 1 });
await matchAndAnnounce(env, G);
const gm = await DB.prepare("SELECT * FROM groups WHERE boss='mesines'").first();
assert.ok(gm, "grupo mixto creado");

// Llega el reset diario: se van los registros diarios, el grupo debe seguir
await db.wipeScope(DB, G, "daily");
await db.syncAllGroups(DB, G, 3);
const gm2 = await DB.prepare("SELECT * FROM groups WHERE id=?").bind(gm.id).first();
assert.ok(gm2, "el grupo mixto sobrevive al reset diario");
assert.equal(gm2.runs, 4, "las runs se recalculan con quien queda");
assert.equal(gm2.keys, 2, "y las llaves también");
console.log("✓ el reset diario no se lleva por delante un grupo mixto");

// Si el reset deja el grupo sin nadie, desaparece
await db.wipeScope(DB, G, "weekly");
await db.syncAllGroups(DB, G, 3);
const gm3 = await DB.prepare("SELECT * FROM groups WHERE id=?").bind(gm.id).first();
assert.equal(gm3, null, "sin nadie dentro, el grupo se borra");
console.log("✓ un grupo que se queda vacío tras el reset se borra");

/* --- 11. Los anuncios no bloquean la respuesta (ctx.waitUntil) --- */

await DB.prepare("DELETE FROM regs").run();
const pendientes = [];
const ctxFalso = { waitUntil: (p) => pendientes.push(p) };

await db.upsertReg(DB, G, "daily", { userId: "T1", boss: "griffin", need: 2, keys: 1 });
await db.upsertReg(DB, G, "daily", { userId: "T2", boss: "griffin", need: 1, keys: 1 });

const antesDeAnunciar = enviados.length;
await matchAndAnnounce(env, G, ctxFalso);
assert.equal(enviados.length, antesDeAnunciar, "no se ha llamado a Discord todavía");
assert.equal(pendientes.length, 1, "el anuncio queda diferido");

await Promise.all(pendientes);
assert.ok(enviados.length > antesDeAnunciar, "y se envía después de responder");
console.log("✓ los anuncios salen después de responder, no antes");

/* --- 12. Aviso al completarse el grupo, venga por donde venga --- */

await db.dissolveAllGroups(DB, G);
await DB.prepare("DELETE FROM regs").run();

const desde = (n) => enviados.slice(n).map((e) => e.body.content ?? "");

let marca = enviados.length;
await db.upsertReg(DB, G, "daily", { userId: "C1", boss: "devil", need: 2, keys: 1 });
await db.upsertReg(DB, G, "daily", { userId: "C2", boss: "devil", need: 1, keys: 1 });
await matchAndAnnounce(env, G);
assert.ok(
  !desde(marca).some((t) => t.includes("completo")),
  "con 2 aún no avisa de completo",
);

let antesAviso = enviados.length;
await db.upsertReg(DB, G, "daily", { userId: "C3", boss: "devil", need: 1, keys: 1 });
await matchAndAnnounce(env, G);

const aviso = enviados.slice(antesAviso).find((e) => (e.body.content ?? "").includes("completo"));
assert.ok(aviso, "al llegar el tercero sale el aviso de grupo completo");
for (const u of ["C1", "C2", "C3"]) {
  assert.ok(aviso.body.content.includes(`<@${u}>`), `${u} está mencionado`);
  assert.ok(aviso.body.allowed_mentions.users.includes(u), `${u} recibe ping de verdad`);
}
console.log("✓ aviso de grupo completo mencionando a los tres");

// También cuando el cierre lo hace el barrido (grupo heredado, sin altas nuevas)
await DB.prepare("UPDATE groups SET closed=0 WHERE boss='devil'").run();
antesAviso = enviados.length;
await matchAndAnnounce(env, G);
assert.ok(
  enviados.slice(antesAviso).some((e) => (e.body.content ?? "").includes("completo")),
  "un grupo cerrado por el barrido también se avisa",
);
console.log("✓ también avisa si el grupo se cierra por el barrido");

// Y no repite el aviso en la siguiente pasada
antesAviso = enviados.length;
await matchAndAnnounce(env, G);
assert.ok(
  !enviados.slice(antesAviso).some((e) => (e.body.content ?? "").includes("completo")),
  "no se repite el aviso",
);
console.log("✓ y no lo repite en cada pasada");

/* --- 13. Vista de solicitudes abiertas --- */

const { openRequestsEmbed } = await import("../src/ui.js");

// Un grupo abierto de 2 y alguien esperando a otro jefe
await db.upsertReg(DB, G, "daily", { userId: "V1", boss: "medusa", need: 2, keys: 1 });
await db.upsertReg(DB, G, "daily", { userId: "V2", boss: "medusa", need: 1, keys: 1 });
await db.upsertReg(DB, G, "weekly", { userId: "V3", boss: "griffin", need: 1, keys: 3 });
await matchAndAnnounce(env, G);

const emb = openRequestsEmbed(
  await db.openGroups(DB, G),
  await db.unassignedAll(DB, G),
);
assert.ok(emb.title.includes("Solicitudes abiertas"));

const texto = JSON.stringify(emb.fields);
assert.ok(texto.includes("Medusa"), "sale el grupo abierto de Medusa");
assert.ok(texto.includes("<@V1>") && texto.includes("<@V2>"), "con sus miembros");
assert.ok(texto.includes("falta 1"), "y cuánta gente falta");
assert.ok(texto.includes("Griffin") && texto.includes("En cola"), "y quién espera solo");
console.log("✓ solicitudes abiertas: grupos con hueco y gente en cola");

/* --- 14. Sin canal configurado, el bot no se calla --- */

const DB3 = makeD1(fs.readFileSync("schema.sql", "utf8"));
const env3 = { DB: DB3, DISCORD_TOKEN: "fake" };
await db.ensureSchema(DB3);
await db.ensureGuild(DB3, G); // ojo: sin setConfig, no hay canal

await db.upsertReg(DB3, G, "daily", { userId: "N1", boss: "zeus", need: 2, keys: 1 });
await db.upsertReg(DB3, G, "daily", { userId: "N2", boss: "zeus", need: 1, keys: 1 });
const antesSinCanal = enviados.length;
await matchAndAnnounce(env3, G);
assert.equal(enviados.length, antesSinCanal, "sin canal no se manda nada (y no revienta)");

const { statusEmbed } = await import("../src/ui.js");
const pie = statusEmbed("N1", [], [], true).footer?.text ?? "";
assert.ok(pie.includes("Sin canal de avisos"), "y se avisa en el pie de /grupo");
console.log("✓ sin canal configurado el bot avisa en vez de callarse");

console.log("\nTodo OK");
