# Changelog — Bot de jefes de Lindvürm (Idle Clans)

Registro de todos los cambios del proyecto, de más reciente a más antiguo.
A partir de ahora, cada vez que se implemente un cambio se añade una entrada
nueva arriba del todo.

---

## [Sin publicar] — próximos cambios

_(aquí se irán añadiendo las entradas de lo que pidas a partir de ahora)_

---

## 2026-08-12 (2) — Botón de registro también para quien está solo en cola

### Cambiado

- En "Ver abiertas", el botón de registro rápido ya no se limitaba a los
  jefes que ya tenían un grupo formado con hueco. Ahora aparece para
  cualquier jefe con actividad (grupo abierto O gente sola en cola), porque
  el botón no "entra" en un grupo mágicamente: solo abre la ventanita de
  registro sin pasar por el desplegable. Etiqueta según el caso: "Unirme a"
  cuando ya hay grupo, "Apuntarme a" cuando solo hay cola.

### Notas de despliegue

- Sin migración, sin registrar comandos. Solo `npm test` + `npm run deploy`.

## 2026-08-12 — Los grupos semanales ya no caducan por horas

### Corregido

- **Bug grave: el cron llevaba tiempo reventando.** `STALE_CLOSED_HOURS` se
  usaba dentro de `scheduled()` sin estar importado. `node --check` no lo
  detecta porque es un `ReferenceError` en tiempo de ejecución, no un fallo
  de sintaxis. Esto explica que el reset diario llevara días sin dispararse
  correctamente.
- Los grupos "ameba" semanales se estaban limpiando con la misma ventana de
  20h que los diarios. Ahora cada ámbito tiene su propia ventana:
  - Diarios: 20 horas (`STALE_CLOSED_HOURS`).
  - Semanales: casi una semana entera, 168 horas (`STALE_CLOSED_WEEKLY_HOURS`).

### Añadido

- Test que invoca el `scheduled()` real del Worker (no solo funciones
  sueltas de la base de datos), para detectar este tipo de fallo de
  importación antes de desplegar.
- Tests de las dos ventanas de expiración por ámbito.

### Notas de despliegue

- Sin migración de base de datos, sin registrar comandos. Solo `npm test` +
  `npm run deploy`.

---

## Botón "Quitar" individual en la cola (acceso sin comandos de barra)

### Añadido

