import { BOSSES, SCOPES, GROUP_SIZE } from "./config.js";
import { keyPlan, groupStats, dedupePool } from "./matchmaker.js";
import { nextDailyReset, discordTime } from "./time.js";

const VERDE = 0x2b9348;
const AMBAR = 0xd9822b;
const AZUL = 0x4a6fa5;

export function groupEmbed(groupId, boss, regsBruto, closed = false) {
	const b = BOSSES[boss];
	// Una persona apuntada en diario y semanal son dos filas: se fusionan para
	// no contarla dos veces ni duplicar sus llaves.
	const regs = dedupePool(regsBruto);
	const { runs, keys, deficit } = groupStats(regs);
	const plan = keyPlan(regs, runs);

	const faltan = GROUP_SIZE - regs.length;
	const estado = closed
		? "🔒 Cerrado"
		: `🟢 Abierto — ${faltan > 0 ? `falta${faltan === 1 ? "" : "n"} ${faltan}` : "completo"}`;

	const fields = [
		{
			name: `Miembros (${regs.length}/${GROUP_SIZE}) · ${estado}`,
			value:
				regs
					.map(
						(r) =>
							`• <@${r.userId}> ${(r.scopes ?? [r.scope]).map((sc) => SCOPES[sc]?.emoji ?? "").join("")} — ` +
							`${r.support ? "apoyo" : `${r.need} kill${r.need === 1 ? "" : "s"}`} · 🔑 ${r.keys}`,
					)
					.join("\n") || "—",
		},
		{ name: "Runs necesarias", value: String(runs), inline: true },
		{ name: `Llaves (${b.key})`, value: String(keys), inline: true },
		{
			name: "Abre puertas",
			value: plan.length
				? plan.map((p) => `<@${p.userId}> ×${p.use}`).join(", ")
				: "_nadie tiene llaves_",
		},
	];

	if (deficit) {
		fields.push({
			name: "⚠️ Faltan llaves",
			value: `Necesitáis ${deficit} ${b.key} más. Usad \`/apoyo\` o pedidlas en el clan.`,
		});
	}

	if (!closed && faltan > 0) {
		fields.push({
			name: "\u200b",
			value: `Sigue abierto: si alguien más se apunta a ${b.label} entrará aquí.`,
		});
	}

	return {
		title: `${b.emoji} ${b.label} · Grupo #${groupId}`,
		color: deficit ? AMBAR : VERDE,
		fields,
		footer: {
			text: "Para cerrar, marcar completado o salir del grupo, usa /grupo (solo lo ven sus miembros)",
		},
	};
}

export const groupButtons = (groupId, closed = false) => [
	{
		type: 1,
		components: [
			{
				type: 2,
				custom_id: `g:done:${groupId}`,
				label: "Completado",
				emoji: { name: "✅" },
				style: 3,
			},
			...(closed
				? []
				: [
						{
							type: 2,
							custom_id: `g:lock:${groupId}`,
							label: "Cerrar grupo",
							emoji: { name: "🔒" },
							style: 1,
						},
					]),
			{
				type: 2,
				custom_id: `g:leave:${groupId}`,
				label: "Salir del grupo",
				emoji: { name: "🚪" },
				style: 4,
			},
		],
	},
];

/** Botones de acción para los grupos que salen en /grupo. */
export function statusButtons(grupos, cola = []) {
	const filas = grupos.slice(0, 4).map(({ group }) => ({
		type: 1,
		components: [
			...(group.closed
				? []
				: [
						{
							type: 2,
							custom_id: `s:lock:${group.id}`,
							label: `Cerrar #${group.id}`,
							emoji: { name: "🔒" },
							style: 1,
						},
					]),
			{
				type: 2,
				custom_id: `s:done:${group.id}`,
				label: `Completado #${group.id}`,
				emoji: { name: "✅" },
				style: 3,
			},
			{
				type: 2,
				custom_id: `s:leave:${group.id}`,
				label: `Salir de #${group.id}`,
				emoji: { name: "🚪" },
				style: 4,
			},
		],
	}));

	// Sin esto, quien no tiene acceso a comandos de barra no podía borrar UN
	// registro en cola concreto: solo existía "Hoy no puedo", que quita todo.
	const huecosLibres = 5 - filas.length;
	const filasCola = cola.slice(0, huecosLibres).map((r) => ({
		type: 1,
		components: [
			{
				type: 2,
				custom_id: `s:cancel:${r.scope}:${r.boss}`,
				label: `Quitar ${BOSSES[r.boss]?.label ?? r.boss} (${SCOPES[r.scope]?.label ?? r.scope})`,
				emoji: { name: "🗑️" },
				style: 2,
			},
		],
	}));

	return [...filas, ...filasCola];
}

