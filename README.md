# Boss bot de Idle Clans — versión Cloudflare Workers

Empareja gente del clan para los jefes de The Valley of Gods según los jefes
que necesitan y las llaves que tienen. Diarios y semanales, con reset
automático a las 02:00 hora española.

Corre entero en el plan gratuito de Cloudflare: sin servidor, sin proceso que
mantener vivo, sin factura mensual.

## Cómo funciona (y en qué se diferencia de un bot normal)

Un bot clásico mantiene un WebSocket abierto contra Discord las 24 horas, y por
eso necesita una máquina encendida siempre. Este usa **HTTP Interactions**: le
das a Discord una URL y Discord hace un POST cada vez que alguien usa un
comando. Entre comando y comando no hay nada corriendo.

Consecuencias prácticas:

- **Hay que responder en menos de 3 segundos.** Todo lo lento (publicar los
  anuncios de grupo) va en `ctx.waitUntil()`, que sigue ejecutándose después de
  haber respondido.
- **Cada petición se verifica con Ed25519.** Si no devuelves 401 a las firmas
  inválidas, Discord ni siquiera acepta la URL.
- **No hay eventos de gateway.** No existe `guildDelete`, así que si expulsan al
  bot de un servidor sus datos se quedan ahí. Ocupan nada, pero el cron puede
  barrerlos.
- **El estado vive en D1** (la base SQLite de Cloudflare), no en un fichero.

## Coste real

| | Plan gratuito | Lo que gasta un clan |
|---|---|---|
| Peticiones | 100.000/día | ~200/día |
| Cron | incluido | 144 ejecuciones/día |
| D1 almacenamiento | 5 GB | unos KB |
| D1 lecturas | 5M filas/día | unos miles |

No hay tarjeta ni "prueba gratis": el free tier de Workers es permanente.

## Despliegue

Necesitas Node instalado en tu máquina y una cuenta de Cloudflare (gratis).

### 1. La aplicación de Discord

En https://discord.com/developers/applications → **New Application**:

- Pestaña **Bot** → **Reset Token**, guárdalo.
- Pestaña **General Information** → copia **Application ID** y **Public Key**.
- Si quieres que otros lo añadan, activa **Public Bot**.

### 2. Preparar el proyecto

```bash
npm install
cp .dev.vars.example .dev.vars   # rellena token, public key y app id
npx wrangler login
```

### 3. Crear la base de datos

```bash
npx wrangler d1 create bossbot
```

Copia el `database_id` que imprime y pégalo en `wrangler.toml`. Luego crea las
tablas:

```bash
npm run db:init
```

No hace falta aplicar migraciones a mano: al arrancar, el bot comprueba el
esquema y añade las columnas que falten (`ensureSchema` en `src/db.js`). Los
`.sql` de la raíz quedan como documentación de qué cambió y cuándo.

### 4. Secretos y despliegue

```bash
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npm run deploy
```

`wrangler deploy` imprime la URL del Worker, algo como
`https://idleclans-boss-bot.TU-SUBDOMINIO.workers.dev`.

### 5. Conectar Discord con el Worker

Vuelve al portal de Discord → **General Information** → **Interactions Endpoint
URL** → pega esa URL y guarda.

Discord manda un `PING` firmado para validarla. Si acepta, todo está bien
enchufado. Si da error, casi siempre es la Public Key mal copiada.

### 6. Registrar los comandos

```bash
npm run commands              # global (hasta 1 h en propagarse)
GUILD_ID=123456 npm run commands   # solo en tu servidor, al instante
```

### 7. Invitar el bot

**OAuth2 → URL Generator**, scopes `bot` + `applications.commands`, permisos
`Send Messages` + `Embed Links`. O directamente:

```
https://discord.com/oauth2/authorize?client_id=TU_APP_ID&scope=bot+applications.commands&permissions=19456
```

Ya dentro, un admin ejecuta `/configurar canal:#grupos`.

## Desarrollo

```bash
npm test                # lógica pura, sin Discord ni Cloudflare
npm run db:init:local   # tablas en la D1 local
npm run dev             # Worker en local
npx wrangler tail       # logs en vivo del Worker desplegado
```

Para probar en local contra Discord de verdad necesitas exponer el puerto con
algo tipo `cloudflared tunnel` o ngrok y poner esa URL como Interactions
Endpoint temporal. Es más cómodo desplegar a un Worker de pruebas.

## Uso normal: el panel

Un admin ejecuta `/panel` una vez en el canal y queda un mensaje fijo con
cuatro botones. **La gente del clan no necesita aprenderse ningún comando**:

- **Me faltan jefes (diario / semanal)** → desplegable de jefes → ventanita con
  dos cifras: kills que te faltan y llaves que tienes. Si pones 0 kills, te
  apunta como apoyo.
- **Mi grupo** → con quién vas, cuántas runs y si te toca abrir puerta.
- **Hoy no puedo** → te saca de todo de un golpe.

Todas las respuestas son privadas (solo las ves tú), así que el canal no se
llena de ruido.

## Comandos

Los mismos, por si alguien prefiere teclear:

| Comando | Qué hace |
|---|---|
| `/boss ambito jefe [cantidad] [llaves]` | Registra un jefe que necesitas matar |
| `/apoyo ambito jefe llaves` | No lo necesitas, pero aportas llaves |
| `/grupo` | Tu grupo, tus compañeros y cuántas puertas abres |
| `/fuera` | **Te saca de todos tus grupos de golpe** |
| `/quitar ambito jefe` | Borra un solo registro |
| `/panel` | *(Admin)* Publica el mensaje con botones |
| `/configurar canal rol_admin` | *(Admin)* Canal de anuncios y roles admin |
| `/emparejar` | *(Admin)* Fuerza la formación de grupos |
| `/borrargrupos` | *(Admin)* Deshace todos los grupos; la gente vuelve a la cola |
| `/reset ambito` | *(Admin)* Borra registros y grupos a mano |

## Grupos abiertos

Un grupo se crea en cuanto hay gente suficiente y **queda abierto**: si alguien
más se apunta a ese jefe, entra en el grupo existente en vez de crear uno
nuevo. Al llegar a 3 se cierra solo.

Si queréis empezar antes siendo dos, cualquiera del grupo pulsa 🔒 **Cerrar
grupo** y deja de admitir gente. Y si alguien se va, el grupo se reabre para
que el bot pueda meter a otro.

Botones del mensaje de grupo:

| Botón | Qué hace |
|---|---|
| 🔒 Cerrar grupo | Deja de admitir gente (solo si está abierto) |
| ✅ Completado | Lo dais por hecho y desaparece |
| 🚪 Salir del grupo | Te sales tú; el grupo se reabre |

## Qué pasa cuando alguien se cae

`/fuera` (o el botón "Hoy no puedo") borra todos sus registros, actualiza los
mensajes de sus grupos y, si alguno se queda por debajo del mínimo, lo disuelve
y devuelve a sus miembros a la cola para que el bot los recoloque con otra
gente. Nadie se queda tirado en un grupo de una persona.

## Estructura

```
src/
  index.js       Worker: enruta interacciones + cron
  discord.js     Verificación Ed25519, API REST, helpers de respuesta
  db.js          Todo el SQL contra D1
  matchmaker.js  Emparejamiento (funciones puras, testeables)
  ui.js          Embeds y botones como objetos planos
  panel.js       Panel fijo, desplegable de jefes y modal
  time.js        Periodos de reset con la hora española
  config.js      Jefes, llaves y tamaño de grupo
```

`matchmaker.js` y `time.js` no dependen ni de Discord ni de Cloudflare, que es
lo que permite testearlos con `node` a secas.
