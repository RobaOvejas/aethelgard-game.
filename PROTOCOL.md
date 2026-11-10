# AETHELGARD — Protocolo v2 (contrato frontend ⇄ servidor)

Este documento es la **única fuente de verdad** del contrato de red. Backend y frontend deben
respetarlo al pie de la letra. Los nombres son sensibles a mayúsculas.

## 1. REST

| Método | Ruta | Body | Respuesta OK | Errores |
|---|---|---|---|---|
| GET | `/api/health` | — | `200 {ok:true, uptime, players, monsters, version}` | — |
| GET | `/api/world` | — | `200 {config}` | — |
| POST | `/api/register` | `{username, password, class}` | `201 {userId, characterId, char, token}` | `400 {message}` |
| POST | `/api/login` | `{username, password}` | `200 {userId, char, token}` | `401 {message}` |

`token` es un identificador de sesión (`crypto.randomUUID`) válido 12 h. El cliente DEBE guardarlo en
memoria y enviarlo en `join` (ver §3). No se persiste en disco ni se registra en logs.

Validación: `username` 3-16 chars `[A-Za-z0-9_ÁÉÍÓÚáéíóúñÑ]`; `password` 4-64.
`class` ∈ `DarkKnight | ElfMarksman | ArcaneSorcerer | Priest` (default `DarkKnight`).
Fallos inesperados → `500 {message}`. Nunca devolver stack ni hash.

## 2. Forma de datos

### `char`
```js
{
  id, name, class, level, exp, expNext,
  hp, maxHp, mp, maxMp, cp, maxCp, food, maxFood, gold,
  gridX, gridY,
  stats: { str, dex, int, vit, wit, men },      // atributos
  inventory: [{ itemId, count }],                // hasta 24 entradas
  equipment: { weapon: itemId|null, armor: ..., helm: ..., boots: ..., ring: ... },
  quests: [{ id, state: 'active'|'done', progress }],
  kills, deaths, online: true
}
```

### `player` (difusión de mundo, compacto)
```js
{ id, name, class, level, gridX, gridY, hp, maxHp, mp, maxMp, cp, maxCp,
  food, dead: false, moving: false, attackAnim: 0, weapon: itemId|null, helm: itemId|null }
```

`weapon` es el ítem equipado en la mano y `helm` el yelmo (solo visual para el resto de clientes).
El cliente acopla el arma al hueso `handslot.r` y muestra/oculta el yelmo del Knight según `helm`.

### `monster`
```js
{ id, name, type: 'skeleton'|'skeleton_archer'|'skeleton_mage'|'skeleton_minion',
  level, gridX, gridY, hp, maxHp, moving, attackAnim, targetId|null }
```

### `drop`
```js
{ id, itemId, gridX, gridY, gold }
```

## 3. Socket.IO — cliente → servidor

| Evento | Payload | Ack |
|---|---|---|
| `join` | `{username, token}` | `cb(res)` |
| `move` | `{dx, dy}` (−1\|0\|1) | — |
| `moveTo` | `{x, y}` | — |
| `setTarget` | `{targetId\|null}` | — |
| `attack` | `{targetId, skillId}` | — |
| `skill` | `{skillId, targetId?}` | — |
| `pickup` | `{dropId}` | — |
| `useItem` | `{itemId}` | — |
| `equip` | `{itemId}` | — |
| `unequip` | `{slot}` | — |
| `quest` | `{action:'accept'\|'complete', questId}` | — |
| `chat` | `{channel:'global'\|'local'\|'party'\|'help', text}` | — |
| `partyInvite` | `{name}` | — |
| `partyAccept` | `{name}` (nombre del líder que invitó) | — |
| `partyDecline` | `{name}` | — |
| `partyLeave` | `{}` | — |
| `respawn` | `{}` | — |
| `ping` | `{t}` | `cb(t)` |

`join` ack:
```js
{ success: true, char, online, config }
// o { success:false, message }
```

El servidor valida `token`: debe corresponder al `userId` del `username` y no estar caducado. Si falta
o no es válido → `{success:false, message:'Sesion invalida. Vuelve a iniciar sesion.'}`.