export function statusEmbed(uid, grupos, cola, sinCanal = false) {
	const fields = [];

	for (const { group, regs: regsBruto } of grupos) {
		const regs = dedupePool(regsBruto);
		const b = BOSSES[group.boss];
		const { runs, deficit } = groupStats(regs);
		const yo = regs.find((r) => r.userId === uid);
		const mio = keyPlan(regs, runs).find((p) => p.userId === uid);
		const faltan = GROUP_SIZE - regs.length;
		const estado = group.closed
			? "🔒 cerrado"
			: `🟢 abierto${faltan > 0 ? `, falta${faltan === 1 ? "" : "n"} ${faltan}` : ""}`;

		fields.push({
			name: `${b.emoji} ${b.label} · ${SCOPES[yo?.scope]?.label ?? ""} · Grupo #${group.id} (${regs.length}/${GROUP_SIZE}) ${estado}`,
			value: [
				`Compañeros: ${
					regs
						.filter((r) => r.userId !== uid)
						.map((r) => `<@${r.userId}>`)
						.join(", ") || "—"
				}`,
				`Runs del grupo: **${runs}** (tú necesitas ${yo?.need ?? 0})`,
				mio
					? `🔑 Te toca abrir **${mio.use}** puerta(s) con ${b.key}`
					: "🔑 Tú no abres: entras invitado",
				deficit ? `⚠️ Faltan ${deficit} llaves en el grupo` : null,
			]
				.filter(Boolean)
				.join("\n"),
		});
	}

	for (const r of cola) {
		const b = BOSSES[r.boss];
		fields.push({
			name: `${b.emoji} ${b.label} · ${SCOPES[r.scope].label}`,
			value: `⏳ En cola — ${r.support ? "apoyo" : `${r.need} kills`} · 🔑 ${r.keys}\nEsperando a que se apunte más gente.`,
		});
	}

	if (!fields.length) {
		return {
			title: "Tu situación",
			color: AZUL,
			description:
				"No tienes nada registrado. Usa `/boss` para apuntar un jefe o `/apoyo` si solo tienes llaves.",
			footer: sinCanal
				? {
						text: "⚠️ Sin canal de avisos: nadie recibe notificaciones. Que un admin use /configurar",
					}
				: undefined,
		};
	}

	return {
		title: "Tu situación",
		color: AZUL,
		description: `Próximo reset diario: ${discordTime(nextDailyReset())}`,
		fields,
		footer: {
			text: sinCanal
				? "⚠️ Sin canal de avisos: nadie recibe notificaciones. Que un admin use /configurar"
				: "Los diarios se borran a las 02:00; los semanales, los lunes a las 02:00",
		},
	};
}

/**
 * Vista de "solicitudes abiertas": grupos a los que aún se puede entrar y
 * quién está esperando, agrupado por ámbito + jefe (van separados: un grupo
 * diario y uno semanal del mismo jefe son cosas distintas).
 */
export function openRequestsEmbed(gruposAbiertos, cola) {
	const porClave = {};
	const clave = (scope, boss) => `${scope}|${boss}`;

	for (const { group, regs } of gruposAbiertos) {
		const scope = group.scope === "mixto" ? "daily" : group.scope; // legacy
		(porClave[clave(scope, group.boss)] ??= {
			scope,
			boss: group.boss,
			grupos: [],
			espera: [],
		}).grupos.push({ group, regs: dedupePool(regs) });
	}
	for (const r of dedupePool(cola)) {
		(porClave[clave(r.scope, r.boss)] ??= {
			scope: r.scope,
			boss: r.boss,
			grupos: [],
			espera: [],
		}).espera.push(r);
	}

	const entradas = Object.values(porClave).slice(0, 25);

	const fields = entradas.map(({ scope, boss, grupos, espera }) => {
		const b = BOSSES[boss];
		const lineas = [];

		for (const { group, regs } of grupos) {
			const faltan = GROUP_SIZE - regs.length;
			lineas.push(
				`**#${group.id}** (${regs.length}/${GROUP_SIZE}) — ` +
					`${regs.map((r) => `<@${r.userId}>`).join(", ")} · ` +
					`falta${faltan === 1 ? "" : "n"} ${faltan}`,
			);
		}

		if (espera.length) {
			lineas.push(
				`⏳ En cola: ${espera
					.map(
						(r) =>
							`<@${r.userId}> (${r.support || r.need === 0 ? "apoyo" : `${r.need}`} · 🔑 ${r.keys})`,
					)
					.join(", ")}`,
			);
		}

		return {
			name: `${b.emoji} ${b.label} · ${SCOPES[scope]?.emoji ?? ""} ${SCOPES[scope]?.label ?? ""}`,
			value: lineas.join("\n").slice(0, 1024) || "—",
		};
	});

	// Un botón "Unirme" por cada (ámbito, jefe) que tenga un grupo con hueco
	// de verdad — a la cola pura no hay a qué unirse todavía, solo apuntarse.
	const conHueco = entradas.filter((e) => e.grupos.length > 0).slice(0, 20);
	const components = [];
	for (let i = 0; i < conHueco.length; i += 5) {
		components.push({
			type: 1,
			components: conHueco.slice(i, i + 5).map(({ scope, boss }) => ({
				type: 2,
				custom_id: `o:join:${scope}:${boss}`,
				label: `Unirme a ${BOSSES[boss].label} (${SCOPES[scope].label})`,
				emoji: { name: "➕" },
				style: 3,
			})),
		});
	}

	if (!fields.length) {
		return {
			embed: {
				title: "🔎 Solicitudes abiertas",
				color: AZUL,
				description:
					"No hay ningún grupo abierto ni nadie en cola. Apúntate con **Me faltan jefes** y serás el primero.",
			},
			components: [],
		};
	}

	return {
		embed: {
			title: "🔎 Solicitudes abiertas",
			color: AZUL,
			description:
				"Grupos a los que aún se puede entrar. Pulsa **Unirme** o apúntate con " +
				"**Me faltan jefes** y el bot te mete en uno automáticamente.",
			fields,
			footer: { text: "Los grupos se cierran solos al llegar a 3" },
		},
		components,
	};
}