- Cada registro en cola dentro de "Mi grupo" tiene ahora su propio botón
  🗑️ **Quitar**, para poder borrar un registro suelto sin depender del
  comando `/quitar` (necesario para usuarios sin permiso de "Usar comandos
  de aplicación" en el canal).

### Contexto

- Se confirmó que casi toda la funcionalidad del bot (registrarse, ver
  grupo, ver abiertas, salir de todo) ya funcionaba solo con botones/modales,
  que no requieren ese permiso de Discord. El único hueco real era quitar un
  registro individual sin usar `/fuera` (que borra todo) — ya tapado.

---

## Cuatro cambios: auto-borrado, ámbitos separados, unirse directo, sin botones ajenos

### Corregido

- **Bug real encontrado al separar ámbitos:** `createGroup` marcaba como
  parte del grupo **todas** las filas de una persona para un jefe, sin mirar
  el ámbito. Si alguien necesitaba el mismo jefe a diario y a la semana,
  formar el grupo diario se llevaba por delante también su fila semanal.
  Llevaba tiempo oculto porque antes todo se mezclaba a propósito. Corregido:
  ahora se marca fila por fila usando (ámbito, persona), no solo persona.
- Los mensajes de grupo formado en el canal ya no llevan botones de acción.
  Antes cualquiera podía ver (y pulsar, aunque se rechazara) los botones de
  un grupo ajeno.

### Cambiado

- **Diario y semanal van a grupos separados por defecto**
  (`MATCH_ACROSS_SCOPES = false`). Antes se mezclaban en un único grupo, lo
  que era un problema si las cifras eran muy distintas (2 kills diarias y 40
  semanales obligaban al grupo entero a hacer 40 runs). Reversible en
  `config.js`.
- Al pulsar ✅ **Completado**, el mensaje público del canal se borra de
  verdad, no se queda editado con un aviso.
- Las acciones de grupo (Cerrar, Completado, Salir) pasan a vivir
  exclusivamente en `/grupo`, que es privado y solo enseña tus propios
  grupos — imposible ver ahí opciones de un grupo ajeno.

### Añadido

- Botón **Unirme** en "Ver abiertas": abre directamente la ventanita de
  registro (sin desplegable) para el jefe con hueco.
- Test de regresión específico para el bug de `createGroup`.

---

## Panel automático cada reset + limpieza de grupos "ameba" y de grupos sueltos

### Añadido

- `/panel` recuerda en qué canal y mensaje se publicó. Cada reset diario, el
  bot borra ese mensaje y publica uno nuevo, para que no quede enterrado bajo
  la conversación del día. Ya no hace falta volver a ejecutar `/panel` nunca.
- **Grupos "ameba"**: un grupo cerrado (🔒 o completo) que lleva más de
  `STALE_CLOSED_HOURS` sin que nadie pulse Completado se da por hecho solo,
  con aviso en su propio mensaje.
- **Red de seguridad global**: barrido en el cron que disuelve cualquier
  grupo por debajo del mínimo que se haya quedado suelto por cualquier vía.
- Texto del panel ampliado para explicar la diferencia entre 🔒 Cerrar
  (deja de admitir gente, el grupo sigue vivo) y ✅ Completado (lo borra
  del todo).

### Contexto

- Origen: reporte de un admin sobre grupos que se quedaban "con el
  coeficiente de una ameba muerta" — cerrados pero nunca completados.

---

## Reparto de llaves por cantidad, límite a 999 y todo en español

### Cambiado

- **Quién abre las puertas**: antes se repartía por turnos (uno cada uno).
  Ahora abre quien más llaves tiene, gastando las suyas antes de pasar al
  siguiente.
- Límite de kills/llaves en los formularios subido de 50 a 999.
- Nombres de jefes y llaves traducidos al español (Grifo, Diablo, Quimera,
  Cronos, Llave divina, Llave del inframundo, etc.). Los identificadores
  internos (`zeus`, `griffin`...) no se tocan porque están en la base de
  datos.

---

## Corrección del emparejamiento: diario + semanal en la misma bolsa (versión anterior)

### Corregido

- Alguien apuntado al mismo jefe en diario y en semanal contaba como dos
  personas distintas, con sus llaves sumadas dos veces en vez de una.
  Corregido con `dedupePool`, que fusiona los registros de la misma persona
  para el mismo jefe.
- Grupos que ya estaban llenos (creados por versiones anteriores) nunca se
  cerraban, porque el barrido de ampliación solo revisaba grupos a los que
  entraba alguien nuevo.
- **Esquema autorreparable**: `ensureSchema()` comprueba tablas y columnas en
  cada arranque y añade lo que falte. Una migración olvidada ya no puede
  tumbar el bot en silencio.

_(en aquel momento diario y semanal SÍ se mezclaban a propósito — esa
decisión se revirtió más adelante, ver arriba)_

---

## Grupos abiertos: se amplían solos hasta llenarse, se cierran o se pueden bloquear a mano

### Añadido

- Los grupos nacen abiertos con 2 personas y admiten una tercera
  automáticamente en cuanto se apunta alguien más al mismo jefe.
- Botón 🔒 **Cerrar grupo**, para empezar antes siendo menos de 3.
- Si alguien sale, el grupo se reabre para admitir a otro.
- `resyncGroup` como única fuente de verdad del estado de un grupo (runs,
  llaves, cerrado/abierto), para que ningún camino pueda dejarlo descuadrado.

### Corregido

- Un grupo de 3 no se cerraba automáticamente en según qué caminos.
- Salir de un grupo dejaba a los demás en un grupo roto en vez de devolverlos
  a la cola para recolocarlos.

---

## Comando /borrargrupos (admin, con confirmación)

### Añadido

- `/borrargrupos`: deshace todos los grupos formados, devolviendo a todo el
  mundo a la cola con sus registros intactos (no borra inscripciones, solo
  agrupaciones). Pide confirmación con botones antes de ejecutar.
- Registrado sin `default_member_permissions` a propósito, para que la
  comprobación de admin la haga el propio código (Gestionar servidor o rol
  configurado con `/configurar`) y no Discord, evitando que se oculte a
  quien tiene el rol admin pero no el permiso nativo.

---

## Diario y semanal a la misma bolsa (primera versión) + arreglo del emparejador

### Corregido

- El emparejador exigía **dos personas que necesitaran el jefe** para formar
  grupo; un `/apoyo` solo entraba si ya había déficit de llaves. Con eso,
  alguien que necesitaba un jefe y otra persona que solo se ofrecía de apoyo
  nunca formaban grupo. Corregido: basta con una persona que lo necesite.
- `/emparejar` pasó de responder "no se ha podido formar ningún grupo" a
  explicar el porqué, desglosado por jefe (cuántos necesitan, cuántos de
  apoyo, cuántas llaves, qué falta).

---

## Reescritura completa a Cloudflare Workers (HTTP Interactions + D1)

### Cambiado — arquitectura

- El bot pasa de discord.js sobre un proceso siempre encendido (gateway) a
  **HTTP Interactions** sobre Cloudflare Workers: sin servidor, sin proceso
  que mantener vivo, dentro del plan gratuito permanente de Cloudflare.
- Verificación de firma Ed25519 de cada petición con Web Crypto.
- Estado en D1 (SQLite de Cloudflare) en vez de un fichero JSON, con
  aislamiento completo por servidor (`guild_id` en la clave primaria).
- Cron cada 10 minutos en vez de temporizador en memoria, para los resets.
- Comandos registrados vía API REST directa (`scripts/deploy-commands.js`),
  sin depender de discord.js.

### Añadido

- `/fuera`: saca a la persona de todos sus grupos de golpe si no puede
  acudir. Al hacerlo, los grupos que se quedan por debajo del mínimo se
  disuelven y sus miembros vuelven a la cola para recolocarse con otra
  gente (antes se quedaban en un grupo roto de una persona).
- Panel con botones (`/panel`): "Me faltan jefes", "Semanal", "Mi grupo",
  "Hoy no puedo" — pensado para gente que no quiere aprenderse comandos.
  El registro se hace con un desplegable de jefe + una ventanita (modal)
  con kills y llaves. Poner 0 kills te apunta como apoyo automáticamente.

---

## Primera versión: matchmaking por jefes reales de The Valley of Gods

### Añadido

- Reescritura completa del bot original (que era un simple gestor de
  eventos de jefe con apuntarse/reserva) hacia el modelo real pedido:
  registro individual de jefes diarios y semanales con sus llaves, y
  emparejamiento automático por coincidencia de jefe.
- Lista real de jefes de Idle Clans (Zeus, Medusa, Hades, Griffin, Devil,
  Chimera, Sobek, Kronos, Mesines) con su llave correspondiente.
- Algoritmo de emparejamiento: agrupa por jefe, prioriza a quien más llaves
  aporta, calcula cuántas runs necesita el grupo (el máximo de kills
  pendientes entre sus miembros) y reparte quién abre cada puerta.
- Comandos `/boss`, `/apoyo`, `/grupo`, `/quitar`, `/emparejar` (admin),
  `/reset` (admin).
- Reset automático: diarios a las 02:00 hora española, semanales los lunes
  a las 02:00.

---

## Versión inicial (descartada): bot genérico de eventos de jefe

Primer prototipo, antes de conocer el modelo real de registro individual
por jefe/llaves. Gestionaba "eventos" tipo quedada con apuntarse/reserva,
similar a un bot de raids genérico. Sustituido enseguida por la versión de
matchmaking real.
