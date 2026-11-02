# Aethelgard — Legacy of Shadows · v2.3

MMORPG de mundo abierto **HTML5 + WebGL (three.js) + Node.js/Socket.IO**, sin base de datos externa.
Versión 2.3 («Equipo y seguridad»): token de sesión, instancia única, armas y yelmo visibles con tintes
por rareza, grupo real con chat privado y mercader con cantidades/stock, sobre el mundo 3D de v2.1
(7 tipos de monstruo, 16 spawns, 6 misiones, puntos de atributo y zonas).

---

## Arranque rápido

```bash
npm install      # si no lo has hecho ya
npm start        # http://localhost:3100
```

Abre **http://localhost:3100** en Chrome, Edge o Firefox.

### Verificación automatizada

```bash
npm run verify   # comprobación estática del cliente (sintaxis, ids, módulos)
npm run e2e      # E2E real con Chrome headless: registro online, mundo, combate, demo y capturas
```

`npm run e2e` necesita Chrome o Edge instalado y genera `e2e-report.json` + `shots/*.png`.
El E2E levanta su propio servidor en el puerto 3111 (configurable con `E2E_PORT`) para no chocar
con una instancia de desarrollo.

> El servidor usa el puerto **3100** por defecto (el 3000 lo ocupa otro proyecto de esta máquina).
> Cámbialo con la variable de entorno `PORT` o editando `.env`. Si el puerto está ocupado, el
> servidor prueba 3101, 3102… automáticamente y lo indica por consola.

### Cuentas demo (creadas al primer arranque)

| Usuario | Contraseña |
|---|---|
| `demo` | `demo1234` |
| `kundun` | `kundun1234` |

También puedes crear tu propia cuenta desde la pantalla de entrada y elegir clase.

### Modo sin servidor

El botón **«Jugar demo sin servidor (offline)»** arranca una simulación local completa en el
navegador (mundo, IA, combate, botín, misiones). Útil para probar la interfaz o si el backend no
está levantado. Si se pierde la conexión con el servidor, el cliente reintenta y avisa.

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
| Chat | `Enter` (comandos `/help`, `/online`, `/stats`, `/who`, `/where`) |
| Inventario · Personaje · Misiones | `I` · `P` · `J` |
| Mapa · Grupo · Mercader | `M` · `Y` · `C` |
| Ayuda · Ajustes | `H` · `O` |
| Cerrar ventanas | `Esc` |

En móvil aparece un **joystick táctil** y botones de acción; el HUD se reajusta automáticamente.

---

## Contenido del juego

- **4 clases**: Caballero Oscuro, Tirador Elfo, Hechicero Arcano y Sacerdote, con **modelos 3D
  texturizados y animados** (pack KayKit: Knight, Ranger, Mage y Rogue_Hooded) — idle, caminar,
  ataque y muerte — y **arma inicial propia** (espada, arco élfico, bastón de aprendiz o daga sagrada).
- **12 habilidades** con coste de maná, enfriamiento, rango y elemento: fuego, hielo, rayo, sagrado,
  físico, arcano; incluye AoE (Torbellino, Meteoro), buffs (Escudo, Impulso), curación y teletransporte.
- **10 tipos de monstruo** con IA: aggro, persecución, leash, ataque con enfriamiento y respawn distinto
  por tipo (goblin 8 s, esqueleto 15 s, jefe 45 s…). Incluye lobos, espectros, ogros, un campeón élite y
  **cuatro esqueletos con modelo 3D y textura** (guerrero, arquero, mago y minion, pack KayKit Skeletons);
  el jefe **Lord Kundun** tiene barra propia.
- **Progresión**: XP con curva `100 · nivel^1.55`, subida de nivel con crecimiento de atributos,
  vitales y poder, y **3 puntos de atributo por nivel** repartibles desde la hoja de personaje.
- **Botín y economía**: oro y objetos con rareza (común → legendario); se recogen del suelo y se
  venden al mercader. En online el mercader tiene **stock visible y selector de cantidad** (1–99).
- **Inventario (24) y equipo** (arma, armadura, yelmo, botas, anillo) con arrastrar y soltar y
  estadísticas derivadas (ataque, defensa, crítico, poder). El **arma equipada se ve en la mano**
  (espada, hacha, arco, daga, cetro o bastón, **teñida según su rareza**) y también para el resto de
  jugadores; la **mano secundaria** muestra escudo (Caballero) o libro (Mago/Sacerdote), y el
  **yelmo del Knight** aparece u oculta según el equipo.
- **Grupo de aventura**: invitar/aceptar/rechazar/salir, lista de miembros con nivel y vida, y chat
  exclusivo de grupo (canal `party`).
- **6 misiones** con progreso automático por bajas o por recolección (q6 cuenta esencias del
  inventario) y recompensas.
- **Zonas del mundo**: Santuario de la Aurora, Llanuras de Aethel, Bosque Sombrío y Ruinas del Abismo,
  con bioma, niebla y banner propios.
