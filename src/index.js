import {
	BOSSES,
	SCOPES,
	MIN_GROUP_SIZE,
	GROUP_SIZE,
	MATCH_ACROSS_SCOPES,
	STALE_CLOSED_HOURS,
	STALE_CLOSED_WEEKLY_HOURS,
} from "./config.js";
import * as db from "./db.js";
import {
	matchPool,
	pickForGroup,
	groupStats,
	dedupePool,
	keyPlan,
} from "./matchmaker.js";
import {
	groupEmbed,
	groupButtons,
	statusEmbed,
	statusButtons,
	openRequestsEmbed,
} from "./ui.js";
import { panelMessage, bossSelect, regModal, modalValue } from "./panel.js";
import * as T from "./strings.js";
import {
	verifyRequest,
	InteractionType,
	CallbackType,
	json,
	reply,
	updateMessage,
	sendMessage,
	postMessage,
	editMessage,
	deleteMessage,
	opts,
	userId,
	isAdmin,
} from "./discord.js";

/* ---------- emparejar, anunciar, disolver ---------- */

/**
 * Empareja y anuncia. Las llamadas a la API de Discord son lentas y Discord
 * corta la interacción a los 3 segundos, así que si se pasa `ctx` se responde
 * antes y los anuncios salen después con ctx.waitUntil().
 */
export async function matchAndAnnounce(env, guildId, ctx = null) {
	const nuevos = [];
	const ampliados = [];

	// Foto de qué grupos estaban abiertos antes de tocar nada: al final se
	// comparan los estados para avisar de TODOS los que se hayan completado,
	// se hayan llenado por el barrido, por una alta o por un cierre manual.
	const abiertosAntes = await db.openGroupIds(env.DB, guildId);

	// Barrido de seguridad en 4 consultas: pone al día runs, llaves y estado de
	// todos los grupos, incluidos los cerrados y los heredados de otra versión.
	await db.syncAllGroups(env.DB, guildId, GROUP_SIZE);

	// Diario y semanal van a la misma bolsa solo si MATCH_ACROSS_SCOPES está
	// activado. Por defecto van separados: cada ámbito con sus propios grupos
	// abiertos, para no mezclar runs de tamaños muy distintos en un grupo.
	const scopesAProcesar = MATCH_ACROSS_SCOPES ? [null] : Object.keys(SCOPES);

	for (const scope of scopesAProcesar) {
		let pool = scope
			? await db.unassignedRegs(env.DB, guildId, scope)
			: await db.unassignedAll(env.DB, guildId);

		// 1) Primero se rellenan los grupos que siguen abiertos EN ESE ÁMBITO.
		for (const { group, regs } of await db.openGroups(env.DB, guildId, scope)) {
			const elegidos = pickForGroup(
				regs,
				pool.filter((r) => r.boss === group.boss),
			);

			for (const c of elegidos) {
				await db.addToGroup(env.DB, guildId, group.id, c.userId, c.boss);
				// Fuera de la bolsa TODOS sus registros de ese jefe, no solo uno.
				pool = pool.filter(
					(r) => !(r.userId === c.userId && r.boss === c.boss),
				);
			}

			// Se resincroniza siempre, entre gente o no: así un grupo que ya estaba
			// lleno (por ejemplo creado por una versión anterior) acaba cerrándose.
			const res = await db.resyncGroup(env.DB, guildId, group.id, GROUP_SIZE);
			if (elegidos.length) {
				ampliados.push({
					id: group.id,
					nuevos: elegidos.map((c) => c.userId),
					lleno: !!res?.closed,
				});
			} else if (res && !res.deleted && res.closed) {
				ampliados.push({ id: group.id, nuevos: [], lleno: true });
			}
		}

		// 2) Con quien quede sin colocar, se crean grupos nuevos.
		for (const g of matchPool(pool)) {
			const miembros = pool.filter(
				(r) => g.members.includes(r.userId) && r.boss === g.boss,
			);
			if (!miembros.length) continue;
			const creado = await db.createGroup(env.DB, guildId, miembros, g);
			if (g.members.length >= GROUP_SIZE) {
				await db.updateGroup(env.DB, creado.id, {
					runs: g.runs,
					keys: g.keys,
					closed: true,
				});
			}
			nuevos.push(creado);
			pool = pool.filter((r) => !miembros.includes(r));
		}
	}

	// Grupos que han pasado de abiertos a cerrados en esta pasada. Se excluyen
	// los recién creados, que ya se anuncian con su propio mensaje.
	const idsNuevos = new Set(nuevos.map((g) => g.id));
	const completados = (await db.allGroups(env.DB, guildId))
		.filter((g) => g.closed && abiertosAntes.has(g.id) && !idsNuevos.has(g.id))
		.map((g) => g.id);

	const { announceChannelId } = await db.getConfig(env.DB, guildId);
	if (!announceChannelId) return nuevos;

	const anunciar = () =>
		publicarAvisos(env, guildId, announceChannelId, nuevos, ampliados, completados);
	if (ctx) {
		// Se responde ya y los mensajes salen justo después.
		ctx.waitUntil(anunciar());
		return nuevos;
	}
	await anunciar();
	return nuevos;
}

