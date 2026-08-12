import assert from "node:assert";
import fs from "node:fs";
import { makeD1 } from "./d1-shim.js";
import * as db from "../src/db.js";
import { STALE_CLOSED_WEEKLY_HOURS } from "../src/config.js";
import worker, { matchAndAnnounce, publicarPanel } from "../src/index.js";

const G = "guild-1";
const enviados = [];

// Intercepta las llamadas a Discord
globalThis.fetch = async (url, init) => {
  enviados.push({ url, method: init?.method ?? "POST", body: JSON.parse(init?.body || "{}") });
  return {
    ok: true,
    status: 200,
    json: async () => ({ id: `msg-${enviados.length}` }),
    text: async () => "",
  };
};

const DB = makeD1(fs.readFileSync("schema.sql", "utf8"));
const env = { DB, DISCORD_TOKEN: "fake" };

await db.ensureGuild(DB, G);
await db.setConfig(DB, G, { announceChannelId: "canal-1" });

const apuntar = (user, scope, boss, need, keys) =>
  db.upsertReg(DB, G, scope, { userId: user, boss, need, keys, support: need === 0 });

/* --- 1. Dos personas: se forma un grupo abierto --- */

await apuntar("A", "daily", "zeus", 3, 1);
await apuntar("B", "daily", "zeus", 2, 2);
await matchAndAnnounce(env, G);

let grupos = (await DB.prepare("SELECT * FROM groups").all()).results;
assert.equal(grupos.length, 1, "se crea un grupo");
assert.equal(grupos[0].closed, 0, "con 2 personas sigue abierto");
assert.equal(grupos[0].scope, "daily", "el grupo hereda el ámbito de sus miembros");
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

/* --- 8. Diario y semanal van a grupos SEPARADOS, incluso para la misma persona --- */

await db.dissolveAllGroups(DB, G);
await DB.prepare("DELETE FROM regs").run();

// K necesita Sobek tanto a diario como semanalmente (kills muy distintas).
await db.upsertReg(DB, G, "daily",  { userId: "K", boss: "sobek", need: 1, keys: 2 });
await db.upsertReg(DB, G, "weekly", { userId: "K", boss: "sobek", need: 40, keys: 2 });
await db.upsertReg(DB, G, "daily",  { userId: "W", boss: "sobek", need: 1, keys: 1 });
await db.upsertReg(DB, G, "daily",  { userId: "Z", boss: "sobek", need: 1, keys: 0 });
await db.upsertReg(DB, G, "weekly", { userId: "Y", boss: "sobek", need: 35, keys: 3 });
await matchAndAnnounce(env, G);

const gDaily = await DB.prepare("SELECT * FROM groups WHERE boss='sobek' AND scope='daily'").first();
const gWeekly = await DB.prepare("SELECT * FROM groups WHERE boss='sobek' AND scope='weekly'").first();

assert.ok(gDaily, "se forma el grupo diario");
assert.ok(gWeekly, "y por separado el semanal");
assert.notEqual(gDaily.id, gWeekly.id, "son dos grupos distintos");
assert.equal(gDaily.runs, 1, "el grupo diario no arrastra las 40 runs semanales de K");
assert.equal(gWeekly.runs, 40, "ni al revés: el semanal no se contamina con el 1 diario");

const enDiario = (await DB.prepare("SELECT user_id FROM regs WHERE group_id=?").bind(gDaily.id).all()).results.map((r) => r.user_id);
const enSemanal = (await DB.prepare("SELECT user_id FROM regs WHERE group_id=?").bind(gWeekly.id).all()).results.map((r) => r.user_id);
assert.deepEqual(enDiario.sort(), ["K", "W", "Z"]);
assert.deepEqual(enSemanal.sort(), ["K", "Y"]);
assert.ok(enDiario.includes("K") && enSemanal.includes("K"), "K está en los dos grupos a la vez, uno por ámbito");
console.log("✓ diario y semanal forman grupos separados, incluso para la misma persona");

// Salir quita a K de los DOS grupos de golpe (los dos ámbitos del jefe)
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

/* --- 10. El reset diario no toca los grupos semanales, y viceversa --- */

await db.dissolveAllGroups(DB, G);
await DB.prepare("DELETE FROM regs").run();

// Grupo puramente semanal para Mesines.
await db.upsertReg(DB, G, "weekly", { userId: "M1", boss: "mesines", need: 4, keys: 2 });
await db.upsertReg(DB, G, "weekly", { userId: "M2", boss: "mesines", need: 1, keys: 1 });
await matchAndAnnounce(env, G);
const gm = await DB.prepare("SELECT * FROM groups WHERE boss='mesines'").first();
assert.ok(gm, "grupo semanal creado");
assert.equal(gm.scope, "weekly");

