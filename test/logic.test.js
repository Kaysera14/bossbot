import assert from "node:assert";
import { matchPool, keyPlan, groupStats, pickForGroup } from "../src/matchmaker.js";
import { dailyPeriodKey, weeklyPeriodKey, nextDailyReset } from "../src/time.js";
import { verifyRequest, isAdmin, opts } from "../src/discord.js";
import { modalValue, regModal, bossSelect, panelMessage } from "../src/panel.js";

const reg = (userId, boss, need, keys, support = false, scope = "daily") =>
  ({ userId, boss, need, keys, support, scope });

/* ---- emparejador ---- */

let g = matchPool([
  reg("A", "zeus", 3, 1),
  reg("B", "zeus", 1, 2),
  reg("C", "zeus", 2, 1),
]);
assert.equal(g.length, 1);
assert.equal(g[0].runs, 3);
assert.equal(g[0].keys, 4);
console.log("✓ grupo completo:", g[0].members.join(","));

const regs = [reg("A", "zeus", 3, 1), reg("B", "zeus", 1, 2), reg("C", "zeus", 2, 1)];
const plan = keyPlan(regs, 3);
assert.equal(plan.reduce((a, p) => a + p.use, 0), 3);
assert.equal(groupStats(regs).deficit, 0);
console.log("✓ reparto de llaves:", plan.map((p) => `${p.userId}x${p.use}`).join(" "));

g = matchPool([
  reg("D", "medusa", 4, 0),
  reg("E", "medusa", 2, 0),
  reg("F", "medusa", 1, 1),
  reg("G", "medusa", 0, 5, true),
]);
assert.ok(g[0].members.includes("G"), "el apoyo entra al grupo");
assert.equal(g[0].keys >= g[0].runs, true, "el apoyo cubre las llaves");
console.log("✓ el apoyo cubre el déficit:", g[0].members.join(","));

assert.equal(matchPool([reg("H", "kronos", 1, 1)]).length, 0);
console.log("✓ un jugador solo se queda en cola");

// Un solo interesado + un apoyo YA forman grupo (antes no lo hacían)
g = matchPool([reg("A", "zeus", 3, 0), reg("S", "zeus", 0, 5, true)]);
assert.equal(g.length, 1, "1 necesitado + 1 apoyo = grupo");
assert.deepEqual(g[0].members.sort(), ["A", "S"]);
assert.equal(g[0].keys, 5, "las llaves del apoyo cuentan");
console.log("✓ el apoyo completa grupo aunque no falten llaves");

// Solo apoyos: no hay a quién ayudar, no se forma nada
assert.equal(matchPool([reg("S1", "zeus", 0, 5, true), reg("S2", "zeus", 0, 2, true)]).length, 0);
console.log("✓ solo apoyos no forman grupo");

// Grupo completo de gente que lo necesita: el apoyo se queda en cola
g = matchPool([reg("A", "zeus", 2, 1), reg("B", "zeus", 1, 1), reg("C", "zeus", 1, 1), reg("S", "zeus", 0, 9, true)]);
assert.equal(g.length, 1);
assert.ok(!g[0].members.includes("S"), "no se gasta un apoyo si no hace falta");
console.log("✓ el apoyo no se malgasta si el grupo ya está lleno");

// Jefes distintos no se mezclan
g = matchPool([reg("A", "zeus", 1, 1), reg("B", "hades", 1, 1), reg("C", "zeus", 1, 1)]);
assert.equal(g.length, 1);
assert.equal(g[0].boss, "zeus");
console.log("✓ no se mezclan jefes distintos");

// El caso real que fallaba: quien lo necesita está en semanal y el apoyo en
// diario. Al ir a la misma bolsa, forman grupo.
g = matchPool([
  reg("A", "zeus", 2, 0, false, "weekly"),
  reg("S", "zeus", 0, 9, true, "daily"),
]);
assert.equal(g.length, 1, "diario y semanal deben emparejarse entre sí");
assert.deepEqual(g[0].members.sort(), ["A", "S"]);
console.log("✓ se mezclan diario y semanal en el mismo grupo");

/* ---- grupos abiertos ---- */

