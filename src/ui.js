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
			value: `Sigue abierto: si alguien más se apunta a ${b.label} entrará aquí. Podéis cerrarlo ya con el botón 🔒.`,
		});
	}

	return {
		title: `${b.emoji} ${b.label} · Grupo #${groupId}`,
		color: deficit ? AMBAR : VERDE,
		fields,
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
export function statusButtons(grupos) {
	return grupos.slice(0, 4).map(({ group }) => ({
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
}

export function statusEmbed(uid, grupos, cola) {
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
		};
	}

	return {
		title: "Tu situación",
		color: AZUL,
		description: `Próximo reset diario: ${discordTime(nextDailyReset())}`,
		fields,
		footer: {
			text: "Los diarios se borran a las 02:00; los semanales, los lunes a las 02:00",
		},
	};
}