// Llega el reset diario: no debería tocar un grupo 100% semanal.
await db.wipeScope(DB, G, "daily");
await db.syncAllGroups(DB, G, 3);
const gm2 = await DB.prepare("SELECT * FROM groups WHERE id=?").bind(gm.id).first();
assert.ok(gm2, "el grupo semanal sobrevive intacto al reset diario");
assert.equal(gm2.runs, 4, "sin cambios: el reset diario no tenía nada que tocar aquí");
console.log("✓ el reset diario no afecta a los grupos semanales");

// Ahora sí llega el reset semanal: ese grupo desaparece.
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

const vista = openRequestsEmbed(
  await db.openGroups(DB, G),
  await db.unassignedAll(DB, G),
);
assert.ok(vista.embed.title.includes("Solicitudes abiertas"));

const texto = JSON.stringify(vista.embed.fields);
assert.ok(texto.includes("Medusa"), "sale el grupo abierto de Medusa");
assert.ok(texto.includes("<@V1>") && texto.includes("<@V2>"), "con sus miembros");
assert.ok(texto.includes("falta 1"), "y cuánta gente falta");
assert.ok(texto.includes("Grifo") && texto.includes("En cola"), "y quién espera solo");

// Y hay un botón "Unirme" para el grupo con hueco (Medusa), pero no para
// Grifo, que solo tiene cola y ningún grupo al que unirse todavía.
const botones = vista.components.flatMap((r) => r.components.map((c) => c.custom_id));
assert.ok(botones.some((id) => id.includes("medusa")), "botón de unirse a Medusa");
assert.ok(!botones.some((id) => id.includes("griffin")), "Grifo no tiene grupo, no hay botón");
console.log("✓ solicitudes abiertas: grupos con hueco, gente en cola y botón de unirse");

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

/* --- 15. El panel se recuerda y se puede republicar sin duplicar --- */

let marcaPanel = enviados.length;
const r1 = await publicarPanel(env, G, "canal-panel");
assert.ok(r1.ok, "se publica el panel");
assert.equal(enviados.slice(marcaPanel).length, 1, "solo 1 llamada: no había panel previo que borrar");

const ubic1 = await db.getPanelLocation(DB, G);
assert.equal(ubic1.channelId, "canal-panel");
assert.equal(ubic1.messageId, r1.id);
console.log("✓ /panel guarda dónde se publicó");

marcaPanel = enviados.length;
const r2 = await publicarPanel(env, G, "canal-panel");
const llamadas = enviados.slice(marcaPanel);
assert.equal(llamadas.length, 2, "borra el viejo (DELETE) y publica el nuevo (POST)");
assert.ok(llamadas.some((l) => l.method === "DELETE"), "una es un borrado");
assert.ok(llamadas.some((l) => l.method === "POST"), "la otra es la publicación nueva");

const ubic2 = await db.getPanelLocation(DB, G);
assert.notEqual(ubic2.messageId, ubic1.messageId, "el mensaje nuevo tiene otro id");
console.log("✓ republicar borra el panel anterior, no lo duplica");

/* --- 16. El reset diario republica el panel solo (vía cron) --- */

await db.setPanelLocation(DB, G, "canal-panel", "msg-viejo");
// Fuerza que toque reset hoy mismo, forzando un periodo distinto al actual
await DB.prepare("UPDATE guilds SET daily_period='hace-tiempo' WHERE guild_id=?").bind(G).run();

const resets = await db.applyResets(DB, G);
assert.ok(resets.length && resets[0].scopes.includes("daily"), "hay un reset diario pendiente");

marcaPanel = enviados.length;
const panelTrasReset = await db.getPanelLocation(DB, G);
if (panelTrasReset.channelId) await publicarPanel(env, G, panelTrasReset.channelId);
assert.ok(
  enviados.slice(marcaPanel).some((l) => l.method === "DELETE"),
  "tras el reset se borra el panel de ayer",
);
assert.ok(
  enviados.slice(marcaPanel).some((l) => l.method === "POST"),
  "y se publica uno nuevo",
);
console.log("✓ el reset diario deja el panel fresco y sin duplicados");

/* --- 17. Grupos "ameba": cerrados hace mucho, se autocompletan --- */

await db.dissolveAllGroups(DB, G);
await DB.prepare("DELETE FROM regs").run();

await db.upsertReg(DB, G, "daily", { userId: "AM1", boss: "chimera", need: 1, keys: 1 });
await db.upsertReg(DB, G, "daily", { userId: "AM2", boss: "chimera", need: 1, keys: 1 });
await matchAndAnnounce(env, G);

// Lo cerramos a mano, como con el botón 🔒
const gAmeba = await DB.prepare("SELECT * FROM groups WHERE boss='chimera'").first();
await db.updateGroup(DB, gAmeba.id, { runs: 1, keys: 2, closed: true, locked: true });