`config` enviado en `join` (el frontend lo usa como catálogo; debe ir completo):
```js
{ tickMs, tileSize: 64, mapSize: 200, serverTime,
  classes: { DarkKnight:{...}, ... },
  skills: [ { id, name, desc, icon, mp, cd, range, element, power, kind:'damage'|'buff'|'heal'|'blink', key } ],
  items: [ { id, name, icon, type:'weapon'|'armor'|'helm'|'boots'|'ring'|'potion'|'material',
             rarity:'common'|'uncommon'|'rare'|'epic'|'legendary', value, dmg?, def?, heal?, stats? } ],
  quests: [ { id, name, desc, goal:{type:'kill'|'collect', target, count}, reward:{exp, gold, itemId?} } ],
  monsters: [ {type, name, hp, dmg, aggro, speed, exp} ]
}
```

## 4. Socket.IO — servidor → cliente

| Evento | Payload |
|---|---|
| `world` | `{t, players:[player], monsters:[monster], drops:[drop]}` cada `tickMs` (150 ms) |
| `combat` | `{attackerId, attackerName, targetId, targetName, damage, crit, element, skillId, targetHp, targetMaxHp, killed}` |
| `charUpdate` | `{char}` (parcial o completo tras consumir ítems, subir nivel, etc.) |
| `levelUp` | `{level, maxHp, maxMp, stats}` |
| `chat` | `{channel, from, text, ts, kind:'player'\|'system'}` |
| `loot` | `{itemId, item, count, gold}` o `{gold}` |
| `questUpdate` | `{quests}` |
| `toast` | `{type:'success'\|'error'\|'info'\|'warn', message}` |
| `death` | `{killerName}` |
| `respawned` | `{char}` |
| `online` | `{count}` |
| `shopStock` | `{stock:[{itemId, price, count}]}` |
| `buff` | `{buff:{id, name, icon, dur}}` (al activar un buff; `dur` en ms) |
| `teleportFx` | `{gridX, gridY}` (al usar `teleport`) |
| `partyUpdate` | `{partyId, members:[{id, name, class, level, hp, maxHp, online}]}` o `{partyId:null}` al salir |
| `partyInvite` | `{fromName}` |

### Grupo (party)
- Un personaje solo pertenece a un grupo. El líder es quien invita; al salir el líder, el grupo pasa al
  siguiente miembro. El grupo se disuelve cuando queda vacío.
- `partyUpdate` se emite a todos los miembros (incluido el que sale con `partyId:null`).
- El canal de chat `party` solo se difunde a los miembros del grupo; si el personaje no está en grupo,
  responde con `toast` de aviso.
- Al desconectarse un miembro se elimina del grupo y se notifica a los demás.

### Compatibilidad (obligatoria)
Además, cada tick emitir también `updateWorld` con `{players, monsters}` donde `players` es el
mismo array de `world.players`. Cada golpe emitir también `combatResult` con
`{attackerName, targetName, damage, targetHp}`.

> Nota: `public/main.js` (cliente 2D de la v1) no forma parte del paquete v2; los eventos de
> compatibilidad se mantienen por contrato para cualquier consumidor externo. El tráfico `world`
> y `updateWorld` se envía solo a sockets que hayan hecho `join` (room `world-room`).

## 5. Catálogo canónico de habilidades (12)

| # | id | nombre | mp | cd (ms) | rango | elemento | poder | kind |
|---|---|---|---|---|---|---|---|---|
| 1 | `basic` | Ataque Básico | 0 | 900 | 1 | physical | 12 | damage |
| 2 | `fireball` | Bola de Fuego | 25 | 2600 | 9 | fire | 46 | damage |
| 3 | `holyShield` | Escudo Sagrado | 30 | 12000 | 0 | holy | 0 | buff |
| 4 | `potion` | Poción Rápida | 0 | 4000 | 0 | — | 0 | heal |
| 5 | `teleport` | Teletransporte | 50 | 20000 | 0 | arcane | 0 | blink |
| 6 | `lightning` | Relámpago | 35 | 5200 | 9 | lightning | 62 | damage |
| 7 | `iceBolt` | Flecha de Hielo | 22 | 3400 | 9 | ice | 40 | damage |
| 8 | `arrowShot` | Disparo Certero | 12 | 1800 | 10 | physical | 34 | damage |
| 9 | `smite` | Castigo Divino | 38 | 7000 | 6 | holy | 55 | damage |
| 10 | `sprint` | Impulso | 14 | 9000 | 0 | physical | 0 | buff |
| 11 | `whirlwind` | Torbellino | 42 | 8500 | 3 | physical | 58 | damage (AoE radio 3) |
| 12 | `meteor` | Meteoro | 70 | 18000 | 12 | fire | 120 | damage (AoE radio 3 en el objetivo) |

