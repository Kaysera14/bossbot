// ============================================================================
// TODOS los textos que ve la gente en Discord viven aquí. Para cambiar
// cualquier mensaje, botón, título o aviso del bot, es este el único
// archivo que hace falta tocar — el resto del código solo llama a estas
// funciones/constantes, nunca escribe texto directamente.
//
// Las entradas que dependen de datos (un jefe, un número, un usuario...)
// son funciones que reciben esos datos y devuelven el texto ya montado.
// Las que no dependen de nada son strings sueltos.
// ============================================================================

import { BOSSES, SCOPES, GROUP_SIZE } from "./config.js";

/** "1 kill" vs "2 kills": ayuda a no repetir esta lógica por todo el archivo. */
const plural = (n, singular, pluralForm = `${singular}s`) =>
	n === 1 ? singular : pluralForm;

// ---------------------------------------------------------------------------
// Panel fijo (/panel): título, descripción y botones del mensaje ancla.
// ---------------------------------------------------------------------------

export const PANEL_TITLE = "🗡️ Grupos de jefes";

export const panelDescription = () =>
	[
		"Pulsa un botón, no hace falta escribir nada.",
		"",
		"**Me faltan jefes** → dices qué jefe y cuántas kills te faltan.",
		"**Mi grupo** → con quién vas y si te toca abrir puerta.",
		"**Ver abiertas** → grupos a los que aún puedes entrar y quién espera.",
		"**Hoy no puedo** → te saca de todos tus grupos de golpe.",
		"",
		`Los grupos son de ${GROUP_SIZE}. Se forman en cuanto hay gente y siguen abiertos hasta llenarse,`,
		"así que puedes entrar en uno que ya existe. Cuando se llena se cierra solo, y si queréis empezar",
		"antes siendo menos, cualquiera del grupo puede pulsar 🔒 **Cerrar grupo** (deja de admitir gente,",
		"pero el grupo sigue existiendo). Cuando ya lo hayáis hecho, pulsad ✅ **Completado** para que",
		"desaparezca del todo — si no lo pulsáis, el bot lo da por hecho solo pasadas 20 horas cerrado.",
		"Los diarios se borran a las 02:00 y los semanales los lunes a las 02:00.",
	].join("\n");

export const PANEL_BOTON_DIARIO = "Me faltan jefes (diario)";
export const PANEL_BOTON_SEMANAL = "Semanal";
export const PANEL_BOTON_MI_GRUPO = "Mi grupo";
export const PANEL_BOTON_VER_ABIERTAS = "Ver abiertas";
export const PANEL_BOTON_HOY_NO_PUEDO = "Hoy no puedo";
export const PANEL_PUBLICADO = "Panel publicado más abajo. 👇";

// ---------------------------------------------------------------------------
// Desplegable de jefes y modal de registro (panel.js).
// ---------------------------------------------------------------------------

export const bossSelectContenido = (scope) =>
	`¿Qué jefe te falta? (${SCOPES[scope].label.toLowerCase()})`;
export const BOSS_SELECT_PLACEHOLDER = "Elige un jefe";
export const bossSelectOpcionDescripcion = (boss) => `Llave: ${BOSSES[boss].key}`;

export const regModalTitulo = (scope, boss) =>
	`${BOSSES[boss].label} · ${SCOPES[scope].label}`;
export const MODAL_CANTIDAD_LABEL = "¿Cuántas kills te faltan?";
export const MODAL_CANTIDAD_PLACEHOLDER = "Pon 0 si solo vienes a ayudar";
export const modalLlavesLabel = (boss) => `¿Cuántas ${BOSSES[boss].key} tienes?`;
export const MODAL_LLAVES_PLACEHOLDER = "0 si no tienes ninguna";
export const MODAL_NUMEROS_INVALIDOS =
	"Esos números no me cuadran. Pon cifras entre 0 y 999, por ejemplo 2 y 1.";

// ---------------------------------------------------------------------------
// Embed público de un grupo (ui.js: groupEmbed).
// ---------------------------------------------------------------------------

