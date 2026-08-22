import { BOSSES } from "./config.js";
import * as T from "./strings.js";

/** Mensaje fijo con botones que se ancla en el canal. */
export const panelMessage = () => ({
  embeds: [
    {
      title: T.PANEL_TITLE,
      color: 0x4a6fa5,
      description: T.panelDescription(),
    },
  ],
  components: [
    {
      type: 1,
      components: [
        { type: 2, custom_id: "p:add:daily", label: T.PANEL_BOTON_DIARIO, emoji: { name: "🌙" }, style: 1 },
        { type: 2, custom_id: "p:add:weekly", label: T.PANEL_BOTON_SEMANAL, emoji: { name: "📅" }, style: 1 },
      ],
    },
    {
      type: 1,
      components: [
        { type: 2, custom_id: "p:mine", label: T.PANEL_BOTON_MI_GRUPO, emoji: { name: "👥" }, style: 2 },
        { type: 2, custom_id: "p:open", label: T.PANEL_BOTON_VER_ABIERTAS, emoji: { name: "🔎" }, style: 2 },
        { type: 2, custom_id: "p:out", label: T.PANEL_BOTON_HOY_NO_PUEDO, emoji: { name: "🚫" }, style: 4 },
      ],
    },
  ],
});

/** Desplegable de jefes, paso 1 tras pulsar "Me faltan jefes". */
export const bossSelect = (scope) => ({
  content: T.bossSelectContenido(scope),
  components: [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `sel:boss:${scope}`,
          placeholder: T.BOSS_SELECT_PLACEHOLDER,
          options: Object.entries(BOSSES).map(([value, b]) => ({
            label: b.label,
            value,
            description: T.bossSelectOpcionDescripcion(value),
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
    title: T.regModalTitulo(scope, boss),
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "cantidad",
            label: T.MODAL_CANTIDAD_LABEL,
            style: 1,
            required: true,
            max_length: 3,
            placeholder: T.MODAL_CANTIDAD_PLACEHOLDER,
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
            label: T.modalLlavesLabel(boss),
            style: 1,
            required: true,
            max_length: 3,
            placeholder: T.MODAL_LLAVES_PLACEHOLDER,
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