Las skills con `aoe: true` golpean a todos los monstruos vivos dentro del radio: `whirlwind` centrado
en el personaje, `meteor` centrado en el objetivo. El resto son de objetivo único.

## 6. Catálogo canónico de ítems

```
item_1  Espada Normal      weapon common  dmg 20  value 10   icon ⚔️
item_2  Armadura Normal     armor  common  def 10  value 15   icon 🛡️
item_3  Poción de Vida      potion common  heal 200 value 5   icon 🧪
item_4  Hacha de Guerra     weapon uncommon dmg 38 value 40   icon 🪓
item_5  Yelmo de Acero      helm   uncommon def 14 value 35   icon ⛑️
item_6  Botas del Viento    boots  rare     def 9  value 60   icon 👢  stats {dex:4}
item_7  Anillo Arcano       ring   rare     value 80          icon 💍  stats {int:6}
item_8  Cetro de Aeth       weapon epic     dmg 66 value 180  icon 🔮  stats {int:12}
item_9  Coraza de Kundun    armor  legendary def 42 value 400 icon 🛡️
item_10 Colmillo de Hueso    material common  value 4          icon 🦴
item_11 Esencia Sombría     material rare    value 25         icon ✨
item_12 Oro Antiguo         material uncommon value 12        icon 🪙
item_13 Poción de Maná      potion common  healMp 180 value 25 icon 🔷
item_14 Elixir de Aeth      potion rare    heal 999 healMp 999 value 80 icon 🧴
item_15 Arco Élfico         weapon uncommon dmg 24 value 30   icon 🏹
item_16 Daga Sagrada        weapon uncommon dmg 18 value 25   icon 🗡️
item_17 Bastón de Aprendiz  weapon common  dmg 20 value 28    icon 🪄
```

Armas de clase (starter kit): `DarkKnight → item_1`, `ElfMarksman → item_15`,
`ArcaneSorcerer → item_17`, `Priest → item_16`. `applyStarterKit` equipa el arma de la clase, 3 pociones
de vida y 50 de oro. Los personajes ya creados conservan su equipo.

## 7. Quest 3 canónicas

```
q1  El Despertar        goal kill skeleton_minion x3 reward exp 300  gold 120
q2  Huesos del Abismo   goal kill skeleton x2        reward exp 650  gold 250 item_5
q3  El Ritual del Abismo goal kill skeleton_mage x3  reward exp 2500 gold 1200 item_9
```

## 8. Reglas de servidor

- Tick de mundo: `150 ms` (≈6.6 Hz) con difusión `world` + `updateWorld` (solo a la room `world-room`).
- Movimiento: 1 celda cada `120 ms` como máximo por personaje (throttle de servidor); `move` se ignora
  si hay un `path` activo. `moveTo` resuelve BFS, limitado a 200 celdas y con cancelación del path
  anterior ante cualquier destino inválido.
- IA: aggro por radio, persecución con paso de 1 celda cada `speed` ticks, leash a 14 celdas del spawn,
  ataque con cooldown 1.2 s, respawn por tipo (skeleton 15 s, archer 12 s, mage 13 s, minion 10 s).
  Un monstruo no reaparece sobre una celda ocupada.
- Nada de confianza en el cliente: validar rango, cooldown, MP, muerte, pertenencia y ritmo.
- Persistencia: `data/state.json` (usuarios con hash bcrypt, personajes, quests, muertes). Escritura
  debounced (1 s) + autosave cada 30 s + al `SIGINT`/`SIGTERM`. Movimiento, path, casteos, daño
  recibido y regeneración marcan el estado como sucio, de modo que el autosave guarda posición,
  HP/MP y cooldowns. Si el archivo existe pero está corrupto se aparta como
  `data/state.corrupt-<ts>.json` y el proceso no arranca (no se sobrescribe con demos).
- Chat: recortar a 200 chars, eliminar `<`/`>` y saltos de línea; máx 3 mensajes / 2 s por socket.
- Rate limit en memoria: máx 6 intentos de login fallidos / 60 s por IP y máx 5 registros / 60 s por IP.
- Payload máximo de socket: 16 KB (`maxHttpBufferSize`).
- Nombres reservados: el registro rechaza `sistema`, `system`, `admin`, `administrador`, `gm`,
  `moderador`, `staff`, `soporte`, `servidor`, `server` y `aethelgard` (evita suplantación en el chat).