export const groupEmbedTitulo = (boss, groupId) =>
	`${BOSSES[boss].emoji} ${BOSSES[boss].label} · Grupo #${groupId}`;

export const estadoMiembros = (closed, faltan) =>
	closed
		? "🔒 Cerrado"
		: `🟢 Abierto — ${faltan > 0 ? `falta${plural(faltan, "", "n")} ${faltan}` : "completo"}`;

export const campoMiembros = (regs, faltan, closed) => ({
	name: `Miembros (${regs.length}/${GROUP_SIZE}) · ${estadoMiembros(closed, faltan)}`,
});
export const lineaMiembro = (userId, iconosAmbito, r) =>
	`• <@${userId}> ${iconosAmbito} — ${r.support ? "apoyo" : `${r.need} ${plural(r.need, "kill")}`} · 🔑 ${r.keys}`;
export const SIN_MIEMBROS = "—";

export const CAMPO_RUNS_NECESARIAS = "Runs necesarias";
export const campoLlaves = (boss) => `Llaves (${BOSSES[boss].key})`;
export const CAMPO_ABRE_PUERTAS = "Abre puertas";
export const NADIE_TIENE_LLAVES = "_nadie tiene llaves_";
export const lineaAbrePuertas = (userId, use) => `<@${userId}> ×${use}`;

export const CAMPO_FALTAN_LLAVES = "⚠️ Faltan llaves";
export const faltanLlavesTexto = (deficit, boss) =>
	`Necesitáis ${deficit} ${BOSSES[boss].key} más. Usad \`/apoyo\` o pedidlas en el clan.`;

export const sigueAbiertoTexto = (boss) =>
	`Sigue abierto: si alguien más se apunta a ${BOSSES[boss].label} entrará aquí.`;

export const GROUP_EMBED_FOOTER =
	"Para cerrar, marcar completado o salir del grupo, usa /grupo (solo lo ven sus miembros)";

// ---------------------------------------------------------------------------
// Botones del mensaje público de grupo (ui.js: groupButtons — legado).
// ---------------------------------------------------------------------------

export const BOTON_COMPLETADO = "Completado";
export const BOTON_CERRAR_GRUPO = "Cerrar grupo";
export const BOTON_SALIR_DEL_GRUPO = "Salir del grupo";

// ---------------------------------------------------------------------------
// Botones y embed de "Mi grupo" (ui.js: statusButtons, statusEmbed).
// ---------------------------------------------------------------------------

export const botonCerrarNum = (groupId) => `Cerrar #${groupId}`;
export const botonCompletadoNum = (groupId) => `Completado #${groupId}`;
export const botonSalirNum = (groupId) => `Salir de #${groupId}`;
export const botonQuitarCola = (boss, scope) =>
	`Quitar ${BOSSES[boss]?.label ?? boss} (${SCOPES[scope]?.label ?? scope})`;

export const estadoStatus = (closed, faltan) =>
	closed ? "🔒 cerrado" : `🟢 abierto${faltan > 0 ? `, falta${plural(faltan, "", "n")} ${faltan}` : ""}`;

export const tituloGrupoStatus = (boss, ambitoLabel, groupId, n, estado) =>
	`${BOSSES[boss].emoji} ${BOSSES[boss].label} · ${ambitoLabel} · Grupo #${groupId} (${n}/${GROUP_SIZE}) ${estado}`;

export const companerosTexto = (lista) => `Compañeros: ${lista || "—"}`;
export const runsDelGrupoTexto = (runs, need) => `Runs del grupo: **${runs}** (tú necesitas ${need})`;
export const abrePuertasTexto = (use, boss) => `🔑 Te toca abrir **${use}** puerta(s) con ${BOSSES[boss].key}`;
export const NO_ABRES_INVITADO = "🔑 Tú no abres: entras invitado";
export const faltanLlavesEnGrupo = (deficit) => `⚠️ Faltan ${deficit} llaves en el grupo`;

