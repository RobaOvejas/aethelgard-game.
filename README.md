# Aethelgard — Legacy of Shadows · v2.4

MMORPG de mundo abierto **HTML5 + WebGL (three.js) + Node.js/Socket.IO**, sin base de datos externa.
Versión 2.4 («Administración»): cuenta **ADMIN** con panel y comandos para invocar/eliminar esqueletos,
teletransportarse, darse objetos/oro/nivel, cambiar atributos y modo dios, sobre el mundo de esqueletos
de v2.3 (4 tipos, 20 spawns) y las mejoras anteriores: token de sesión, instancia única, equipo visible,
grupo con chat privado y mercader con cantidades/stock.

---

## Requisitos

- **Node.js ≥ 18** (probado con Node 24).
- Navegador con WebGL (Chrome/Edge/Firefox). Sin MongoDB ni claves externas.

## Arranque rápido

```powershell
cd D:\PROYECTO MMORPG\aethelgard-upgrade
npm install        # solo la primera vez
npm start          # servidor en http://localhost:3100
```

Abre `http://localhost:3100` y pulsa **Ctrl+F5** tras actualizar el proyecto.

- Si el puerto está ocupado, el servidor prueba 3101, 3102…; mira la línea `URL:` al arrancar.
- Si aparece «Ya hay una instancia de Aethelgard…», ya hay otro servidor sobre la misma carpeta de datos.
- `AETHELGARD_DATA_DIR` permite usar otra carpeta de datos (el E2E lo hace).
- `AETHELGARD_ADMIN_PASSWORD` define la contraseña de la cuenta ADMIN al crearla.

### Scripts

| Comando | Qué hace |
|---|---|
| `npm start` | arranca el servidor (`server.js`) |
| `npm run dev` | arranca con `nodemon` |
| `npm run seed` | crea/actualiza los usuarios demo sin pisar un estado existente |
| `npm run verify` | verificador estático del cliente (`verify.js`) |
| `npm run e2e` | E2E real vía CDP con Chrome/Edge headless + capturas en `shots/` |
| `npm test` | suite `node:test` del servidor (en desarrollo) |

## Cuentas de prueba

| Cuenta | Contraseña | Uso |
|---|---|---|
| `demo` | `demo1234` | personaje demo (Caballero Oscuro) |
| `kundun` | `kundun1234` | personaje demo (Hechicero Arcano) |
| **`Admin`** | **`admin1234`** | **cuenta ADMIN con acceso total** |

> Cambia la contraseña de ADMIN en producción:
> `set AETHELGARD_ADMIN_PASSWORD=otraClave` antes de arrancar (solo aplica al crear la cuenta).
> Si ya existe, se mantiene la anterior.

---

## Cuenta ADMIN y panel de administración

Al iniciar sesión como `Admin`, aparece el botón **🛠️ Admin** en el menú derecho y el atajo **G**.

### Panel (ventana Administración)

- **Dios ON/OFF**: inmunidad total (los esqueletos no hacen daño).
- **Curar todo**: restaura HP/MP/CP/comida y resucita.
- **Matar todo** / **Limpiar esqueletos** / **Limpiar drops**.
- **Nivel** (1–100) con recálculo de atributos y vitales; **Oro** libre.
- **Invocar esqueleto**: tipo (guerrero, arquero, mago, minion), X e Y.
- **Teletransportar** a coordenadas.
- **Dar objeto** (cantidad) o **tirarlo al suelo**.
- **Atributos** (STR/DEX/INT/VIT/WIT/MEN) editables.
- **Lista de esqueletos** con posición, vida y botón **Eliminar**.
- Todas las acciones se confirman con un aviso y refrescan el panel.

### Comandos de chat (solo Admin)

```
/adminhelp
/spawn <tipo> [x y]      p. ej.  /spawn skeleton_mage 12 12
/tp <x> <y>
/give <itemId> [n]       p. ej.  /give item_8 1
/gold <n>
/level <n>
/stat <str|dex|int|vit|wit|men> <n>
/heal
/god [on|off]
/killall
/clear                   vacía la lista de esqueletos
/drop <itemId> [x y]
/monsters
```