async function publicarAvisos(
	env,
	guildId,
	announceChannelId,
	nuevos,
	ampliados,
	completados = [],
) {
	for (const g of nuevos) {
		const { group, regs } = await db.getGroup(env.DB, guildId, g.id);
		const msg = await sendMessage(env.DISCORD_TOKEN, announceChannelId, {
			content: `${g.members.map((u) => `<@${u}>`).join(" ")} ¡grupo formado!`,
			embeds: [groupEmbed(g.id, g.boss, regs, !!group.closed)],
			allowed_mentions: { users: g.members },
			// Sin botones aquí: para no dar acciones sobre grupos ajenos a quien
			// simplemente pase por el canal. Cada uno gestiona SU grupo desde
			// /grupo, que ya es privado y solo enseña lo que le corresponde.
		});
		if (msg?.id)
			await db.setGroupMessage(env.DB, g.id, announceChannelId, msg.id);
	}

	for (const a of ampliados) {
		await refreshGroupMessage(env, guildId, a.id);
		if (!a.nuevos.length) continue; // solo se ha cerrado, no hay a quién avisar

		await sendMessage(env.DISCORD_TOKEN, announceChannelId, {
			content: `➕ ${a.nuevos.map((u) => `<@${u}>`).join(" y ")} se une al grupo #${a.id}.`,
			allowed_mentions: { users: a.nuevos },
		});
	}

	// Aviso de grupo completo, mencionando a TODOS sus miembros.
	for (const id of completados) {
		const g = await db.getGroup(env.DB, guildId, id);
		if (!g) continue;

		const miembros = [...new Set(g.regs.map((r) => r.userId))];
		const { runs } = groupStats(g.regs);
		const plan = keyPlan(g.regs, runs);

		await sendMessage(env.DISCORD_TOKEN, announceChannelId, {
			content: T.grupoCompletoTexto(
				id,
				g.group.boss,
				miembros.map((u) => `<@${u}>`).join(" "),
				runs,
				plan.length
					? T.abrePuertasResumen(plan.map((p) => T.lineaAbrePuertas(p.userId, p.use)).join(", "))
					: T.NADIE_TIENE_LLAVES_PEDIR,
			),
			allowed_mentions: { users: miembros },
		});
	}
}

async function refreshGroupMessage(env, guildId, groupId) {
	const g = await db.getGroup(env.DB, guildId, groupId);
	if (!g?.group.message_id) return;
	await editMessage(env.DISCORD_TOKEN, g.group.channel_id, g.group.message_id, {
		embeds: [groupEmbed(g.group.id, g.group.boss, g.regs, !!g.group.closed)],
		components: [],
	});
}

/**
 * Tras una baja: los grupos que se quedan cortos se disuelven y sus miembros
 * vuelven a la cola, para que el bot pueda recolocarlos con otra gente.
 */