export const tituloColaStatus = (boss, ambitoLabel) => `${BOSSES[boss].emoji} ${BOSSES[boss].label} · ${ambitoLabel}`;
export const enColaTexto = (support, need, keys) =>
	`⏳ En cola — ${support ? "apoyo" : `${need} kills`} · 🔑 ${keys}\nEsperando a que se apunte más gente.`;

export const STATUS_TITULO = "Tu situación";
export const STATUS_SIN_NADA =
	"No tienes nada registrado. Usa `/boss` para apuntar un jefe o `/apoyo` si solo tienes llaves.";
export const statusProximoReset = (fecha) => `Próximo reset diario: ${fecha}`;
export const STATUS_FOOTER_SIN_CANAL =
	"⚠️ Sin canal de avisos: nadie recibe notificaciones. Que un admin use /configurar";
export const STATUS_FOOTER_NORMAL =
	"Los diarios se borran a las 02:00; los semanales, los lunes a las 02:00";

// ---------------------------------------------------------------------------
// Vista "Ver abiertas" (ui.js: openRequestsEmbed).
// ---------------------------------------------------------------------------

export const OPEN_REQUESTS_TITULO = "🔎 Solicitudes abiertas";
export const OPEN_REQUESTS_VACIO =
	"No hay ningún grupo abierto ni nadie en cola. Apúntate con **Me faltan jefes** y serás el primero.";
export const OPEN_REQUESTS_DESCRIPCION =
	"Grupos a los que aún se puede entrar. Pulsa **Unirme** o apúntate con " +
	"**Me faltan jefes** y el bot te mete en uno automáticamente.";
export const OPEN_REQUESTS_FOOTER = "Los grupos se cierran solos al llegar a 3";

export const lineaGrupoAbierto = (groupId, n, mencionesLista, faltan) =>
	`**#${groupId}** (${n}/${GROUP_SIZE}) — ${mencionesLista} · falta${plural(faltan, "", "n")} ${faltan}`;
export const lineaEsperaTexto = (mencionesConDatos) => `⏳ En cola: ${mencionesConDatos}`;
export const esperaPersonaTexto = (userId, support, need, keys) =>
	`<@${userId}> (${support ? "apoyo" : `${need}`} · 🔑 ${keys})`;

export const tituloJefeAmbito = (boss, ambitoEmoji, ambitoLabel) =>
	`${BOSSES[boss].emoji} ${BOSSES[boss].label} · ${ambitoEmoji} ${ambitoLabel}`;

export const botonUnirseLabel = (hayGrupo, boss, ambitoLabel) =>
	`${hayGrupo ? "Unirme a" : "Apuntarme a"} ${BOSSES[boss].label} (${ambitoLabel})`;

// ---------------------------------------------------------------------------
// Registro de un jefe (index.js: registrar / cmdBoss / cmdQuitar / modal).
// ---------------------------------------------------------------------------

export const registradoApoyo = (boss, ambitoLabel, keys) =>
	`Apuntado como **apoyo** para ${BOSSES[boss].emoji} ${BOSSES[boss].label} (${ambitoLabel}) con 🔑 ${keys} ${BOSSES[boss].key}.`;
export const registradoNecesita = (boss, ambitoLabel, need, keys) =>
	`Registrado: ${BOSSES[boss].emoji} **${BOSSES[boss].label}** ×${need} (${ambitoLabel}) con 🔑 ${keys} ${BOSSES[boss].key}.`;

export const AUN_NO_HAY_GENTE =
	"⏳ Aún no hay suficiente gente. Se te avisará en cuanto se forme el grupo.";
export const AVISO_SIN_CANAL_COLA =
	"\n⚠️ Ojo: no hay canal de avisos configurado, así que ese aviso no llegará. Que un admin use `/configurar canal:#canal`.";
export const AVISO_SIN_CANAL_GRUPO =
	"\n⚠️ No hay canal de avisos configurado, así que tus compañeros **no recibirán notificación**. Que un admin use `/configurar canal:#canal`.";

