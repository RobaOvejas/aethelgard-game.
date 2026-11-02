# Aethelgard - Backend v2.1

## Arranque
- Node >= 18. `npm install` instala express, socket.io, cors, dotenv, bcryptjs; `nodemon` en dev.
- `npm start` (o `npm run dev`) escucha en `PORT` (3100 por defecto; si esta ocupado reintenta puertos siguientes), sirve `public/index.html` en `/` y crea `data/state.json` con demos si no existe.
- `npm run seed` crea solo en frio: si `data/state.json` ya existe no lo sobrescribe y sale con aviso. Demos: `demo`/`demo1234` (DarkKnight) y `kundun`/`kundun1234` (ArcaneSorcerer).
- Persistencia debounced 1 s, autoguardado cada 30 s y en `SIGINT`/`SIGTERM` con `server.close()`.
- Si `data/state.json` existe pero no se puede parsear o su esquema es invalido, se aparta como `data/state.corrupt-<timestamp>.json` y el proceso termina con error en lugar de regenerar demos (evita perder cuentas).

## REST
| Metodo | Ruta | Respuesta |
|---|---|---|
| GET | `/api/health` | 200 `{ok,uptime,players,monsters,version}` sin auth |
| GET | `/api/world` | 200 `{config}` (catalogo completo) |
| POST | `/api/register` | 201 `{userId,characterId,char}`; 400 validacion/duplicado |
| POST | `/api/login` | 200 `{userId,char}`; 401 credenciales; 429 tras 6 fallos/60 s por IP |
| Otra `/api/*` | 404 `{message}`; error no controlado 500 `{message}` sin stack |

## Socket.IO
Cliente -> servidor: `join`, `move`, `moveTo`, `setTarget`, `attack`, `skill`, `pickup`, `useItem`, `equip`, `unequip`, `quest`, `chat`, `respawn`, `ping`, `allocStat`, `shop`, `buy`, `sell`.
Servidor -> cliente: `world` y `updateWorld` cada 150 ms (solo room `world-room`); `combat` y `combatResult`; `charUpdate`, `levelUp`, `chat`, `loot`, `questUpdate`, `toast`, `death`, `respawned`, `online`, `shopStock`, `buff`, `teleportFx`.
`join` responde `{success,char,online,config}` y `ping` responde `cb(t)`. Todo payload se valida (tipo, rango, cooldown, MP, objetivo vivo, muerte y propiedad del socket).
- `move`: maximo 1 celda cada 120 ms por personaje (el servidor ignora el resto) y se cancela si hay `path` activo.
- `moveTo`: BFS con tope de 200 celdas; un destino invalido cancela el path anterior.
- `chat`: maximo 3 mensajes / 2 s por socket.
- `maxHttpBufferSize` = 16 KB.

## Decisiones
- Datos en memoria; la capa de persistencia vive en `server.js` (los modulos heredados `models/` y `logic/combat.js` no forman parte del paquete v2). El personaje se extiende dentro de `server.js` con `expNext`, `gold`, `inventory`, `equipment`, `quests`, `dmg` y `def` (campos aditivos sobre PROTOCOL).
- Colisiones con `logic/grid.js` y `world.json` (paredes y spawns de clase). `moveTo` resuelve BFS en servidor y avanza 1 celda por tick.
- IA: aggro por radio, persecucion, leash de 14 celdas, ataque cada 1.2 s y respawn goblin 8 s / skeleton 15 s / boss 45 s / wolf 10 s / ogre 20 s / specter 14 s / champion 30 s; drops en el suelo con caducidad de 60 s. El respawn espera a que la celda este libre.
- XP `expNext = round(100 * level^1.55)`; `levelUp` restaura HP/MP/CP, sube stats y otorga +3 puntos de atributo. Muerte: `death` + `dead:true`, se persiste `dead` para que un reinicio no regale la resurreccion; `respawn` al spawn de clase con -10% de XP y `deaths++`.
- Chat saneado (sin `<`/`>`, sin saltos de linea, maximo 200) y comandos `/help`, `/online`, `/who`, `/stats`. Los canales se difunden a todos (sin salas separadas).
- `skill` cubre dano, curacion (`potion`), buffs (`holyShield`, `sprint`) y blink (`teleport`, vuelve al spawn de clase). `attack` solo acepta skills de tipo damage. Las skills `aoe` (whirlwind, meteor) aplican dano radial en el servidor. Los buffs se anuncian con el evento `buff` y el blink con `teleportFx`.
- Inventario de 24 entradas; pociones y materiales apilan hasta 99. Equipar saca el objeto del inventario y desequipar lo devuelve; `dmg`/`def` se recalculan. Usar una poción con HP y MP al maximo no la consume.
- El oro de un drop se recoge siempre; el objeto solo si cabe en el inventario.
- Registro: usuario 3-16 `[A-Za-z0-9_ÁÉÍÓÚáéíóúñÑ]`, password 4-64, clase del catalogo (por defecto DarkKnight). `join` usa solo `username` segun PROTOCOL; un personaje = un socket. Limite de 5 registros / 60 s por IP.
- Sin PvP: `setTarget`/`attack` solo aceptan monstruos. Demos con Espada Normal equipada, 3 pociones y 50 de oro; los registros nuevos empiezan con el mismo starter kit.
- `charUpdate` incluye `dmg` y `def`; `world.players` y `updateWorld` respetan la forma compacta del protocolo. `player` incluye `weapon` (item equipado) para que el resto de clientes dibuje el arma visible.