export async function limpiarYRecolocar(env, guildId) {
	const cortos = await db.undersizedGroups(env.DB, guildId, MIN_GROUP_SIZE);

	for (const g of cortos) {
		await db.dissolveGroup(env.DB, guildId, g.id);
		if (g.message_id) {
			await editMessage(env.DISCORD_TOKEN, g.channel_id, g.message_id, {
				content: T.GRUPO_DESHECHO_POR_BAJA,
				embeds: [],
				components: [],
			});
		}
	}

	await matchAndAnnounce(env, guildId);
}

/* ---------- registro (compartido por comando y panel) ---------- */

async function registrar(env, guildId, uid, scope, boss, need, keys, ctx) {
	const support = need === 0;
	await db.upsertReg(env.DB, guildId, scope, {
		userId: uid,
		boss,
		need,
		keys,
		support,
	});

	const linea = support
		? T.registradoApoyo(boss, SCOPES[scope].label, keys)
		: T.registradoNecesita(boss, SCOPES[scope].label, need, keys);

	await matchAndAnnounce(env, guildId, ctx);

	// Puede haber entrado en un grupo nuevo o en uno abierto que ya existía.
	const tras = await db.getReg(env.DB, guildId, scope, uid, boss);
	if (!tras?.groupId) {
		const { announceChannelId } = await db.getConfig(env.DB, guildId);
		return `${linea}\n${T.AUN_NO_HAY_GENTE}${announceChannelId ? "" : T.AVISO_SIN_CANAL_COLA}`;
	}

	const { announceChannelId } = await db.getConfig(env.DB, guildId);
	const sinCanal = announceChannelId ? "" : T.AVISO_SIN_CANAL_GRUPO;

	const g = await db.getGroup(env.DB, guildId, tras.groupId);
	const faltan = GROUP_SIZE - (dedupePool(g?.regs ?? []).length ?? 0);
	const completo = !!(g?.group.closed || faltan <= 0);
	return `${sinCanal}${linea}\n${T.estasEnGrupoTexto(tras.groupId, completo, faltan)}${sinCanal}`;
}

/* ---------- salir de todo ---------- */

async function salirDeTodo(env, guildId, uid, ctx) {
	const borrados = await db.removeAllRegs(env.DB, guildId, uid);
	if (!borrados.length) return T.NO_APUNTADO_A_NADA;

	const grupos = [...new Set(borrados.map((r) => r.groupId).filter(Boolean))];

	ctx.waitUntil(
		(async () => {
			for (const gid of grupos) {
				await db.resyncGroup(env.DB, guildId, gid, GROUP_SIZE);
				await refreshGroupMessage(env, guildId, gid);
			}
			await limpiarYRecolocar(env, guildId);
		})(),
	);

	const lista = borrados.map((r) => `${BOSSES[r.boss].label} (${SCOPES[r.scope].label})`).join(", ");
	return [
		T.fueraDeTodoTexto(lista),
		grupos.length ? T.avisoGruposTexto(grupos.length) : T.SOLO_EN_COLA,
		T.CUANDO_VUELVAS,
	].join("\n");
}

/* ---------- estado ---------- */

async function verMiSituacion(env, guildId, uid) {
	const regs = await db.userRegs(env.DB, guildId, uid);
	const grupos = [];
	const cola = [];
	const vistos = new Set();

	// Se recalcula todo antes de enseñarlo: así nunca se muestra un estado viejo.
	await db.syncAllGroups(env.DB, guildId, GROUP_SIZE);

	for (const r of regs) {
		if (r.groupId) {
			// El mismo grupo puede llegar por dos registros (diario y semanal).
			if (vistos.has(r.groupId)) continue;
			vistos.add(r.groupId);
			const g = await db.getGroup(env.DB, guildId, r.groupId);
			if (g) grupos.push(g);
		} else {
			cola.push(r);
		}
	}
	const { announceChannelId } = await db.getConfig(env.DB, guildId);
	return {
		embed: statusEmbed(uid, grupos, cola, !announceChannelId),
		components: statusButtons(grupos, cola),
	};
}

/* ---------- comandos ---------- */

