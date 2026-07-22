/**
 * Registra los slash commands. Se ejecuta desde tu máquina, no en el Worker.
 *   node scripts/deploy-commands.js
 * Lee las credenciales de .dev.vars (o de variables de entorno).
 */
import fs from "node:fs";
import { BOSSES, SCOPES } from "../src/config.js";

// Carga .dev.vars al estilo dotenv, sin dependencias.
try {
	for (const line of fs.readFileSync(".dev.vars", "utf8").split("\n")) {
		const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
		if (m) process.env[m[1]] ??= m[2];
	}
} catch {}

const { DISCORD_TOKEN, DISCORD_APP_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_APP_ID) {
	console.error("Faltan DISCORD_TOKEN o DISCORD_APP_ID (ponlos en .dev.vars)");
	process.exit(1);
}

const STRING = 3,
	INTEGER = 4,
	CHANNEL = 7,
	ROLE = 8;
const MANAGE_GUILD = String(1 << 5);

const jefeChoices = Object.entries(BOSSES).map(([value, b]) => ({
	name: `${b.label} (${b.key})`,
	value,
}));
const ambitoChoices = Object.entries(SCOPES).map(([value, s]) => ({
	name: s.label,
	value,
}));

const ambito = {
	name: "ambito",
	description: "Diario o semanal",
	type: STRING,
	required: true,
	choices: ambitoChoices,
};
const jefe = {
	name: "jefe",
	description: "Jefe del Valle de los Dioses",
	type: STRING,
	required: true,
	choices: jefeChoices,
};

const commands = [
	{
		name: "boss",
		description: "Registra un jefe que necesitas matar",
		options: [
			ambito,
			jefe,
			{
				name: "cantidad",
				description: "Cuántas kills necesitas (por defecto 1)",
				type: INTEGER,
				min_value: 1,
				max_value: 999,
			},
			{
				name: "llaves",
				description: "Cuántas llaves tienes de ese jefe",
				type: INTEGER,
				min_value: 0,
				max_value: 999,
			},
		],
	},
	{
		name: "apoyo",
		description: "No necesitas el jefe pero tienes llaves y quieres ayudar",
		options: [
			ambito,
			jefe,
			{
				name: "llaves",
				description: "Cuántas llaves aportas",
				type: INTEGER,
				required: true,
				min_value: 1,
				max_value: 999,
			},
		],
	},
	{ name: "grupo", description: "Mira en qué grupo estás y qué te toca hacer" },
	{
		name: "fuera",
		description: "Hoy no puedes: te saca de todos tus grupos de golpe",
	},
	{
		name: "quitar",
		description: "Borra un solo registro tuyo",
		options: [ambito, jefe],
	},
	{
		name: "panel",
		description: "[Admin] Publica el mensaje con botones en este canal",
	},
	{
		name: "configurar",
		description: "[Admin] Configura el canal de anuncios y roles admin",
		default_member_permissions: MANAGE_GUILD,
		options: [
			{
				name: "canal",
				description: "Canal donde anunciar los grupos",
				type: CHANNEL,
				channel_types: [0],
			},
			{
				name: "rol_admin",
				description: "Rol que también podrá usar comandos de admin",
				type: ROLE,
			},
		],
	},
	{ name: "emparejar", description: "[Admin] Fuerza la formación de grupos" },
	{
		name: "reset",
		description: "[Admin] Borra registros y grupos de un ámbito",
		options: [ambito],
	},
].map((c) => ({ ...c, contexts: [0] })); // 0 = solo dentro de servidores

const url = GUILD_ID
	? `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${GUILD_ID}/commands`
	: `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`;

const res = await fetch(url, {
	method: "PUT",
	headers: {
		authorization: `Bot ${DISCORD_TOKEN}`,
		"content-type": "application/json",
	},
	body: JSON.stringify(commands),
});

if (!res.ok) {
	console.error("Error", res.status, await res.text());
	process.exit(1);
}
console.log(
	GUILD_ID
		? `Comandos registrados en el servidor ${GUILD_ID} (visibles al instante).`
		: "Comandos registrados globalmente (hasta 1 hora en propagarse).",
);
