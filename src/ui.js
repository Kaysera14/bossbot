import { BOSSES, SCOPES, GROUP_SIZE } from "./config.js";
import { keyPlan, groupStats, dedupePool } from "./matchmaker.js";
import { nextDailyReset, discordTime } from "./time.js";
import * as T from "./strings.js";

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

	const fields = [
		{
			name: `Miembros (${regs.length}/${GROUP_SIZE}) · ${T.estadoMiembros(closed, faltan)}`,
			value:
				regs
					.map((r) =>
						T.lineaMiembro(
							r.userId,
							(r.scopes ?? [r.scope]).map((sc) => SCOPES[sc]?.emoji ?? "").join(""),
							r,
						),
					)
					.join("\n") || T.SIN_MIEMBROS,
		},
		{ name: T.CAMPO_RUNS_NECESARIAS, value: String(runs), inline: true },
		{ name: T.campoLlaves(boss), value: String(keys), inline: true },
		{
			name: T.CAMPO_ABRE_PUERTAS,
			value: plan.length
				? plan.map((p) => T.lineaAbrePuertas(p.userId, p.use)).join(", ")
				: T.NADIE_TIENE_LLAVES,
		},
	];

	if (deficit) {
		fields.push({ name: T.CAMPO_FALTAN_LLAVES, value: T.faltanLlavesTexto(deficit, boss) });
	}

	if (!closed && faltan > 0) {
		fields.push({ name: "\u200b", value: T.sigueAbiertoTexto(boss) });
	}

	return {
		title: T.groupEmbedTitulo(boss, groupId),
		color: deficit ? AMBAR : VERDE,
		fields,
		footer: { text: T.GROUP_EMBED_FOOTER },
	};
}

export const groupButtons = (groupId, closed = false) => [
	{
		type: 1,
		components: [
			{
				type: 2,
				custom_id: `g:done:${groupId}`,
				label: T.BOTON_COMPLETADO,
				emoji: { name: "✅" },
				style: 3,
			},
			...(closed
				? []
				: [
						{
							type: 2,
							custom_id: `g:lock:${groupId}`,
							label: T.BOTON_CERRAR_GRUPO,
							emoji: { name: "🔒" },
							style: 1,
						},
					]),
			{
				type: 2,
				custom_id: `g:leave:${groupId}`,
				label: T.BOTON_SALIR_DEL_GRUPO,
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
							label: T.botonCerrarNum(group.id),
							emoji: { name: "🔒" },
							style: 1,
						},
					]),
			{
				type: 2,
				custom_id: `s:done:${group.id}`,
				label: T.botonCompletadoNum(group.id),
				emoji: { name: "✅" },
				style: 3,
			},
			{
				type: 2,
				custom_id: `s:leave:${group.id}`,
				label: T.botonSalirNum(group.id),
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
				label: T.botonQuitarCola(r.boss, r.scope),
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

		fields.push({
			name: T.tituloGrupoStatus(
				group.boss,
				SCOPES[yo?.scope]?.label ?? "",
				group.id,
				regs.length,
				T.estadoStatus(group.closed, faltan),
			),
			value: [
				T.companerosTexto(
					regs
						.filter((r) => r.userId !== uid)
						.map((r) => `<@${r.userId}>`)
						.join(", "),
				),
				T.runsDelGrupoTexto(runs, yo?.need ?? 0),
				mio ? T.abrePuertasTexto(mio.use, group.boss) : T.NO_ABRES_INVITADO,
				deficit ? T.faltanLlavesEnGrupo(deficit) : null,
			]
				.filter(Boolean)
				.join("\n"),
		});
	}

	for (const r of cola) {
		fields.push({
			name: T.tituloColaStatus(r.boss, SCOPES[r.scope].label),
			value: T.enColaTexto(r.support, r.need, r.keys),
		});
	}

	if (!fields.length) {
		return {
			title: T.STATUS_TITULO,
			color: AZUL,
			description: T.STATUS_SIN_NADA,
			footer: sinCanal ? { text: T.STATUS_FOOTER_SIN_CANAL } : undefined,
		};
	}

	return {
		title: T.STATUS_TITULO,
		color: AZUL,
		description: T.statusProximoReset(discordTime(nextDailyReset())),
		fields,
		footer: { text: sinCanal ? T.STATUS_FOOTER_SIN_CANAL : T.STATUS_FOOTER_NORMAL },
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
		const lineas = [];

		for (const { group, regs } of grupos) {
			const faltan = GROUP_SIZE - regs.length;
			lineas.push(
				T.lineaGrupoAbierto(
					group.id,
					regs.length,
					regs.map((r) => `<@${r.userId}>`).join(", "),
					faltan,
				),
			);
		}

		if (espera.length) {
			lineas.push(
				T.lineaEsperaTexto(
					espera
						.map((r) => T.esperaPersonaTexto(r.userId, r.support || r.need === 0, r.need, r.keys))
						.join(", "),
				),
			);
		}

		return {
			name: T.tituloJefeAmbito(boss, SCOPES[scope]?.emoji ?? "", SCOPES[scope]?.label ?? ""),
			value: lineas.join("\n").slice(0, 1024) || "—",
		};
	});

	// Un botón por cada (ámbito, jefe) con actividad: abre la misma ventanita
	// de registro que "Me faltan jefes", solo que sin pasar por el desplegable
	// porque el jefe ya se sabe. Da igual si ya hay grupo o solo cola: el
	// botón no "entra" en nada mágicamente, solo te registra, así que es
	// igual de útil para completar un grupo abierto que para ser el segundo
	// de alguien que está solo esperando compañero.
	const conActividad = entradas.slice(0, 20);
	const components = [];
	for (let i = 0; i < conActividad.length; i += 5) {
		components.push({
			type: 1,
			components: conActividad.slice(i, i + 5).map(({ scope, boss, grupos }) => ({
				type: 2,
				custom_id: `o:join:${scope}:${boss}`,
				label: T.botonUnirseLabel(grupos.length > 0, boss, SCOPES[scope].label),
				emoji: { name: "➕" },
				style: 3,
			})),
		});
	}

	if (!fields.length) {
		return {
			embed: { title: T.OPEN_REQUESTS_TITULO, color: AZUL, description: T.OPEN_REQUESTS_VACIO },
			components: [],
		};
	}

	return {
		embed: {
			title: T.OPEN_REQUESTS_TITULO,
			color: AZUL,
			description: T.OPEN_REQUESTS_DESCRIPCION,
			fields,
			footer: { text: T.OPEN_REQUESTS_FOOTER },
		},
		components,
	};
}