Los eventos CRUD están documentados en [PROTOCOL.md](PROTOCOL.md) (apéndice v2.4): `adminSpawn`,
`adminRemove`, `adminKillAll`, `adminClearMonsters`, `adminTeleport`, `adminGiveItem`, `adminGiveGold`,
`adminSetLevel`, `adminSetStat`, `adminHeal`, `adminGod`, `adminClearDrops`, `adminSpawnDrop`, `adminList`.

---

## Controles

| Acción | Tecla / ratón |
|---|---|
| Mover | `W A S D` o flechas |
| Seleccionar objetivo / caminar | Click izquierdo |
| Rotar cámara | Mantener click derecho y arrastrar |
| Zoom | Rueda del ratón |
| Objetivo más cercano | `Tab` |
| Lanzar habilidad | `1` … `9`, `0`, `-`, `=`, o click en la barra |
| Ataque básico | `Espacio` |
| Recoger botín / hablar con NPC | `F` |
| Chat | `Enter` (comandos `/help`, `/online`, `/stats`, `/who`; Admin `/adminhelp`) |
| Inventario · Personaje · Misiones | `I` · `P` · `J` |
| Mapa · Grupo · Mercader | `M` · `Y` · `C` |
| Ayuda · Ajustes · Admin | `H` · `O` · `G` |
| Cerrar ventanas | `Esc` |

En móvil aparece un **joystick táctil** y botones de acción; el HUD se reajusta automáticamente.

## Modo sin servidor

El botón **«Jugar demo sin servidor (offline)»** arranca una simulación local completa en el navegador
(mundo, IA, combate, botín, misiones). Útil para probar la interfaz o si el backend no está levantado.
Si se pierde la conexión con el servidor, el cliente reintenta y avisa.

---

## Contenido del juego

- **4 clases**: Caballero Oscuro, Tirador Elfo, Hechicero Arcano y Sacerdote, con **modelos 3D
  texturizados y animados** (pack KayKit: Knight, Ranger, Mage y Rogue_Hooded) — idle, caminar,
  ataque y muerte — y **arma inicial propia** (espada, arco élfico, bastón de aprendiz o daga sagrada).
- **12 habilidades** con coste de maná, enfriamiento, rango y elemento: fuego, hielo, rayo, sagrado,
  físico, arcano; incluye AoE (Torbellino, Meteoro), buffs (Escudo, Impulso), curación y teletransporte.
- **Solo esqueletos**: 4 tipos con IA (guerrero, arquero, mago y minion; aggro, persecución, leash,
  ataque con enfriamiento y respawn de 10–15 s) y **modelo 3D con textura** del pack KayKit Skeletons.
  Se retiraron goblins, lobos, espectros, ogros, campeones y el jefe Lord Kundun: el mundo es ahora
  una invasión de huesos.
- **Progresión**: XP con curva `100 · nivel^1.55`, subida de nivel con crecimiento de atributos,
  vitales y poder, y **3 puntos de atributo por nivel** repartibles desde la hoja de personaje.
- **Botín y economía**: oro y objetos con rareza (común → legendario); se recogen del suelo y se
  venden al mercader. En online el mercader tiene **stock visible y selector de cantidad** (1–99).
- **Inventario (24) y equipo** (arma, armadura, yelmo, botas, anillo) con arrastrar y soltar y
  estadísticas derivadas. El **arma equipada se ve en la mano** (espada, hacha, arco, daga, cetro o
  bastón, **teñida según su rareza**); la **mano secundaria** muestra escudo o libro, y el **yelmo del
  Knight** aparece u oculta según el equipo.
- **Grupo de aventura**: invitar/aceptar/rechazar/salir, lista de miembros con nivel y vida, y chat
  exclusivo de grupo.
- **6 misiones** con progreso automático por bajas o recolección (q1/q3/q4/q5 adaptadas a esqueletos).
- **Zonas del mundo**: Santuario de la Aurora, Llanuras de Aethel, Bosque Sombrío y Ruinas del Abismo,
  con escenario 3D (árboles, rocas, hierba) del pack KayKit Forest Nature.

