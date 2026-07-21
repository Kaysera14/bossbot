const API = "https://discord.com/api/v10";

const hex2bytes = (hex) =>
  new Uint8Array(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));

/**
 * Discord firma cada petición con Ed25519 y rechaza el endpoint si no
 * devolvemos 401 a las firmas inválidas. Se comprueba con Web Crypto.
 */
export async function verifyRequest(request, body, publicKey) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) return false;

  const data = new TextEncoder().encode(timestamp + body);
  const algos = [{ name: "Ed25519" }, { name: "NODE-ED25519", namedCurve: "NODE-ED25519" }];

  for (const algo of algos) {
    try {
      const key = await crypto.subtle.importKey("raw", hex2bytes(publicKey), algo, false, ["verify"]);
      return await crypto.subtle.verify(algo.name, key, hex2bytes(signature), data);
    } catch {
      // Runtime sin ese nombre de algoritmo: probamos el siguiente.
    }
  }
  return false;
}

/* ---------- tipos de interacción y respuesta ---------- */

export const InteractionType = { PING: 1, COMMAND: 2, COMPONENT: 3, AUTOCOMPLETE: 4, MODAL: 5 };
export const CallbackType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_MESSAGE: 5,
  DEFERRED_UPDATE: 6,
  UPDATE_MESSAGE: 7,
};
export const EPHEMERAL = 64;

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export const reply = (content, { embeds, components, ephemeral = true } = {}) =>
  json({
    type: CallbackType.CHANNEL_MESSAGE,
    data: { content, embeds, components, flags: ephemeral ? EPHEMERAL : 0 },
  });

export const updateMessage = ({ content, embeds, components }) =>
  json({ type: CallbackType.UPDATE_MESSAGE, data: { content, embeds, components } });

/* ---------- llamadas a la API ---------- */

async function api(token, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    console.error("Discord API", method, path, res.status, await res.text());
    return null;
  }
  return res.status === 204 ? true : res.json();
}

export const sendMessage = (token, channelId, payload) =>
  api(token, "POST", `/channels/${channelId}/messages`, payload);

export const editMessage = (token, channelId, messageId, payload) =>
  api(token, "PATCH", `/channels/${channelId}/messages/${messageId}`, payload);

/** Edita la respuesta diferida de una interacción. */
export const editOriginal = (appId, interactionToken, payload) =>
  fetch(`${API}/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

/* ---------- utilidades de opciones ---------- */

export function opts(interaction) {
  const out = {};
  for (const o of interaction.data.options ?? []) out[o.name] = o.value;
  return out;
}

export const userId = (i) => i.member?.user?.id ?? i.user?.id;

const MANAGE_GUILD = 1n << 5n;

export function isAdmin(interaction, adminRoleIds = []) {
  const perms = BigInt(interaction.member?.permissions ?? "0");
  if (perms & MANAGE_GUILD) return true;
  const roles = interaction.member?.roles ?? [];
  return adminRoleIds.some((r) => roles.includes(r));
}