// Sin déficit de llaves, entra antes quien necesita el jefe que un apoyo
let elegidos = pickForGroup([reg("A", "zeus", 2, 3), reg("B", "zeus", 1, 1)], [
  reg("S", "zeus", 0, 9, true),
  reg("C", "zeus", 2, 0),
]);
assert.deepEqual(elegidos.map((r) => r.userId), ["C"]);

// Con déficit, entra quien más llaves aporta
elegidos = pickForGroup([reg("A", "zeus", 4, 0), reg("B", "zeus", 1, 0)], [
  reg("S", "zeus", 0, 9, true),
  reg("C", "zeus", 2, 0),
]);
assert.deepEqual(elegidos.map((r) => r.userId), ["S"]);

// Un grupo lleno no admite a nadie más
assert.equal(pickForGroup([reg("A", "zeus", 1, 1), reg("B", "zeus", 1, 1), reg("C", "zeus", 1, 1)], [reg("D", "zeus", 1, 1)]).length, 0);

// Nunca devuelve más gente de la que cabe
assert.equal(pickForGroup([reg("A", "zeus", 1, 1)], [reg("B", "zeus", 1, 1), reg("C", "zeus", 1, 1), reg("D", "zeus", 1, 1)]).length, 2);
console.log("✓ ampliación de grupos abiertos");

/* ---- tiempo ---- */

assert.equal(dailyPeriodKey(new Date("2026-07-20T23:30:00Z")), "2026-07-20", "01:30 en España = día anterior");
assert.equal(dailyPeriodKey(new Date("2026-07-21T01:00:00Z")), "2026-07-21", "03:00 en España = día nuevo");
assert.notEqual(
  weeklyPeriodKey(new Date("2026-07-19T23:00:00Z")),
  weeklyPeriodKey(new Date("2026-07-20T01:00:00Z")),
  "el lunes a las 02:00 cambia la semana"
);
// En invierno España va en UTC+1: el corte son las 01:00 UTC
assert.equal(dailyPeriodKey(new Date("2026-01-15T00:30:00Z")), "2026-01-14", "el horario de invierno también cuadra");
console.log("✓ periodos de reset correctos (verano e invierno)");
console.log("  próximo reset diario:", new Date(nextDailyReset()).toISOString());

/* ---- permisos y opciones ---- */

assert.equal(isAdmin({ member: { permissions: "32", roles: [] } }), true, "Manage Guild = admin");
assert.equal(isAdmin({ member: { permissions: "0", roles: ["r1"] } }, ["r1"]), true, "rol configurado = admin");
assert.equal(isAdmin({ member: { permissions: "0", roles: ["r9"] } }, ["r1"]), false);
assert.deepEqual(
  opts({ data: { options: [{ name: "ambito", value: "daily" }, { name: "llaves", value: 2 }] } }),
  { ambito: "daily", llaves: 2 }
);
console.log("✓ permisos y parseo de opciones");

/* ---- panel de botones ---- */

const modal = regModal("daily", "zeus");
assert.equal(modal.type, 9, "el select debe abrir un modal");
assert.equal(modal.data.custom_id, "m:reg:daily:zeus");
assert.equal(
  modalValue({ data: { components: [{ components: [{ custom_id: "llaves", value: "3" }] }] } }, "llaves"),
  "3"
);
// El desplegable no puede pasar de 25 opciones (límite de Discord)
assert.ok(bossSelect("daily").components[0].components[0].options.length <= 25);
// Máximo 5 botones por fila y 5 filas
for (const row of panelMessage().components) assert.ok(row.components.length <= 5);
console.log("✓ panel: desplegable → modal → registro");

/* ---- firma Ed25519 ---- */

const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const pubHex = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");

const body = JSON.stringify({ type: 1 });
const ts = String(Math.floor(Date.now() / 1000));
const sig = new Uint8Array(
  await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(ts + body))
);
const sigHex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");

const fakeReq = (s, t) => ({ headers: new Headers({ "x-signature-ed25519": s, "x-signature-timestamp": t }) });

assert.equal(await verifyRequest(fakeReq(sigHex, ts), body, pubHex), true, "firma válida aceptada");
assert.equal(await verifyRequest(fakeReq(sigHex, ts), body + "x", pubHex), false, "cuerpo manipulado rechazado");
assert.equal(await verifyRequest({ headers: new Headers() }, body, pubHex), false, "sin cabeceras rechazado");
console.log("✓ verificación de firma Ed25519");

console.log("\nTodo OK");