## Estructura del proyecto

```
server.js              Backend Express + Socket.IO: cuentas, sesiones, mundo, IA, combate, admin
logic/grid.js          Colisiones y rejilla
world.json             Mapa 200x200 (paredes y zonas)
public/index.html      Cliente completo (HUD, 3D, ventanas, admin)
public/vendor/         three.js r128, socket.io 4.7, GLTFLoader y SkeletonUtils locales
public/assets/characters/  Personajes KayKit (GLB) + animaciones + licencia
public/assets/monsters/    Esqueletos KayKit (GLB con textura embebida) + licencia
public/assets/world/       Escenario KayKit Forest Nature (GLTF + paleta) + licencia
data/state.json        Persistencia (usuarios, personajes, quests) — generada en ejecución
verify.js              Verificador estático del cliente
e2e.js                 E2E real vía CDP con Chrome/Edge headless + capturas
PROTOCOL.md            Contrato de red (REST + Socket.IO + apéndices v2.1/v2.3/v2.4)
BACKEND.md             Notas del backend: endpoints, eventos, decisiones
ROADMAP.md             Siguientes pasos priorizados
COORDINACION.md        Reglas para trabajar con varias sesiones/agentes en el mismo árbol
```

## Notas técnicas

- `data/state.json` se guarda con escritura debounced (1 s), autosave cada 30 s y al cerrar con `Ctrl+C`.
  Si está corrupto se aparta como `data/state.corrupt-<ts>.json` y el servidor no arranca.
- El servidor es autoritativo: máximo 1 paso de movimiento cada 120 ms, 3 mensajes de chat cada 2 s,
  5 registros/minuto por IP y payloads de socket de 16 KB.
- Los personajes se cargan al **entrar al mundo** (`GLTFLoader` + `SkeletonUtils`); si el pack falta,
  el cliente cae a los modelos procedurales. Las animaciones se sincronizan con `AnimationMixer`.
- **Sesión**: `register`/`login` devuelven un token (UUID, 12 h) que el cliente envía en `join`.
- **Instancia única**: `data/server.lock` impide dos servidores sobre el mismo `DATA_DIR`.
- **CORS**: por defecto solo localhost; amplía con `AETHELGARD_ORIGINS`.
- **Universal Animation Library** (Quaternius, CC0): retarget al rig KayKit y selector en Ajustes.
- **Admin**: la cuenta se garantiza al arrancar; todos los eventos `admin*` validan `char.admin`.

## Créditos y licencias

- **Personajes 3D**: *KayKit Adventurers Character Pack 2.0* de **Kay Lousberg**
  ([kaylousberg.com](https://www.kaylousberg.com)) — **CC0 1.0**; ver
  `public/assets/characters/LICENSE-KayKit.txt`.
- **Monstruos 3D**: *KayKit Character Pack: Skeletons* de **Kay Lousberg** — **CC0 1.0**; ver
  `public/assets/monsters/LICENSE-KayKit-Skeletons.txt`.
- **Escenario natural**: *KayKit Forest Nature Pack 1.0* del mismo autor — **CC0 1.0**; ver
  `public/assets/world/LICENSE-KayKit-Forest.txt`.
- **Animaciones**: *Universal Animation Library 1 — Standard* de **Quaternius**
  ([quaternius.com](https://quaternius.com)) — **CC0 1.0**, retargetizadas al rig KayKit.
- **Motor 3D**: [three.js](https://threejs.org) r128 (MIT), servido localmente en `public/vendor/`.
- **Red**: [Socket.IO](https://socket.io) 4.x (MIT).
- El resto del código y el arte procedural (FX, audio, montañas, ruinas, portal) son propios del proyecto.

## Enlaces

- Contrato de red: [PROTOCOL.md](PROTOCOL.md)
- Notas del backend: [BACKEND.md](BACKEND.md)
- Hoja de ruta: [ROADMAP.md](ROADMAP.md)
- Coordinación entre sesiones: [COORDINACION.md](COORDINACION.md)