## v2.1
- 7 tipos de monstruo y 16 spawns; `wolf` da 2 pasos por turno de IA, `specter` ataca a 4 celdas, `champion` es elite; `world.monsters[].elite`.
- `statPoints` (+3 por nivel) con `allocStat`; mercader `shop`/`shopStock`/`buy`/`sell` (venta `max(1, floor(value*0.6))`); `item_13`/`item_14`; 6 quests (q6 collect derivado del inventario).

## v2.3
- **Sesion**: `register`/`login` devuelven `token` (UUID, TTL 12 h, en memoria). `join` exige `{username, token}` valido; sin token o con token ajeno/caducado responde `Sesion invalida. Vuelve a iniciar sesion.`. Los tokens se purgan junto a los rate limits cada 120 ticks y nunca se registran en logs.
- **Instancia unica**: `DATA_DIR = AETHELGARD_DATA_DIR || data/`; `server.lock` con `{pid, port, startedAt}`. Si el PID del lock sigue vivo el arranque aborta con codigo 1; los locks obsoletos se eliminan. El lock se reescribe con el puerto final al escuchar y se borra en `shutdown()`/`uncaughtException`. El E2E usa un `DATA_DIR` temporal.
- **Armas de clase**: `item_15` Arco Elfico (ElfMarksman), `item_16` Daga Sagrada (Priest), `item_17` Baston de Aprendiz (ArcaneSorcerer); `applyStarterKit` equipa `CLASSES[clase].starterWeapon` (DK `item_1`) sin tocar personajes ya guardados.
- **Grupo**: `parties`/`partyInvites` en memoria; eventos `partyInvite`, `partyAccept`, `partyDecline`, `partyLeave`; difusion `partyUpdate {partyId, members}` (o `partyId:null` al salir); invitaciones solo del lider; si el lider sale, pasa el liderazgo; el grupo se disuelve al quedar vacio y al desconectar se limpia. El chat `party` solo se difunde a los miembros (si no hay grupo, `toast`).
- **Payload**: `player` incluye `weapon` y `helm` (solo visual para los demas clientes).
- **CORS**: por defecto solo se aceptan origenes `localhost`/`127.0.0.1`/`::1` en el puerto del servidor. Para exponerlo en red se define `AETHELGARD_ORIGINS` (lista separada por comas) con los origenes permitidos.
- **Nombres reservados**: no se pueden registrar `sistema`, `system`, `admin`, `administrador`, `gm`, `moderador`, `staff`, `soporte`, `servidor`, `server` ni `aethelgard` (evita suplantacion en el chat).
- **Persistencia de combate**: los pasos de movimiento, el path, los casteos, el dano recibido y la regeneracion marcan `dirty`, por lo que el autosave de 30 s guarda posicion, HP/MP y cooldowns aunque no haya otra accion.