- CORS: por defecto solo orígenes `localhost`/`127.0.0.1`/`::1` en el puerto del servidor. Para otros
  orígenes, definir `AETHELGARD_ORIGINS` (lista separada por comas).
- Sesión: `token` (UUID) emitido por register/login, TTL 12 h, validado en `join`. Se purga
  periódicamente junto a los rate limits.
- Instancia única: el servidor escribe `${DATA_DIR}/server.lock` con `{pid, port, startedAt}`. Si ya
  existe y el PID está vivo, aborta con mensaje claro (evita dos procesos escribiendo `state.json`).
  `DATA_DIR` es configurable por la variable de entorno `AETHELGARD_DATA_DIR` (por defecto `data/`).
- Sin dependencias nuevas. Sin mongoose. CommonJS. Compatible con Node ≥ 18.

---

# APÉNDICE v2.1 — «El mundo crece» (cambios aditivos, obligatorios)

Todo lo de v2 sigue vigente. Lo de abajo **se añade**; nada se renombra ni se elimina.

## Z1. Zonas del mundo

El servidor no envía zonas: el cliente las deduce de `gridX/gridY`. El servidor solo debe respetar
los rangos para spawns y no bloquear movimiento fuera de ellos (dentro de 0…199).

| id | Nombre | Rango de celdas | Bioma |
|---|---|---|---|
| `sanctuary` | Santuario de la Aurora | x 0-8, y 0-8 | pradera inicial, NPC Anciano Sabio en (10,10) |
| `plains` | Llanuras de Aethel | x 0-16, y 0-18 (resto) | pradera, minions esqueletos |
| `forest` | Bosque Sombrío | x 16-30, y 0-18 | bosque denso, arqueros y magos esqueletos |
| `abyss` | Ruinas del Abismo | x 16-32, y 18-32 | roca y lava, esqueletos de élite |

## Z2. Tipos de monstruo (solo esqueletos)

| type | Nombre | Nv | HP | Daño | Aggro | Exp | Oro | Respawn | Notas |
|---|---|---|---|---|---|---|---|---|---|
| `skeleton` | Guerrero Esqueleto | 2 | 220 | 20 | 7 | 110 | 34 | 15 s | modelo `Skeleton_Warrior` |
| `skeleton_archer` | Arquero Esqueleto | 3 | 180 | 15 | 6 | 100 | 42 | 12 s | rango 2, modelo `Skeleton_Rogue` |
| `skeleton_mage` | Mago Esqueleto | 4 | 160 | 22 | 9 | 120 | 48 | 13 s | rango 3, modelo `Skeleton_Mage` |
| `skeleton_minion` | Minion Esqueleto | 2 | 100 | 12 | 5 | 80 | 22 | 10 s | modelo `Skeleton_Minion` |

El mundo actual **solo tiene esqueletos** (se retiraron goblin, lobo, espectro, campeón, ogro y Lord
Kundun). El campo opcional `elite: boolean` sigue soportado por el cliente, pero ningún spawn lo usa.

`world.monsters[]` gana el campo opcional `elite: boolean` (reservado).

Los tipos `skeleton*` se dibujan en el cliente con los GLB de `public/assets/monsters/` (pack **KayKit
Skeletons**, CC0, textura PNG embebida en el GLB). Comparten el rig de 23 huesos de los personajes, así
que reutilizan sus clips (`Idle_A`, `Walking_A`, `Use_Item`, `Death_A`); si el pack no está disponible,
el cliente mantiene el modelo procedural de respaldo.

## Z3. Spawns actuales (solo esqueletos, 20 activos)

```
skeleton_minion (6,6) (10,13) (4,16) (12,4)    -> zona plains/santuario
skeleton_archer (18,6) (22,11) (26,4) (20,16)  -> zona forest
skeleton_mage   (24,10) (28,14) (24,20) (28,30)-> zona forest/abyss
skeleton        (18,15) (21,17) (20,22) (26,27)-> ruinas
skeleton_minion (19,18) (27,22) (24,8) (26,12) -> ruinas
```

## Z4. Puntos de atributo

- `char` gana `statPoints: number` (empieza en 0; **+3 por nivel**).
- Evento cliente → servidor: `allocStat` con `{stat:'str'|'dex'|'int'|'vit'|'wit'|'men'}`.
- El servidor valida `statPoints > 0`, aplica +1 al atributo, descuenta el punto, recalcula derivados y
  responde con `charUpdate` (char completo). Si no quedan puntos, `toast` de error.