async function cmdBoss(i, env, ctx, support) {
	const o = opts(i);
	const need = support ? 0 : (o.cantidad ?? 1);
	const texto = await registrar(
		env,
		i.guild_id,
		userId(i),
		o.ambito,
		o.jefe,
		need,
		o.llaves ?? 0,
		ctx,
	);
	return reply(texto);
}

async function cmdGrupo(i, env) {
	const { embed, components } = await verMiSituacion(
		env,
		i.guild_id,
		userId(i),
	);
	return reply(null, { embeds: [embed], components });
}

const cmdFuera = async (i, env, ctx) =>
	reply(await salirDeTodo(env, i.guild_id, userId(i), ctx));

async function cmdQuitar(i, env, ctx) {
	const o = opts(i);
	const res = await db.removeReg(
		env.DB,
		i.guild_id,
		o.ambito,
		userId(i),
		o.jefe,
	);
	if (!res) return reply(T.NO_TENIAS_NADA_AHI);

	ctx.waitUntil(
		(async () => {
			if (res.groupId) {
				await db.resyncGroup(env.DB, i.guild_id, res.groupId, GROUP_SIZE);
				await refreshGroupMessage(env, i.guild_id, res.groupId);
			}
			await limpiarYRecolocar(env, i.guild_id);
		})(),
	);
	return reply(T.registroBorradoTexto(BOSSES[o.jefe].label, SCOPES[o.ambito].label));
}

async function cmdConfigurar(i, env) {
	const cfg = await db.getConfig(env.DB, i.guild_id);
	if (!isAdmin(i, cfg.adminRoleIds)) return reply(T.SOLO_ADMINS);

	const o = opts(i);
	const patch = {};
	if (o.canal) patch.announceChannelId = o.canal;
	if (o.rol_admin)
		patch.adminRoleIds = [...new Set([...cfg.adminRoleIds, o.rol_admin])];
	const nuevo = await db.setConfig(env.DB, i.guild_id, patch);

	// Prueba real: si el bot no puede escribir ahí, mejor saberlo ahora que
	// descubrirlo cuando nadie reciba los avisos.
	let prueba = T.CONFIGURAR_SIN_CANAL;
	if (nuevo.announceChannelId) {
		const res = await postMessage(env.DISCORD_TOKEN, nuevo.announceChannelId, {
			content: T.CONFIGURAR_MENSAJE_PRUEBA,
		});
		prueba = res.ok
			? T.configurarPruebaOk(nuevo.announceChannelId)
			: T.configurarPruebaError(nuevo.announceChannelId, res.motivo);
	}

	return reply(
		[
			T.configurarCanalLinea(nuevo.announceChannelId),
			T.configurarRolesLinea(nuevo.adminRoleIds.map((r) => `<@&${r}>`).join(", ")),
			"",
			prueba,
			"",
			T.CONFIGURAR_USA_PANEL,
		].join("\n"),
	);
}

async function cmdPanel(i, env) {
	const cfg = await db.getConfig(env.DB, i.guild_id);
	if (!isAdmin(i, cfg.adminRoleIds)) return reply(T.SOLO_ADMINS);
	await publicarPanel(env, i.guild_id, i.channel_id);
	return reply(T.PANEL_PUBLICADO, { ephemeral: true });
}

/**
 * Publica el panel en un canal y borra el anterior si lo había, para no
 * dejar paneles viejos y desincronizados tirados por el servidor.
 */
export async function publicarPanel(env, guildId, channelId) {
	const previo = await db.getPanelLocation(env.DB, guildId);
	if (previo.channelId && previo.messageId) {
		await deleteMessage(env.DISCORD_TOKEN, previo.channelId, previo.messageId);
	}

	const res = await postMessage(env.DISCORD_TOKEN, channelId, panelMessage());
	if (res.ok) await db.setPanelLocation(env.DB, guildId, channelId, res.id);
	return res;
}