export const estasEnGrupoTexto = (groupId, completo, faltan) =>
	`✅ Estás en el **grupo #${groupId}**${completo ? " (completo)" : `, a la espera de ${faltan} más`}. Pulsa "Mi grupo" para los detalles.`;

export const NO_TENIAS_NADA_AHI = "No tenías nada registrado ahí.";
export const registroBorradoTexto = (boss, ambitoLabel) =>
	`Borrado tu registro de ${boss} (${ambitoLabel}).`;

// ---------------------------------------------------------------------------
// "Hoy no puedo" / salir de todo (index.js: salirDeTodo).
// ---------------------------------------------------------------------------

export const NO_APUNTADO_A_NADA = "No estabas apuntado a nada, así que no hay nada que quitar.";
export const GRUPO_DESHECHO_POR_BAJA =
	"♻️ Grupo deshecho por una baja. Sus miembros vuelven a la cola.";
export const fueraDeTodoTexto = (lista) => `🚫 Fuera de todo: ${lista}.`;
export const avisoGruposTexto = (n) =>
	`Aviso a tus ${plural(n, "compañeros", "grupos")} y recoloco a quien se quede colgado.`;
export const SOLO_EN_COLA = "No estabas en ningún grupo formado, solo en cola.";
export const CUANDO_VUELVAS = "Cuando vuelvas a estar disponible, apúntate otra vez.";

// ---------------------------------------------------------------------------
// Avisos automáticos de grupo (index.js: publicarAvisos).
// ---------------------------------------------------------------------------

export const grupoFormadoTexto = (mencionesLista) => `${mencionesLista} ¡grupo formado!`;
export const seUneAlGrupoTexto = (mencionesLista, groupId) =>
	`➕ ${mencionesLista} se une al grupo #${groupId}.`;
export const grupoCompletoTexto = (groupId, boss, mencionesLista, runs, abreTexto) =>
	`🔒 **Grupo #${groupId} completo** — ${BOSSES[boss].emoji} ${BOSSES[boss].label}\n` +
	`${mencionesLista}\n` +
	`Necesitáis **${runs}** run(s). ${abreTexto}`;
export const abrePuertasResumen = (mencionesConUso) => `Abre puertas: ${mencionesConUso}.`;
export const NADIE_TIENE_LLAVES_PEDIR = "⚠️ Nadie tiene llaves: pedid una en el clan.";

// ---------------------------------------------------------------------------
// Comandos de admin: /configurar, /panel, /emparejar, /borrargrupos, /reset.
// ---------------------------------------------------------------------------

export const SOLO_ADMINS = "Solo admins.";

export const CONFIGURAR_SIN_CANAL =
	"⚠️ **Sin canal configurado**: nadie recibirá avisos de grupo. Usa `/configurar canal:#tu-canal`.";
export const CONFIGURAR_MENSAJE_PRUEBA =
	"✅ Canal de avisos configurado. Aquí se publicarán los grupos.";
export const configurarPruebaOk = (channelId) =>
	`✅ Prueba enviada a <#${channelId}>: los avisos funcionan.`;
export const configurarPruebaError = (channelId, motivo) =>
	`❌ **No he podido escribir en <#${channelId}>**: ${motivo}`;
export const MOTIVO_SIN_PERMISO =
	"el bot no tiene permiso para escribir ahí (necesita Enviar mensajes e Insertar enlaces)";
export const MOTIVO_CANAL_INEXISTENTE = "ese canal no existe o el bot no lo ve";
export const motivoErrorGenerico = (status, texto) => `error ${status}: ${texto}`;
export const configurarCanalLinea = (channelId) =>
	`Canal de anuncios: ${channelId ? `<#${channelId}>` : "_sin configurar_"}`;
export const configurarRolesLinea = (rolesLista) =>
	`Roles admin extra: ${rolesLista || "_ninguno_"}`;
export const CONFIGURAR_USA_PANEL = "Usa `/panel` en el canal para dejar el mensaje con los botones.";