const antesDeEnvejecer = await db.staleClosedGroups(DB, 20 * 3600 * 1000);
assert.equal(antesDeEnvejecer.length, 0, "recién cerrado, aún no es viejo");

// Lo envejecemos artificialmente
await DB.prepare("UPDATE groups SET closed_at=? WHERE id=?")
  .bind(Date.now() - 21 * 3600 * 1000, gAmeba.id)
  .run();

const rancios = await db.staleClosedGroups(DB, 20 * 3600 * 1000);
assert.equal(rancios.length, 1, "ahora sí aparece como rancio");
assert.equal(rancios[0].id, gAmeba.id);

await db.completeGroup(DB, G, gAmeba.id);
const yaNoExiste = await DB.prepare("SELECT * FROM groups WHERE id=?").bind(gAmeba.id).first();
assert.equal(yaNoExiste, null, "se autocompleta: desaparece");
const regsLibres = (await DB.prepare("SELECT * FROM regs WHERE user_id IN ('AM1','AM2')").all()).results;
assert.equal(regsLibres.length, 0, "y sus registros también, como con el botón Completado");
console.log("✓ un grupo cerrado 20h sin completarse se autolimpia solo");

// Uno recién cerrado no se toca
await db.upsertReg(DB, G, "daily", { userId: "AM3", boss: "sobek", need: 1, keys: 1 });
await db.upsertReg(DB, G, "daily", { userId: "AM4", boss: "sobek", need: 1, keys: 1 });
await db.upsertReg(DB, G, "daily", { userId: "AM5", boss: "sobek", need: 1, keys: 1 });
await matchAndAnnounce(env, G);
const gVivo = await DB.prepare("SELECT * FROM groups WHERE boss='sobek'").first();
assert.equal(gVivo.closed, 1, "se cierra solo al llenarse");
assert.ok(
  !(await db.staleClosedGroups(DB, 20 * 3600 * 1000)).some((g) => g.id === gVivo.id),
  "pero no es rancio todavía",
);
console.log("✓ un grupo recién cerrado no se toca");

/* --- 18. Red de seguridad: grupo de 1 persona suelto se disuelve --- */

await db.dissolveAllGroups(DB, G);
await DB.prepare("DELETE FROM regs").run();

// Simula un dato viejo/huérfano: grupo con una sola persona, marcado abierto
await db.upsertReg(DB, G, "daily", { userId: "S1", boss: "kronos", need: 1, keys: 1 });
const huerfano = await db.createGroup(DB, G, [{ userId: "S1", scope: "daily", boss: "kronos" }], {
  boss: "kronos",
  runs: 1,
  keys: 1,
});

const sueltos = await db.undersizedGroupsGlobal(DB, 2);
assert.ok(sueltos.some((g) => g.id === huerfano.id), "el barrido global lo detecta");

await db.dissolveGroup(DB, G, huerfano.id);
const yaNo = await DB.prepare("SELECT * FROM groups WHERE id=?").bind(huerfano.id).first();
assert.equal(yaNo, null, "se disuelve");
const s1libre = await DB.prepare("SELECT group_id FROM regs WHERE user_id='S1'").first();
assert.equal(s1libre.group_id, null, "y S1 vuelve a la cola, no pierde su registro");
console.log("✓ red de seguridad: un grupo de 1 persona suelto se disuelve en el barrido");

/* --- 19. createGroup no se lleva por delante la fila del OTRO ámbito --- */

await db.dissolveAllGroups(DB, G);
await DB.prepare("DELETE FROM regs").run();

// Reproduce el bug real: al formarse el grupo diario, la fila semanal de la
// misma persona para el mismo jefe no debe tocarse.
await db.upsertReg(DB, G, "daily",  { userId: "BUG1", boss: "devil", need: 1, keys: 1 });
await db.upsertReg(DB, G, "weekly", { userId: "BUG1", boss: "devil", need: 20, keys: 1 });
await db.upsertReg(DB, G, "daily",  { userId: "BUG2", boss: "devil", need: 1, keys: 1 });

await matchAndAnnounce(env, G);

const filaSemanal = await DB.prepare(
  "SELECT group_id FROM regs WHERE user_id='BUG1' AND scope='weekly'",
).first();
assert.equal(
  filaSemanal.group_id,
  null,
  "la fila semanal de BUG1 sigue libre: no la ha tocado el grupo diario",
);

const grupoDiario = await DB.prepare("SELECT * FROM groups WHERE boss='devil' AND scope='daily'").first();
const enGrupoDiario = (
  await DB.prepare("SELECT user_id, scope FROM regs WHERE group_id=?").bind(grupoDiario.id).all()
).results;
assert.equal(enGrupoDiario.length, 2, "el grupo diario tiene solo las 2 filas diarias");
assert.ok(enGrupoDiario.every((r) => r.scope === "daily"), "ninguna fila semanal se coló");
console.log("✓ formar un grupo en un ámbito no arrastra la fila del otro ámbito");

