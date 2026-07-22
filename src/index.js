import {
	BOSSES,
	SCOPES,
	MIN_GROUP_SIZE,
	GROUP_SIZE,
	MATCH_ACROSS_SCOPES,
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

	// Diario y semanal van a la misma bolsa: una kill sirve para las dos tareas.
	const bolsas = MATCH_ACROSS_SCOPES
		? [await db.unassignedAll(env.DB, guildId)]
		: await Promise.all(
				Object.keys(SCOPES).map((s) => db.unassignedRegs(env.DB, guildId, s)),
			);

	for (let pool of bolsas) {
		// 1) Primero se rellenan los grupos que siguen abiertos.
		for (const { group, regs } of await db.openGroups(env.DB, guildId)) {
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
			components: groupButtons(g.id, !!group.closed),
			allowed_mentions: { users: g.members },
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
		const b = BOSSES[g.group.boss];
		const { runs } = groupStats(g.regs);
		const plan = keyPlan(g.regs, runs);

		await sendMessage(env.DISCORD_TOKEN, announceChannelId, {
			content:
				`🔒 **Grupo #${id} completo** — ${b.emoji} ${b.label}\n` +
				`${miembros.map((u) => `<@${u}>`).join(" ")}\n` +
				`Necesitáis **${runs}** run(s). ` +
				(plan.length
					? `Abre puertas: ${plan.map((p) => `<@${p.userId}> ×${p.use}`).join(", ")}.`
					: "⚠️ Nadie tiene llaves: pedid una en el clan."),
			allowed_mentions: { users: miembros },
		});
	}
}

async function refreshGroupMessage(env, guildId, groupId) {
	const g = await db.getGroup(env.DB, guildId, groupId);
	if (!g?.group.message_id) return;
	await editMessage(env.DISCORD_TOKEN, g.group.channel_id, g.group.message_id, {
		embeds: [groupEmbed(g.group.id, g.group.boss, g.regs, !!g.group.closed)],
		components: groupButtons(g.group.id, !!g.group.closed),
	});
}

/**
 * Tras una baja: los grupos que se quedan cortos se disuelven y sus miembros
 * vuelven a la cola, para que el bot pueda recolocarlos con otra gente.
 */
async function limpiarYRecolocar(env, guildId) {
	const cortos = await db.undersizedGroups(env.DB, guildId, MIN_GROUP_SIZE);

	for (const g of cortos) {
		await db.dissolveGroup(env.DB, guildId, g.id);
		if (g.message_id) {
			await editMessage(env.DISCORD_TOKEN, g.channel_id, g.message_id, {
				content:
					"♻️ Grupo deshecho por una baja. Sus miembros vuelven a la cola.",
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

	const b = BOSSES[boss];
	const linea = support
		? `Apuntado como **apoyo** para ${b.emoji} ${b.label} (${SCOPES[scope].label}) con 🔑 ${keys} ${b.key}.`
		: `Registrado: ${b.emoji} **${b.label}** ×${need} (${SCOPES[scope].label}) con 🔑 ${keys} ${b.key}.`;

	await matchAndAnnounce(env, guildId, ctx);

	// Puede haber entrado en un grupo nuevo o en uno abierto que ya existía.
	const tras = await db.getReg(env.DB, guildId, scope, uid, boss);
	if (!tras?.groupId) {
		const { announceChannelId } = await db.getConfig(env.DB, guildId);
		return (
			`${linea}\n⏳ Aún no hay suficiente gente. Se te avisará en cuanto se forme el grupo.` +
			(announceChannelId
				? ""
				: "\n⚠️ Ojo: no hay canal de avisos configurado, así que ese aviso no llegará. Que un admin use `/configurar canal:#canal`.")
		);
	}

	const { announceChannelId } = await db.getConfig(env.DB, guildId);
	const sinCanal = announceChannelId
		? ""
		: "\n⚠️ No hay canal de avisos configurado, así que tus compañeros **no recibirán notificación**. Que un admin use `/configurar canal:#canal`.";

	const g = await db.getGroup(env.DB, guildId, tras.groupId);
	const faltan = GROUP_SIZE - (dedupePool(g?.regs ?? []).length ?? 0);
	return `${sinCanal}${linea}\n✅ Estás en el **grupo #${tras.groupId}**${
		g?.group.closed || faltan <= 0
			? " (completo)"
			: `, a la espera de ${faltan} más`
	}. Pulsa "Mi grupo" para los detalles.${sinCanal}`;
}

/* ---------- salir de todo ---------- */

async function salirDeTodo(env, guildId, uid, ctx) {
	const borrados = await db.removeAllRegs(env.DB, guildId, uid);
	if (!borrados.length)
		return "No estabas apuntado a nada, así que no hay nada que quitar.";

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

	const lista = borrados
		.map((r) => `${BOSSES[r.boss].label} (${SCOPES[r.scope].label})`)
		.join(", ");
	return [
		`🚫 Fuera de todo: ${lista}.`,
		grupos.length
			? `Aviso a tus ${grupos.length === 1 ? "compañeros" : "grupos"} y recoloco a quien se quede colgado.`
			: "No estabas en ningún grupo formado, solo en cola.",
		"Cuando vuelvas a estar disponible, apúntate otra vez.",
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
		components: statusButtons(grupos),
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
	if (!res) return reply("No tenías nada registrado ahí.");

	ctx.waitUntil(
		(async () => {
			if (res.groupId) {
				await db.resyncGroup(env.DB, i.guild_id, res.groupId, GROUP_SIZE);
				await refreshGroupMessage(env, i.guild_id, res.groupId);
			}
			await limpiarYRecolocar(env, i.guild_id);
		})(),
	);
	return reply(
		`Borrado tu registro de ${BOSSES[o.jefe].label} (${SCOPES[o.ambito].label}).`,
	);
}

async function cmdConfigurar(i, env) {
	const cfg = await db.getConfig(env.DB, i.guild_id);
	if (!isAdmin(i, cfg.adminRoleIds)) return reply("Solo admins.");

	const o = opts(i);
	const patch = {};
	if (o.canal) patch.announceChannelId = o.canal;
	if (o.rol_admin)
		patch.adminRoleIds = [...new Set([...cfg.adminRoleIds, o.rol_admin])];
	const nuevo = await db.setConfig(env.DB, i.guild_id, patch);

	// Prueba real: si el bot no puede escribir ahí, mejor saberlo ahora que
	// descubrirlo cuando nadie reciba los avisos.
	let prueba = "⚠️ **Sin canal configurado**: nadie recibirá avisos de grupo. Usa `/configurar canal:#tu-canal`.";
	if (nuevo.announceChannelId) {
		const res = await postMessage(env.DISCORD_TOKEN, nuevo.announceChannelId, {
			content: "✅ Canal de avisos configurado. Aquí se publicarán los grupos.",
		});
		prueba = res.ok
			? `✅ Prueba enviada a <#${nuevo.announceChannelId}>: los avisos funcionan.`
			: `❌ **No he podido escribir en <#${nuevo.announceChannelId}>**: ${res.motivo}`;
	}

	return reply(
		[
			`Canal de anuncios: ${nuevo.announceChannelId ? `<#${nuevo.announceChannelId}>` : "_sin configurar_"}`,
			`Roles admin extra: ${nuevo.adminRoleIds.map((r) => `<@&${r}>`).join(", ") || "_ninguno_"}`,
			"",
			prueba,
			"",
			"Usa `/panel` en el canal para dejar el mensaje con los botones.",
		].join("\n"),
	);
}

async function cmdPanel(i, env) {
	const cfg = await db.getConfig(env.DB, i.guild_id);
	if (!isAdmin(i, cfg.adminRoleIds)) return reply("Solo admins.");
	return json({ type: CallbackType.CHANNEL_MESSAGE, data: panelMessage() });
}

/** Explica quién sigue en cola y por qué no se ha formado grupo. */
async function resumenCola(env, guildId) {
	// Deduplicado: quien esté apuntado en los dos ámbitos es una sola persona.
	const pool = dedupePool(await db.unassignedAll(env.DB, guildId));
	const porJefe = {};
	for (const r of pool) (porJefe[r.boss] ??= []).push(r);

	return Object.entries(porJefe).map(([boss, regs]) => {
		const b = BOSSES[boss];
		const necesitan = regs.filter((r) => !r.support && r.need > 0);
		const apoyos = regs.filter((r) => r.support || r.need === 0);
		const llaves = regs.reduce((a, r) => a + r.keys, 0);

		const motivo = !necesitan.length
			? "nadie lo necesita, solo hay apoyos"
			: `faltan ${Math.max(1, MIN_GROUP_SIZE - regs.length)} persona(s)`;

		return (
			`${b.emoji} **${b.label}**: ${necesitan.length} lo necesitan, ` +
			`${apoyos.length} de apoyo, 🔑 ${llaves} — ${motivo}`
		);
	});
}

async function cmdEmparejar(i, env, ctx) {
	const cfg = await db.getConfig(env.DB, i.guild_id);
	if (!isAdmin(i, cfg.adminRoleIds)) return reply("Solo admins.");

	const creados = await matchAndAnnounce(env, i.guild_id, ctx);
	const cola = await resumenCola(env, i.guild_id);
	const avisoCanal = cfg.announceChannelId
		? ""
		: "\n⚠️ **Sin canal de avisos**: nadie está recibiendo notificaciones. Usa `/configurar canal:#canal`.";

	const grupos = (await db.allGroups(env.DB, i.guild_id)).map(
		(g) =>
			`· #${g.id} ${BOSSES[g.boss]?.emoji ?? ""} ${BOSSES[g.boss]?.label ?? g.boss} — ` +
			`${g.n}/${GROUP_SIZE} · ${g.closed ? (g.locked ? "🔒 cerrado a mano" : "🔒 completo") : "🟢 abierto"}`,
	);

	return reply(
		[
			creados.length
				? `✅ Formados ${creados.length} grupo(s) nuevos.`
				: "No se ha podido formar ningún grupo nuevo.",
			grupos.length ? "\n**Grupos ahora mismo:**" : "",
			...grupos,
			cola.length ? "\n**En cola:**" : "\nNo queda nadie en cola.",
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
	if (!isAdmin(i, cfg.adminRoleIds)) return reply("Solo admins.");

	const grupos = await db.allGroups(env.DB, i.guild_id);
	if (!grupos.length) return reply("No hay ningún grupo formado ahora mismo.");

	const detalle = grupos
		.map(
			(g) =>
				`\u00b7 #${g.id} — ${BOSSES[g.boss]?.label ?? g.boss} (${g.n} persona${g.n === 1 ? "" : "s"})`,
		)
		.join("\n");

	return reply(
		`Vas a deshacer **${grupos.length} grupo(s)**:\n${detalle}\n\n` +
			"Nadie pierde su registro: todos vuelven a la cola y se pueden volver a emparejar. ¿Seguro?",
		{
			components: [
				{
					type: 1,
					components: [
						{
							type: 2,
							custom_id: "adm:wipe",
							label: `Sí, deshacer ${grupos.length}`,
							emoji: { name: "💥" },
							style: 4,
						},
						{ type: 2, custom_id: "adm:cancel", label: "Cancelar", style: 2 },
					],
				},
			],
		},
	);
}

async function onAdminButton(i, env) {
	const cfg = await db.getConfig(env.DB, i.guild_id);
	if (!isAdmin(i, cfg.adminRoleIds)) return reply("Solo admins.");

	const [, action] = i.data.custom_id.split(":");
	if (action === "cancel") {
		return updateMessage({
			content: "Cancelado, no he tocado nada.",
			embeds: [],
			components: [],
		});
	}

	const grupos = await db.dissolveAllGroups(env.DB, i.guild_id);

	// Marca los mensajes de los grupos deshechos
	for (const g of grupos) {
		if (!g.message_id) continue;
		await editMessage(env.DISCORD_TOKEN, g.channel_id, g.message_id, {
			content: `💥 Grupo #${g.id} deshecho por un admin. Sus miembros vuelven a la cola.`,
			embeds: [],
			components: [],
		});
	}

	return updateMessage({
		content:
			`💥 Deshechos ${grupos.length} grupo(s). Todo el mundo vuelve a la cola con su registro intacto.\n` +
			"Usa `/emparejar` para volver a formarlos, o espera a que se apunte alguien.",
		embeds: [],
		components: [],
	});
}

async function cmdReset(i, env) {
	const cfg = await db.getConfig(env.DB, i.guild_id);
	if (!isAdmin(i, cfg.adminRoleIds)) return reply("Solo admins.");
	const o = opts(i);
	await db.wipeScope(env.DB, i.guild_id, o.ambito);
	return reply(
		`Reset manual de ${SCOPES[o.ambito].label.toLowerCase()}s hecho.`,
	);
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
		return reply(null, { embeds: [openRequestsEmbed(abiertos, cola)] });
	}
	if (action === "out")
		return reply(await salirDeTodo(env, i.guild_id, uid, ctx));
	return reply("Botón desconocido.");
}

/** Elegir jefe en el desplegable abre el modal con las dos cifras. */
function onSelect(i) {
	const [, , scope] = i.data.custom_id.split(":");
	return json(regModal(scope, i.data.values[0]));
}

async function onModal(i, env, ctx) {
	const [, , scope, boss] = i.data.custom_id.split(":");
	const need = Number.parseInt(modalValue(i, "cantidad"), 10);
	const keys = Number.parseInt(modalValue(i, "llaves"), 10);

	if (
		!Number.isInteger(need) ||
		!Number.isInteger(keys) ||
		need < 0 ||
		keys < 0
	) {
		return reply("Esos números no me cuadran. Pon cifras, por ejemplo 2 y 1.");
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
	const [, action, idRaw] = i.data.custom_id.split(":");
	const groupId = Number(idRaw);

	const g = await db.getGroup(env.DB, gid, groupId);
	if (g && g.regs.some((r) => r.userId === uid)) {
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
				await refreshGroupMessage(env, gid, groupId);
				if (action === "leave") await limpiarYRecolocar(env, gid);
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
	if (!g) return reply("Ese grupo ya no existe.");

	const cfg = await db.getConfig(env.DB, gid);
	if (!g.regs.some((r) => r.userId === uid) && !isAdmin(i, cfg.adminRoleIds)) {
		return reply("No eres de este grupo.");
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
		return updateMessage({
			content: `✅ Grupo #${groupId} completado.`,
			embeds: i.message.embeds,
			components: [],
		});
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

	return reply("Botón desconocido.");
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
		return reply("Este bot solo funciona dentro de un servidor.");

	await db.ensureSchema(env.DB);
	await db.ensureGuild(env.DB, i.guild_id);
	await db.applyResets(env.DB, i.guild_id);

	if (i.type === InteractionType.COMMAND) {
		const fn = COMANDOS[i.data.name];
		return fn ? fn(i, env, ctx) : reply("Comando desconocido.");
	}

	if (i.type === InteractionType.COMPONENT) {
		const id = i.data.custom_id;
		if (id.startsWith("g:")) return onGroupButton(i, env, ctx);
		if (id.startsWith("p:")) return onPanel(i, env, ctx);
		if (id.startsWith("sel:")) return onSelect(i);
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
			return new Response("Boss bot de Idle Clans. Nada que ver por aquí.", {
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
			return reply(
				`Algo ha petado. Avisa a quien administra el bot.\n\`\`\`${String(err?.message ?? err).slice(0, 300)}\`\`\``,
			);
		}
	},

	async scheduled(event, env, ctx) {
		await db.ensureSchema(env.DB);
		for (const {
			guildId,
			scopes,
			announceChannelId,
		} of await db.applyResets(env.DB)) {
			// Un grupo mixto sobrevive al reset diario con sus miembros semanales:
			// hay que recalcular runs, llaves y si sigue lleno.
			await db.syncAllGroups(env.DB, guildId, GROUP_SIZE);
			if (!announceChannelId) continue;
			const nombres = scopes
				.map((s) => SCOPES[s].label.toLowerCase())
				.join(" y ");
			ctx.waitUntil(
				sendMessage(env.DISCORD_TOKEN, announceChannelId, {
					content: `🔄 Reset de ${nombres}: a apuntarse otra vez con el botón "Me faltan jefes".`,
				}),
			);
		}
	},
};
