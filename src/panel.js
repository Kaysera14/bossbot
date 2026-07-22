import { BOSSES, SCOPES, GROUP_SIZE } from "./config.js";

/** Mensaje fijo con botones que se ancla en el canal. */
export const panelMessage = () => ({
  embeds: [
    {
      title: "🗡️ Grupos de jefes",
      color: 0x4a6fa5,
      description: [
        "Pulsa un botón, no hace falta escribir nada.",
        "",
        "**Me faltan jefes** → dices qué jefe y cuántas kills te faltan.",
        "**Mi grupo** → con quién vas y si te toca abrir puerta.",
        "**Ver abiertas** → grupos a los que aún puedes entrar y quién espera.",
        "**Hoy no puedo** → te saca de todos tus grupos de golpe.",
        "",
        `Los grupos son de ${GROUP_SIZE}. Se forman en cuanto hay gente y siguen abiertos hasta llenarse,`,
        "así que puedes entrar en uno que ya existe. Cuando se llena se cierra solo, y si queréis empezar",
        "antes siendo menos, cualquiera del grupo puede pulsar 🔒 **Cerrar grupo**.",
        "Los diarios se borran a las 02:00 y los semanales los lunes a las 02:00.",
      ].join("\n"),
    },
  ],
  components: [
    {
      type: 1,
      components: [
        { type: 2, custom_id: "p:add:daily", label: "Me faltan jefes (diario)", emoji: { name: "🌙" }, style: 1 },
        { type: 2, custom_id: "p:add:weekly", label: "Semanal", emoji: { name: "📅" }, style: 1 },
      ],
    },
    {
      type: 1,
      components: [
        { type: 2, custom_id: "p:mine", label: "Mi grupo", emoji: { name: "👥" }, style: 2 },
        { type: 2, custom_id: "p:open", label: "Ver abiertas", emoji: { name: "🔎" }, style: 2 },
        { type: 2, custom_id: "p:out", label: "Hoy no puedo", emoji: { name: "🚫" }, style: 4 },
      ],
    },
  ],
});

/** Desplegable de jefes, paso 1 tras pulsar "Me faltan jefes". */
export const bossSelect = (scope) => ({
  content: `¿Qué jefe te falta? (${SCOPES[scope].label.toLowerCase()})`,
  components: [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `sel:boss:${scope}`,
          placeholder: "Elige un jefe",
          options: Object.entries(BOSSES).map(([value, b]) => ({
            label: b.label,
            value,
            description: `Llave: ${b.key}`,
            emoji: { name: b.emoji },
          })),
        },
      ],
    },
  ],
});

/** Modal con las dos cifras, paso 2. */
export const regModal = (scope, boss) => ({
  type: 9,
  data: {
    custom_id: `m:reg:${scope}:${boss}`,
    title: `${BOSSES[boss].label} · ${SCOPES[scope].label}`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "cantidad",
            label: "¿Cuántas kills te faltan?",
            style: 1,
            required: true,
            max_length: 3,
            placeholder: "Pon 0 si solo vienes a ayudar",
            value: "1",
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "llaves",
            label: `¿Cuántas ${BOSSES[boss].key} tienes?`,
            style: 1,
            required: true,
            max_length: 3,
            placeholder: "0 si no tienes ninguna",
            value: "0",
          },
        ],
      },
    ],
  },
});

/** Lee un campo numérico de un modal. */
export function modalValue(interaction, id) {
  for (const row of interaction.data.components ?? []) {
    for (const c of row.components ?? []) {
      if (c.custom_id === id) return c.value;
    }
  }
  return null;
}