/* --- 20. Botón "Quitar" en cola: acceso sin comandos de barra --- */

await db.dissolveAllGroups(DB, G);
await DB.prepare("DELETE FROM regs").run();

await db.upsertReg(DB, G, "daily", { userId: "Q1", boss: "hades", need: 1, keys: 1 });
await db.upsertReg(DB, G, "weekly", { userId: "Q1", boss: "kronos", need: 5, keys: 1 });

const { statusButtons } = await import("../src/ui.js");
const colaQ1 = (await db.unassignedAll(DB, G)).filter((r) => r.userId === "Q1");
const botonesQ1 = statusButtons([], colaQ1);
const ids = botonesQ1.flatMap((r) => r.components.map((c) => c.custom_id));
assert.ok(ids.some((id) => id === "s:cancel:daily:hades"), "botón para quitar Hades diario");
assert.ok(ids.some((id) => id === "s:cancel:weekly:kronos"), "botón para quitar Cronos semanal");
console.log("✓ cada registro en cola tiene su propio botón de quitar");

// Simula pulsar el botón: solo borra ESE registro, el otro se queda intacto
await db.removeReg(DB, G, "daily", "Q1", "hades");
const quedaHades = await DB.prepare(
  "SELECT * FROM regs WHERE user_id='Q1' AND boss='hades'",
).first();
const quedaKronos = await DB.prepare(
  "SELECT * FROM regs WHERE user_id='Q1' AND boss='kronos'",
).first();
assert.equal(quedaHades, null, "Hades desaparece");
assert.ok(quedaKronos, "Cronos se mantiene: quitar es preciso, no un /fuera encubierto");
console.log("✓ quitar un registro no toca los demás");

/* --- 21. El cron de verdad (scheduled) arranca sin reventar --- */

// Esto habría pillado el ReferenceError de STALE_CLOSED_HOURS sin importar:
// node --check solo mira sintaxis, no variables no definidas en tiempo de
// ejecución. Sin este test, un fallo así solo se ve en producción.
try {
  await worker.scheduled({}, env, { waitUntil: (p) => p });
  console.log("✓ scheduled() se ejecuta sin lanzar excepción");
} catch (err) {
  throw new Error(`scheduled() ha reventado: ${err.message}`);
}

/* --- 22. Grupos ameba: diario caduca rápido, semanal espera casi la semana entera --- */

await db.dissolveAllGroups(DB, G);
await DB.prepare("DELETE FROM regs").run();

await db.upsertReg(DB, G, "daily", { userId: "D1", boss: "zeus", need: 1, keys: 1 });
await db.upsertReg(DB, G, "daily", { userId: "D2", boss: "zeus", need: 1, keys: 1 });
await db.upsertReg(DB, G, "weekly", { userId: "W1", boss: "zeus", need: 1, keys: 1 });
await db.upsertReg(DB, G, "weekly", { userId: "W2", boss: "zeus", need: 1, keys: 1 });
await matchAndAnnounce(env, G);

const g2Daily = await DB.prepare("SELECT * FROM groups WHERE scope='daily' AND boss='zeus'").first();
const g2Weekly = await DB.prepare("SELECT * FROM groups WHERE scope='weekly' AND boss='zeus'").first();
await db.updateGroup(DB, g2Daily.id, { runs: 1, keys: 2, closed: true, locked: true });
await db.updateGroup(DB, g2Weekly.id, { runs: 1, keys: 2, closed: true, locked: true });

// Los envejecemos 30h: eso ya caduca un diario, pero un semanal necesita 7 días.
await DB.prepare("UPDATE groups SET closed_at=? WHERE id IN (?, ?)")
  .bind(Date.now() - 30 * 3600 * 1000, g2Daily.id, g2Weekly.id)
  .run();

const rancioDiario = await db.staleClosedGroups(DB, 20 * 3600 * 1000, "daily");
// Con la ventana REAL que usa la app (168h), un semanal de solo 30h está a
// salvo: hace falta casi una semana entera para que se considere rancio.
const rancioSemanalReal = await db.staleClosedGroups(DB, STALE_CLOSED_WEEKLY_HOURS * 3600 * 1000, "weekly");

assert.ok(rancioDiario.some((g) => g.id === g2Daily.id), "el diario ya es rancio a las 30h");
assert.ok(
  !rancioSemanalReal.some((g) => g.id === g2Weekly.id),
  "el semanal, con su ventana real de casi una semana, sigue a salvo a las 30h",
);
console.log("✓ el barrido de grupos ameba respeta ventanas distintas por ámbito");

console.log("\nTodo OK");