- El cliente muestra botones «+» junto a cada atributo en la hoja de personaje.

## Z5. Mercader (economía online)

- Evento cliente → servidor: `shop` con `{}` → responde con `toast` o con el evento `shopStock`
  `{stock:[{itemId, price, count}]}`.
- `buy` con `{itemId, count?}` (count 1 por defecto, máx 99): valida oro, inventario (24), stock;
  descuenta oro, añade objeto, emite `charUpdate` + `loot` + `toast`.
- `sell` con `{itemId, count?}`: valida que el objeto esté en el inventario; paga
  `Math.max(1, Math.floor(value * 0.6))` por unidad; emite igual.
- Catálogo de la tienda (precio fijo de compra):
  `item_3` Poción de Vida 40 · `item_13` Poción de Maná 45 · `item_14` Elixir de Aeth 120 ·
  `item_1` Espada Normal 90 · `item_2` Armadura Normal 110 · `item_4` Hacha de Guerra 260 ·
  `item_5` Yelmo de Acero 240 · `item_6` Botas del Viento 340 · `item_10` Colmillo de Hueso 12.
- Objetos nuevos (añadir al catálogo de `ITEMS` en `config.items`):
  ```
  item_13 Poción de Maná  potion  common  healMp 180  value 25  icon 🔷
  item_14 Elixir de Aeth  potion  rare    heal 999 healMp 999 value 80 icon 🧴
  ```
  `useItem` debe aplicar `healMp` además de `heal` cuando exista.

## Z6. Misiones nuevas (total 6)

```
q4  Flechas del Bosque     goal kill skeleton_archer x4 reward exp 900  gold 300 item_6
q5  La Horda de Huesos     goal kill skeleton_minion x6 reward exp 1800 gold 600 item_7
q6  Ecos del Abismo        goal collect item_11 x3      reward exp 1200 gold 400 item_8
```

`q6` es de tipo `collect`: el progreso se calcula contando `inventory[item_11].count` (y también al
recoger `item_11` del suelo). Las recompensas se reclaman igual que en v2.

## Z7. Eventos nuevos resumidos

| Dirección | Evento | Payload |
|---|---|---|
| C→S | `allocStat` | `{stat}` |
| C→S | `shop` | `{}` |
| C→S | `buy` | `{itemId, count?}` |
| C→S | `sell` | `{itemId, count?}` |
| S→C | `shopStock` | `{stock:[{itemId, price, count}]}` |
| S→C | `buff` | `{buff:{id, name, icon, dur}}` |
| S→C | `teleportFx` | `{gridX, gridY}` |

Todo debe estar validado y envuelto en try/catch, como el resto. Sin dependencias nuevas.

---

# APÉNDICE v2.3 — Equipo visible, grupo y sesión

## A1. Sesión (token)
- `register`/`login` devuelven `token`. El cliente lo guarda **en memoria** (`S.authToken`), lo envía
  en `join {username, token}` y de nuevo en cada `rejoin` tras reconectar.
- Si el `join` devuelve error de sesión, el cliente NO entra al mundo: muestra el mensaje y deja
  reintentar el login. El modo demo offline no usa token.

## A2. Instancia única y `DATA_DIR`
- `DATA_DIR` = `process.env.AETHELGARD_DATA_DIR` o `data/` (resuelto a absoluto). `state.json`,
  `state.corrupt-*.json` y `server.lock` viven ahí.
- Al arrancar: si `server.lock` existe y su `pid` sigue vivo → `console.error` y `process.exit(1)`.
  Si el PID no existe, se considera obsoleto y se sobrescribe. El lock se borra en `shutdown()`
  (`SIGINT`/`SIGTERM`) y en `uncaughtException`.
- El E2E arranca su servidor con `AETHELGARD_DATA_DIR` apuntando a un directorio temporal para no
  chocar con una instancia de desarrollo ni contaminar `data/state.json`.

## A3. Armas visibles por ítem (cliente)
| itemId | modelo |
|---|---|
| `item_1` | `sword_1handed` |
| `item_4` | `axe_2handed` |
| `item_8` | `staff` |
| `item_15` | `bow_withString` |
| `item_16` | `dagger` |
| `item_17` | `staff` |

Si el ítem no tiene modelo o no hay arma equipada, no se dibuja nada. El arma se acopla a `handslotr`
del rig y se alinea con la mano.