/** Explica quién sigue en cola y por qué no se ha formado grupo. */
async function resumenCola(env, guildId) {
	// Deduplicado: quien esté apuntado en los dos ámbitos es una sola persona.
	const pool = dedupePool(await db.unassignedAll(env.DB, guildId));
	const porJefe = {};
	for (const r of pool) (porJefe[r.boss] ??= []).push(r);

	return Object.entries(porJefe).map(([boss, regs]) => {
		const necesitan = regs.filter((r) => !r.support && r.need > 0);
		const apoyos = regs.filter((r) => r.support || r.need === 0);
		const llaves = regs.reduce((a, r) => a + r.keys, 0);

		const motivo = !necesitan.length
			? T.nadieLoNecesita
			: T.faltanPersonasTexto(Math.max(1, MIN_GROUP_SIZE - regs.length));

		return T.resumenColaJefeTexto(boss, necesitan.length, apoyos.length, llaves, motivo);
	});
}

async function cmdEmparejar(i, env, ctx) {
	const cfg = await db.getConfig(env.DB, i.guild_id);
	if (!isAdmin(i, cfg.adminRoleIds)) return reply(T.SOLO_ADMINS);

	const creados = await matchAndAnnounce(env, i.guild_id, ctx);
	const cola = await resumenCola(env, i.guild_id);
	const avisoCanal = cfg.announceChannelId ? "" : T.AVISO_SIN_CANAL_EMPAREJAR;

	const grupos = (await db.allGroups(env.DB, i.guild_id)).map((g) =>
		T.lineaGrupoResumen(
			g.id,
			BOSSES[g.boss]?.emoji ?? "",
			BOSSES[g.boss]?.label ?? g.boss,
			g.n,
			T.estadoGrupoResumen(g.closed, g.locked),
		),
	);

	return reply(
		[
			creados.length ? T.formadosGruposTexto(creados.length) : T.noSeHanFormadoGrupos,
			grupos.length ? T.GRUPOS_AHORA_MISMO : "",
			...grupos,
			cola.length ? T.EN_COLA_TITULO : T.NO_QUEDA_NADIE_EN_COLA,
			...cola,
			avisoCanal,
		]
			.filter(Boolean)
			.join("\n"),
	);
}

/**
 * Deshace todos los grupos. Pide confirmación porque no tiene vuelta atrás.
 * Solo por comando escrito: no está en el panel a propósito.
 */
async function cmdBorrarGrupos(i, env) {
	const cfg = await db.getConfig(env.DB, i.guild_id);
	if (!isAdmin(i, cfg.adminRoleIds)) return reply(T.SOLO_ADMINS);

	const grupos = await db.allGroups(env.DB, i.guild_id);
	if (!grupos.length) return reply(T.NO_HAY_GRUPOS_AHORA);

	const detalle = grupos
		.map((g) => T.lineaBorrarGrupo(g.id, BOSSES[g.boss]?.label ?? g.boss, g.n))
		.join("\n");

	return reply(T.confirmarBorrarTexto(grupos.length, detalle), {
		components: [
			{
				type: 1,
				components: [
					{
						type: 2,
						custom_id: "adm:wipe",
						label: T.botonConfirmarBorrar(grupos.length),
						emoji: { name: "💥" },
						style: 4,
					},
					{ type: 2, custom_id: "adm:cancel", label: T.BOTON_CANCELAR, style: 2 },
				],
			},
		],
	});
}

async function onAdminButton(i, env) {
	const cfg = await db.getConfig(env.DB, i.guild_id);
	if (!isAdmin(i, cfg.adminRoleIds)) return reply(T.SOLO_ADMINS);

	const [, action] = i.data.custom_id.split(":");
	if (action === "cancel") {
		return updateMessage({
			content: T.CANCELADO_NO_TOCADO,
			embeds: [],
			components: [],
		});
	}

	const grupos = await db.dissolveAllGroups(env.DB, i.guild_id);

	// Marca los mensajes de los grupos deshechos
	for (const g of grupos) {
		if (!g.message_id) continue;
		await editMessage(env.DISCORD_TOKEN, g.channel_id, g.message_id, {
			content: T.grupoDeshechoAdminTexto(g.id),
			embeds: [],
			components: [],
		});
	}

	return updateMessage({
		content: T.deshechosResumenTexto(grupos.length),
		embeds: [],
		components: [],
	});
}

