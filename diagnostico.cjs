const fs = require("fs");

for (const l of fs.readFileSync(".dev.vars", "utf8").split("\n")) {
	const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?/);
	if (m) process.env[m[1]] = m[2];
}

const { DISCORD_TOKEN, DISCORD_APP_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_APP_ID) {
	console.error("Faltan DISCORD_TOKEN o DISCORD_APP_ID en .dev.vars");
	process.exit(1);
}
if (!GUILD_ID) {
	console.error(
		"Falta GUILD_ID en .dev.vars (añádelo con el ID de tu servidor)",
	);
	process.exit(1);
}

const targets = [
	[
		"GLOBAL",
		`https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`,
	],
	[
		"SERVIDOR",
		`https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${GUILD_ID}/commands`,
	],
];

(async () => {
	for (const [scope, url] of targets) {
		const r = await fetch(url, {
			headers: { authorization: `Bot ${DISCORD_TOKEN}` },
		});
		const d = await r.json();
		console.log("---", scope, "---");
		console.log("status:", r.status);
		console.log(
			Array.isArray(d)
				? d.map((c) => c.name).join(", ") || "(vacío)"
				: JSON.stringify(d),
		);
		console.log();
	}
})();