- **Escenario 3D natural**: árboles, arbustos, rocas y matas de hierba del pack KayKit Forest Nature,
  integrados con `InstancedMesh` (cientos de instancias en pocas llamadas de dibujo) y fallback
  procedural si el pack no está disponible.
- **Ciclo día/noche** de 5 minutos, antorchas con luz dinámica, portal arcano, estanque, ruinas y
  bosque procedural.
- **Audio 100 % procedural** (WebAudio): golpes, magia, subida de nivel, recogida y ambiente musical.
  Sin archivos de sonido externos.
- **Calidad gráfica configurable** (alta/media/baja) y **modo 2D de respaldo** si el navegador no
  puede crear un contexto WebGL.

---

## Estructura del proyecto

```
server.js              Backend completo (Express + Socket.IO, ~2.450 líneas)
world.json             Mapa 200×200: muros, NPC, posiciones iniciales
logic/grid.js          Sistema de rejilla y colisiones
scripts/initDB.js      Semilla de data/state.json (usuarios demo, sin MongoDB)
public/index.html      Cliente completo: motor 3D + HUD + UI + simulador local (~5.100 líneas)
public/assets/characters/  Personajes KayKit (GLB con textura) + packs de animación + licencia
public/assets/monsters/ Esqueletos KayKit (GLB con textura embebida) + licencia
public/assets/world/   Escenario KayKit Forest Nature (GLTF + paleta forest_texture.png) + licencia
public/vendor/         three.js r128, socket.io 4.7, GLTFLoader y SkeletonUtils locales
data/state.json        Persistencia generada en tiempo de ejecución (usuarios, personajes, quests)
verify.js              Verificador estático del cliente (sin navegador)
e2e.js                 E2E real vía CDP con Chrome/Edge headless + capturas
PROTOCOL.md            Contrato de red v2 + apéndice v2.1 (eventos, payloads, catálogos)
BACKEND.md             Notas del backend: endpoints, eventos, decisiones
ROADMAP.md             Siguientes pasos priorizados
```

> Los módulos heredados de la primera versión (`logic/combat.js`, `logic/profession.js`,
> `models/index.js` y `public/main.js`) **no forman parte de este paquete**: el backend v2 tiene su
> propia tabla de habilidades, capa de datos y validación, y el cliente v2 sustituye al 2D. El
> servidor sigue emitiendo `updateWorld` y `combatResult` por si se reengancha un cliente legado.

---

## API y red

- `GET /api/health` → estado del servidor.
- `GET /api/world` → catálogo/config del mundo.
- `POST /api/register` `{username,password,class}` · `POST /api/login` `{username,password}`.
- Socket.IO C→S: `join`, `move`, `moveTo`, `setTarget`, `attack`, `skill`, `pickup`, `useItem`, `equip`,
  `unequip`, `quest`, `chat`, `respawn`, `ping`, `allocStat`, `shop`, `buy`, `sell`.
  S→C: `world` cada 150 ms, `updateWorld`, `combat`, `combatResult`, `charUpdate`, `levelUp`, `chat`,
  `loot`, `questUpdate`, `toast`, `death`, `respawned`, `online`, `shopStock`, `buff`, `teleportFx`.
- Detalle exacto de payloads en [PROTOCOL.md](PROTOCOL.md).

El servidor es la autoridad: valida rango, enfriamientos, maná, objetivos vivos, propiedad del
socket y ritmo de movimiento; el chat se sanea, tiene límite de mensajes y hay límite de intentos
de login y de registro por IP.

---

## Cambios respecto a la versión anterior

**Cliente**

- Motor 3D real (antes figuras de cajas sobre un plano): suelo procedural, cielo con shader, sol/luna,
  estrellas, niebla, montañas, árboles/rocas/hierba instanciados, ruinas, estanque, portal y antorchas
  con luz dinámica.
- Personajes articulados con animación de caminar/atacar/morir, sombra de contacto, barras de vida
  flotantes y nombre sobre la cabeza.
- Combate completo con 12 habilidades, enfriamientos visuales, coste de maná, proyectiles, partículas,
  círculos mágicos, números de daño flotantes, críticos y sacudida de cámara.
- HUD nuevo: vitales CP/HP/MP/COMIDA, objetivo con retrato y distancia, barra de jefe, minimapa
  funcional con zonas y marcadores, rastreador de misiones, grupo, barra de XP/oro, chat con canales
  y comandos, reloj de rendimiento (FPS/ping/jugadores).
- Ventanas arrastrables: inventario con equipo y drag & drop, hoja de personaje, diario de misiones,
  mapa del mundo, mercader, ajustes (calidad, volúmenes, sensibilidad), ayuda y diálogo de NPC.
- Audio procedural, pantalla de carga, pantalla de muerte con penalización, aviso de subida de nivel,
  notificaciones, tooltips ricos, ajustes persistentes en `localStorage`.
- Responsive + controles táctiles; respaldo 2D si no hay WebGL; three.js y socket.io servidos en local.

**Errores corregidos del cliente anterior**