async function cmdReset(i, env) {
	const cfg = await db.getConfig(env.DB, i.guild_id);
	if (!isAdmin(i, cfg.adminRoleIds)) return reply(T.SOLO_ADMINS);
	const o = opts(i);
	await db.wipeScope(env.DB, i.guild_id, o.ambito);
	return reply(T.resetHechoTexto(SCOPES[o.ambito].label));
}

/* ---------- botones del panel ---------- */

async function onPanel(i, env, ctx) {
	const [, action, arg] = i.data.custom_id.split(":");
	const uid = userId(i);

	if (action === "add") return reply(null, { ...bossSelect(arg) });
	if (action === "mine") {
		const { embed, components } = await verMiSituacion(env, i.guild_id, uid);
		return reply(null, { embeds: [embed], components });
	}
	if (action === "open") {
		await db.syncAllGroups(env.DB, i.guild_id, GROUP_SIZE);
		const abiertos = await db.openGroups(env.DB, i.guild_id);
		const cola = await db.unassignedAll(env.DB, i.guild_id);
		const vista = openRequestsEmbed(abiertos, cola);
		return reply(null, { embeds: [vista.embed], components: vista.components });
	}
	if (action === "out")
		return reply(await salirDeTodo(env, i.guild_id, uid, ctx));
	return reply(T.BOTON_DESCONOCIDO);
}

/** Elegir jefe en el desplegable abre el modal con las dos cifras. */
function onSelect(i) {
	const [, , scope] = i.data.custom_id.split(":");
	return json(regModal(scope, i.data.values[0]));
}

/** Botón "Unirme" de la vista de solicitudes abiertas: va directo al modal,
 * sin pasar por el desplegable, porque el jefe ya se sabe por el botón. */
function onJoinOpen(i) {
	const [, , scope, boss] = i.data.custom_id.split(":");
	return json(regModal(scope, boss));
}

async function onModal(i, env, ctx) {
	const [, , scope, boss] = i.data.custom_id.split(":");
	const need = Number.parseInt(modalValue(i, "cantidad"), 10);
	const keys = Number.parseInt(modalValue(i, "llaves"), 10);

	if (
		!Number.isInteger(need) ||
		!Number.isInteger(keys) ||
		need < 0 ||
		keys < 0 ||
		need > 999 ||
		keys > 999
	) {
		return reply(T.MODAL_NUMEROS_INVALIDOS);
	}
	return reply(
		await registrar(env, i.guild_id, userId(i), scope, boss, need, keys, ctx),
	);
}

/* ---------- botones de grupo ---------- */
/** Botones que salen dentro de /grupo: actúan y repintan la misma respuesta. */
async function onStatusButton(i, env, ctx) {
	const gid = i.guild_id;
	const uid = userId(i);
	const partes = i.data.custom_id.split(":");
	const action = partes[1];

	// "Quitar" de la cola tiene su propio formato: s:cancel:<scope>:<boss>
	// (no lleva número de grupo, porque no hay grupo, solo una fila en cola).
	if (action === "cancel") {
		const [, , scope, boss] = partes;
		await db.removeReg(env.DB, gid, scope, uid, boss);
		const { embed, components } = await verMiSituacion(env, gid, uid);
		return updateMessage({ embeds: [embed], components });
	}

	const groupId = Number(partes[2]);
	const g = await db.getGroup(env.DB, gid, groupId);
	if (g && g.regs.some((r) => r.userId === uid)) {
		// Se guardan antes de tocar la BD: completeGroup borra la fila del
		// grupo, y con ella se perdería el rastro de dónde está el mensaje.
		const { channel_id: msgChannel, message_id: msgId } = g.group;

		if (action === "lock") {
			const st = groupStats(g.regs);
			await db.updateGroup(env.DB, groupId, {
				runs: st.runs,
				keys: st.keys,
				closed: true,
				locked: true,
			});
		} else if (action === "done") {
			await db.completeGroup(env.DB, gid, groupId);
		} else if (action === "leave") {
			await db.removeUserBoss(env.DB, gid, uid, g.group.boss);
			await db.resyncGroup(env.DB, gid, groupId, GROUP_SIZE);
		}

		ctx.waitUntil(
			(async () => {
				if (action === "done") {
					// El grupo ya no existe: se borra el mensaje en vez de editarlo.
					await deleteMessage(env.DISCORD_TOKEN, msgChannel, msgId);
				} else {
					await refreshGroupMessage(env, gid, groupId);
					if (action === "leave") await limpiarYRecolocar(env, gid);
				}
			})(),
		);
	}

	const { embed, components } = await verMiSituacion(env, gid, uid);
	return updateMessage({ embeds: [embed], components });
}