## A4. Yelmo (cliente)
- El Knight tiene los nodos `Knight_Helmet` y `Knight_HelmetVisor`: visibles solo si
  `equipment.helm` no es nulo (p. ej. `item_5`). El resto de clases no llevan yelmo en el modelo.
- El `helm` del jugador se actualiza con `charUpdate` (propio) y con `world.players[].helm` (resto).

## A5. Tintes por rareza (cliente)
El material del arma se tiñe multiplicando su color base con el color de rareza (mezcla al 35 %):
`common #ffffff`, `uncommon #7ef29a`, `rare #7fb2ff`, `epic #c58cff`, `legendary #ffd36b`.
Cada arma clona su material (las instancias no comparten el tinte). Las armas comunes quedan sin tinte.

## A6. Mercader (UI)
- La ventana de comercio muestra el **stock** de cada fila (`shopStock`) y un selector de cantidad
  (1–99) usado en `buy`/`sell`; si no hay `shopStock` se asume 99.
- Los totales se recalculan al cambiar cantidad; el servidor sigue validando oro/inventario/stock.

## A7. Grupo (UI)
- Sin grupo: lista de jugadores online con botón **Invitar** (`partyInvite`).
- Invitación recibida (`partyInvite`): mostrar Aceptar (`partyAccept`) / Rechazar (`partyDecline`).
- En grupo: miembros con nivel y vida, botón **Salir** (`partyLeave`) y chat de grupo usando el canal
  `party` existente. `partyUpdate` refresca la ventana; `partyId:null` indica que ya no hay grupo.

---

# APÉNDICE v2.4 — Administración (cuenta ADMIN)

## A8. Cuenta ADMIN
- El servidor garantiza una cuenta `Admin` al arrancar (`ensureAdminAccount`). Contraseña inicial
  `admin1234`, configurable con `AETHELGARD_ADMIN_PASSWORD`.
- `char` gana `admin: boolean` y `god: boolean` (solo lectura para el cliente). El cliente muestra el
  botón **Admin** y la tecla `G` solo si `char.admin === true`.
- El servidor valida `char.admin` en todos los eventos `admin*`; un jugador normal recibe ack
  `{ok:false}` y un `toast` de aviso.

## A9. Eventos admin (C→S) y respuestas
Todos aceptan un ack `{ok: boolean}` y emiten `adminResult {ok, message}` al emisor.

| Evento | Payload | Efecto |
|---|---|---|
| `adminSpawn` | `{type, gridX, gridY}` | crea un esqueleto (tipo del catálogo) |
| `adminRemove` | `{id}` | elimina un esqueleto por id |
| `adminKillAll` | `{}` | mata todos (drops + respawn normal) |
| `adminClearMonsters` | `{}` | vacía la lista de esqueletos |
| `adminTeleport` | `{gridX, gridY}` | teletransporta al admin |
| `adminGiveItem` | `{itemId, count}` | añade objetos (apilables o copias) |
| `adminGiveGold` | `{amount}` | añade oro |
| `adminSetLevel` | `{level 1–100}` | fija nivel y recalcula atributos/vitales |
| `adminSetStat` | `{stat, value}` | fija un atributo base |
| `adminHeal` | `{}` | restaura HP/MP/CP/comida y resucita |
| `adminGod` | `{on}` | activa/desactiva inmunidad total |
| `adminClearDrops` | `{}` | elimina todos los drops del suelo |
| `adminSpawnDrop` | `{itemId, gridX, gridY}` | crea un drop en el suelo |
| `adminList` | `{}` | responde con evento `adminMonsters {monsters:[{id,type,name,level,hp,maxHp,gridX,gridY,alive}]}` |

## A10. Comandos de chat (solo ADMIN)
`/adminhelp`, `/spawn <tipo> [x y]`, `/tp <x> <y>`, `/give <itemId> [n]`, `/gold <n>`, `/level <n>`,
`/stat <str|dex|int|vit|wit|men> <n>`, `/heal`, `/god [on|off]`, `/killall`, `/clear`,
`/drop <itemId> [x y]`, `/monsters`.

## A11. Cliente
- Ventana `Admin` (`Windows.admin`, atajo `G`): nivel, oro, spawn, teleport, objetos, atributos, lista
  de esqueletos con botón Eliminar, modo dios, curar, matar/limpiar y atajos de comandos.
- `Aethelgard.adminState()` → `{admin, god, monsters}`.