- `updateWorld` accedía a `myCharacter.id` sin comprobar que existiera → excepción al conectar.
- El chat no enviaba nada al servidor (solo se pintaba en local) → ahora es un canal real.
- `activeProjectiles` declarado y nunca usado → sistema de proyectiles implementado.
- `requestAnimationFrame` podía arrancar el bucle dos veces → arranque idempotente.
- El formulario ignoraba los errores del servidor y siempre intentaba registrar → flujo
  login/registro tolerante con mensajes reales.
- Las barras CP/MP/COMIDA eran decorativas y estáticas → ahora reflejan el estado real del personaje.
- No había inventario, misiones, habilidades, muerte/respawn ni equipamiento.
- El portal cambiaba el color del cielo sin lógica de zona ni retorno.

**Backend**

- Persistencia real en `data/state.json` (antes todo se perdía al reiniciar).
- IA de monstruos con leash, respawn por tipo, botín y economía; antes los monstruos caminaban en
  línea recta y podían salir del mapa.
- Habilidades, enfriamientos, maná, muerte, respawn con penalización de XP, misiones y chat real.
- Validación de todas las entradas, saneado de chat, límite de intentos de login y cierre limpio.
- Compatibilidad: se siguen emitiendo `updateWorld` y `combatResult` para el cliente 2D heredado.

---

## Notas técnicas

- Requiere Node.js ≥ 18. Sin MongoDB, sin claves de API, sin CDN obligatorio.
- `data/state.json` se guarda con escritura debounced (1 s) y al cerrar con `Ctrl+C`. Si el archivo
  está corrupto se aparta como `data/state.corrupt-<ts>.json` y el servidor no arranca (no se
  sobrescribe con los demos).
- `npm run seed` crea/actualiza los usuarios demo (idempotente: no pisa un estado existente).
- La carpeta `public/vendor/` contiene three.js r128 y socket.io 4.7 para funcionar sin conexión; si
  falta, el cliente cae a los CDN y, en último término, al modo 2D.
- El servidor es autoritativo también en el ritmo: máximo 1 paso de movimiento cada
  `MOVE_THROTTLE_MS` (120 ms por defecto), 3 mensajes de chat cada 2 s, 5 registros/minuto por IP y
  payloads de socket de 16 KB como máximo.
- Los personajes se cargan en segundo plano (`GLTFLoader` + `SkeletonUtils`) **al entrar al mundo**, para
  que el login no se bloquee; si el pack falta o falla, el cliente cae a los modelos procedurales. Las
  animaciones se sincronizan por frame con `AnimationMixer` (idle / caminar / correr / atacar / morir).
- **Animaciones Universal (UAL)**: `public/assets/characters/anim/UAL1_Standard.glb` (Quaternius, CC0)
  se retargetiza en tiempo real al rig KayKit de 23 huesos. Se activan por defecto y pueden cambiarse
  a las animaciones KayKit originales desde **Ajustes → Animaciones**. La locomoción elige caminar,
  trotar o esprintar según las casillas que avance el servidor por tick.
- **Sesión**: `register`/`login` devuelven un token (UUID, 12 h) que el cliente envía en `join`; sin él
  el servidor rechaza la conexión. El token vive solo en memoria.
- **Instancia única**: el servidor usa `data/server.lock`; si ya hay otra instancia viva sobre el mismo
  directorio aborta. `AETHELGARD_DATA_DIR` permite usar otra carpeta de datos (lo usa el E2E).
- **Grupo**: invitar/aceptar/rechazar/salir; chat `party` solo para los miembros del grupo.
- Siguiente iteración planificada en [ROADMAP.md](ROADMAP.md) (tests + CI, comida, muerte coherente,
  portal, accesibilidad).

---

## Créditos y licencias

- **Personajes 3D**: *KayKit Adventurers Character Pack 2.0* de **Kay Lousberg**
  ([kaylousberg.com](https://www.kaylousberg.com)) — licencia **CC0 1.0**. Texturas y animaciones
  incluidas; ver `public/assets/characters/LICENSE-KayKit.txt`.
- **Monstruos 3D**: *KayKit Character Pack: Skeletons* de **Kay Lousberg** — licencia **CC0 1.0**.
  Cuatro esqueletos (guerrero, pícaro/arquero, mago y minion) con textura embebida en el GLB; ver
  `public/assets/monsters/LICENSE-KayKit-Skeletons.txt`.
- **Escenario natural**: *KayKit Forest Nature Pack 1.0* del mismo autor — licencia **CC0 1.0**;
  ver `public/assets/world/LICENSE-KayKit-Forest.txt`.
- **Animaciones**: *Universal Animation Library 1 — Standard* de **Quaternius**
  ([quaternius.com](https://quaternius.com)) — licencia **CC0 1.0**. Incluye 43 clips
  (idle, caminar, correr, combate, magia, muerte, saltos, etc.) retargetizados al rig KayKit.
- **Motor 3D**: [three.js](https://threejs.org) r128 (MIT), servido localmente en `public/vendor/`.
- **Red**: [Socket.IO](https://socket.io) 4.x (MIT).
- El resto del código y el arte procedural (FX, audio, montañas, ruinas, portal) son propios del proyecto.