async function onGroupButton(i, env, ctx) {
	const gid = i.guild_id;
	const uid = userId(i);
	const [, action, idRaw] = i.data.custom_id.split(":");
	const groupId = Number(idRaw);

	const g = await db.getGroup(env.DB, gid, groupId);
	if (!g) return reply(T.GRUPO_YA_NO_EXISTE);

	const cfg = await db.getConfig(env.DB, gid);
	if (!g.regs.some((r) => r.userId === uid) && !isAdmin(i, cfg.adminRoleIds)) {
		return reply(T.NO_ERES_DE_ESTE_GRUPO);
	}

	if (action === "lock") {
		const st = groupStats(g.regs);
		await db.updateGroup(env.DB, groupId, {
			runs: st.runs,
			keys: st.keys,
			closed: true,
			locked: true,
		});
		return updateMessage({
			embeds: [groupEmbed(groupId, g.group.boss, g.regs, true)],
			components: groupButtons(groupId, true),
		});
	}

	if (action === "done") {
		await db.completeGroup(env.DB, gid, groupId);
		ctx.waitUntil(deleteMessage(env.DISCORD_TOKEN, i.channel_id, i.message.id));
		return json({ type: CallbackType.DEFERRED_UPDATE });
	}

	if (action === "leave") {
		await db.removeUserBoss(env.DB, gid, uid, g.group.boss);
		const res = await db.resyncGroup(env.DB, gid, groupId, GROUP_SIZE);
		ctx.waitUntil(limpiarYRecolocar(env, gid));

		return updateMessage({
			embeds:
				res && !res.deleted
					? [groupEmbed(groupId, res.group.boss, res.regs, res.closed)]
					: [],
			components: res && !res.deleted ? groupButtons(groupId, res.closed) : [],
		});
	}

	return reply(T.BOTON_DESCONOCIDO);
}

/* ---------- enrutado ---------- */

const COMANDOS = {
	boss: (i, env, ctx) => cmdBoss(i, env, ctx, false),
	apoyo: (i, env, ctx) => cmdBoss(i, env, ctx, true),
	grupo: cmdGrupo,
	fuera: cmdFuera,
	quitar: cmdQuitar,
	borrargrupos: cmdBorrarGrupos,
	panel: cmdPanel,
	configurar: cmdConfigurar,
	emparejar: cmdEmparejar,
	reset: cmdReset,
};

async function handleInteraction(i, env, ctx) {
	if (i.type === InteractionType.PING) return json({ type: CallbackType.PONG });
	if (!i.guild_id)
		return reply(T.SOLO_SERVIDOR);

	await db.ensureSchema(env.DB);
	await db.ensureGuild(env.DB, i.guild_id);
	await db.applyResets(env.DB, i.guild_id);

	if (i.type === InteractionType.COMMAND) {
		const fn = COMANDOS[i.data.name];
		return fn ? fn(i, env, ctx) : reply(T.COMANDO_DESCONOCIDO);
	}

	if (i.type === InteractionType.COMPONENT) {
		const id = i.data.custom_id;
		if (id.startsWith("g:")) return onGroupButton(i, env, ctx);
		if (id.startsWith("p:")) return onPanel(i, env, ctx);
		if (id.startsWith("sel:")) return onSelect(i);
		if (id.startsWith("o:join:")) return onJoinOpen(i);
		if (id.startsWith("adm:")) return onAdminButton(i, env);
		if (id.startsWith("s:")) return onStatusButton(i, env, ctx);
	}

	if (i.type === InteractionType.MODAL && i.data.custom_id.startsWith("m:")) {
		return onModal(i, env, ctx);
	}

	return json({ type: CallbackType.DEFERRED_UPDATE });
}