export const noSeHanFormadoGrupos = "No se ha podido formar ningún grupo nuevo.";
export const formadosGruposTexto = (n) => `✅ Formados ${n} grupo(s) nuevos.`;
export const GRUPOS_AHORA_MISMO = "\n**Grupos ahora mismo:**";
export const EN_COLA_TITULO = "\n**En cola:**";
export const NO_QUEDA_NADIE_EN_COLA = "\nNo queda nadie en cola.";
export const AVISO_SIN_CANAL_EMPAREJAR =
	"\n⚠️ **Sin canal de avisos**: nadie está recibiendo notificaciones. Usa `/configurar canal:#canal`.";
export const lineaGrupoResumen = (id, emoji, label, n, estado) =>
	`· #${id} ${emoji} ${label} — ${n}/${GROUP_SIZE} · ${estado}`;
export const estadoGrupoResumen = (closed, locked) =>
	closed ? (locked ? "🔒 cerrado a mano" : "🔒 completo") : "🟢 abierto";

export const nadieLoNecesita = "nadie lo necesita, solo hay apoyos";
export const faltanPersonasTexto = (n) => `faltan ${n} persona(s)`;
export const resumenColaJefeTexto = (boss, necesitanN, apoyosN, llaves, motivo) =>
	`${BOSSES[boss].emoji} **${BOSSES[boss].label}**: ${necesitanN} lo necesitan, ${apoyosN} de apoyo, 🔑 ${llaves} — ${motivo}`;

export const NO_HAY_GRUPOS_AHORA = "No hay ningún grupo formado ahora mismo.";
export const lineaBorrarGrupo = (id, boss, n) =>
	`\u00b7 #${id} — ${boss} (${n} persona${plural(n, "", "s")})`;
export const confirmarBorrarTexto = (n, detalle) =>
	`Vas a deshacer **${n} grupo(s)**:\n${detalle}\n\n` +
	"Nadie pierde su registro: todos vuelven a la cola y se pueden volver a emparejar. ¿Seguro?";
export const botonConfirmarBorrar = (n) => `Sí, deshacer ${n}`;
export const BOTON_CANCELAR = "Cancelar";
export const CANCELADO_NO_TOCADO = "Cancelado, no he tocado nada.";
export const grupoDeshechoAdminTexto = (groupId) =>
	`💥 Grupo #${groupId} deshecho por un admin. Sus miembros vuelven a la cola.`;
export const deshechosResumenTexto = (n) =>
	`💥 Deshechos ${n} grupo(s). Todo el mundo vuelve a la cola con su registro intacto.\n` +
	"Usa `/emparejar` para volver a formarlos, o espera a que se apunte alguien.";

export const resetHechoTexto = (ambitoLabel) => `Reset manual de ${ambitoLabel.toLowerCase()}s hecho.`;

// ---------------------------------------------------------------------------
// Cron: reset automático y limpieza de grupos "ameba".
// ---------------------------------------------------------------------------

export const resetAutomaticoTexto = (nombresAmbitos) =>
	`🔄 Reset de ${nombresAmbitos}: a apuntarse otra vez con el botón "Me faltan jefes".`;
export const grupoAmebaTexto = (groupId, bossLabel, horas) =>
	`⌛ Grupo #${groupId} (${bossLabel}) llevaba más de ${horas}h cerrado sin completarse: dado por hecho automáticamente.`;

// ---------------------------------------------------------------------------
// Genéricos: errores, permisos, botones desconocidos.
// ---------------------------------------------------------------------------

export const SOLO_SERVIDOR = "Este bot solo funciona dentro de un servidor.";
export const WORKER_HEALTHCHECK = "Boss bot de Idle Clans. Nada que ver por aquí.";
export const COMANDO_DESCONOCIDO = "Comando desconocido.";
export const BOTON_DESCONOCIDO = "Botón desconocido.";
export const GRUPO_YA_NO_EXISTE = "Ese grupo ya no existe.";
export const NO_ERES_DE_ESTE_GRUPO = "No eres de este grupo.";
export const algoHaPetadoTexto = (mensajeError) =>
	`Algo ha petado. Avisa a quien administra el bot.\n\`\`\`${mensajeError}\`\`\``;