export default {
	async fetch(request, env, ctx) {
		if (request.method !== "POST") {
			return new Response(T.WORKER_HEALTHCHECK, {
				status: 200,
			});
		}

		const body = await request.text();
		if (!(await verifyRequest(request, body, env.DISCORD_PUBLIC_KEY))) {
			return new Response("Bad request signature", { status: 401 });
		}

		try {
			return await handleInteraction(JSON.parse(body), env, ctx);
		} catch (err) {
			console.error(err);
			return reply(T.algoHaPetadoTexto(String(err?.message ?? err).slice(0, 300)));
		}
	},

	async scheduled(event, env, ctx) {
		await db.ensureSchema(env.DB);

		// Red de seguridad: grupos por debajo del mínimo que se hayan quedado
		// sueltos por cualquier motivo (datos antiguos, un camino no cubierto).
		// Los tres caminos normales de salida ya los disuelven al momento; esto
		// es solo un barrido de respaldo.
		for (const g of await db.undersizedGroupsGlobal(env.DB, MIN_GROUP_SIZE)) {
			await db.dissolveGroup(env.DB, g.guild_id, g.id);
		}

		// Grupos "ameba": cerrados hace mucho y nunca marcados como Completado.
		// Se dan por hechos solos para no dejarlos acumulándose sin fin.
		// Diario y semanal usan ventanas distintas (ver config.js): un grupo
		// semanal recién cerrado no puede desaparecer a las pocas horas.
		const rancios = [
			...(await db.staleClosedGroups(env.DB, STALE_CLOSED_HOURS * 3600 * 1000, "daily")),
			...(await db.staleClosedGroups(env.DB, STALE_CLOSED_WEEKLY_HOURS * 3600 * 1000, "weekly")),
			...(await db.staleClosedGroups(env.DB, STALE_CLOSED_WEEKLY_HOURS * 3600 * 1000, "mixto")),
		];
		for (const g of rancios) {
			const horas = g.scope === "daily" ? STALE_CLOSED_HOURS : STALE_CLOSED_WEEKLY_HOURS;
			await db.completeGroup(env.DB, g.guild_id, g.id);
			if (g.channel_id && g.message_id) {
				ctx.waitUntil(
					(async () => {
						// Se avisa con un mensaje aparte (nadie lo pidió, así que sí
						// conviene dejar rastro) y se borra el original, igual que
						// al completar un grupo a mano.
						await sendMessage(env.DISCORD_TOKEN, g.channel_id, {
							content: T.grupoAmebaTexto(g.id, BOSSES[g.boss]?.label ?? g.boss, horas),
						});
						await deleteMessage(env.DISCORD_TOKEN, g.channel_id, g.message_id);
					})(),
				);
			}
		}

		for (const {
			guildId,
			scopes,
			announceChannelId,
		} of await db.applyResets(env.DB)) {
			// Un grupo mixto sobrevive al reset diario con sus miembros semanales:
			// hay que recalcular runs, llaves y si sigue lleno.
			await db.syncAllGroups(env.DB, guildId, GROUP_SIZE);
			// El panel se republica cada reset DIARIO (no en el semanal, que no
			// trae reset propio salvo que coincida con uno diario también).
			if (scopes.includes("daily")) {
				const panel = await db.getPanelLocation(env.DB, guildId);
				if (panel.channelId) {
					ctx.waitUntil(publicarPanel(env, guildId, panel.channelId));
				}
			}

			if (!announceChannelId) continue;
			const nombres = scopes
				.map((s) => SCOPES[s].label.toLowerCase())
				.join(" y ");
			ctx.waitUntil(
				sendMessage(env.DISCORD_TOKEN, announceChannelId, {
					content: T.resetAutomaticoTexto(nombres),
				}),
			);
		}
	},
};
