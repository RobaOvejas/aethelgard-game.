# Coordinación — DeepSeek Harness (Lead) ↔ OpenCode

Dos agentes trabajan sobre el mismo árbol (`D:\PROYECTO MMORPG\aethelgard-upgrade`). Este archivo es
el punto de acuerdo. **Léelo antes de editar** y actualiza la sección «Registro» al empezar/terminar.

## Estado base verificado (2026-11-02 10:00)

- Versión **2.3.0** (`package.json`, `Aethelgard.version` y pantalla de entrada).
- E2E: **29/29 pasos OK**, 0 errores de consola, 0 warnings, 0 peticiones ≥400.
- `node --check server.js` y `node verify.js`: sin fallos.
- Servidor parado; `data/server.lock` eliminado.

## Reglas de oro

1. **Un servidor por `DATA_DIR`.** El lock `data/server.lock` aborta la segunda instancia. Si aparece
   «Ya hay una instancia…», es el lock, no un bug: para dos servidores usa
   `AETHELGARD_DATA_DIR=<carpeta distinta>`.
2. **Puertos:** desarrollo `3100`; pruebas/E2E `3111–3130` (`E2E_PORT`). No reutilizar el puerto del otro.
3. **No matar `node.exe`/`chrome.exe` en bloque.** Matar solo el PID propio; el otro agente puede tener
   su servidor o su E2E corriendo (ya provocó un 500/timeout intermitente).
4. **Anota en «Registro»** qué archivo vas a tocar antes de tocarlo y qué has hecho al terminar.
5. **No mover la carga de assets de `startGame` a `boot`.** Bloquea el login en headless (costó depurarlo);
   los GLB se cargan al entrar al mundo.
6. **Contrato = `PROTOCOL.md`.** Cualquier evento/campo nuevo se documenta ahí antes de implementarlo.
7. **Versión:** si cambia, actualizar `package.json`, `Aethelgard.version` y el chip de `#auth-version`.
8. **E2E:** `npm run e2e` usa su propio servidor y `DATA_DIR` temporal. No editar `e2e.js` mientras el
   otro está ejecutándolo.
9. **Nada de `git`:** no hay repositorio. Un `git init` + commit base ayudaría a ver diffs y volver atrás;
   no se ha hecho sin permiso del usuario.

## Archivos y dueño propuesto (a confirmar con el usuario)

| Archivo | Dueño propuesto | Notas |
|---|---|---|
| `server.js` | **OpenCode** (crafting, dungeon, monstruos) | DSH solo correcciones puntuales avisando antes |
| `public/index.html` | **DSH** (UX/cliente) | UI de crafting/dungeon: coordinar quién |
| `e2e.js`, `verify.js`, `tests/` | **DSH** (QA) | OpenCode puede añadir pasos avisando |
| `README.md`, `PROTOCOL.md`, `BACKEND.md`, `ROADMAP.md` | **DSH** | Contrato y docs |
| `package.json` | **DSH** | Versión y scripts |
| `dungeon_world*.json`, `test_crafting.js` | **OpenCode** | Nuevos, sin conflicto |

## Trabajo en curso de OpenCode (observado, no tocar sin acuerdo)

- `RECIPES` y crafting (`item_20`–`item_37`, materiales), handler `craft` en `server.js`.
- Modo mapa mazmorra: `DUNGEON_WORLD=1` carga `dungeon_world_100.json`; también `dungeon_world.json`.
- Nuevos monstruos: `skeleton_archer`, `skeleton_mage`, `skeleton_minion` (21 spawns).
- `tests/server.test.js` (node:test) y `test_crafting.js`.
- Pasos nuevos en `e2e.js` (mercader comprar/vender).

### Bloqueo conocido en la suite de OpenCode

`tests/server.test.js` hace `require('server.js')` esperando `CLASSES`, `SKILLS`, etc. Hoy
`server.js` no exporta nada y arranca el listener al importarse → la suite cuelga. Para arreglarlo hay
que añadir al final de `server.js`:

```js
if (require.main === module) { bootstrap().catch(...); }
module.exports = { CLASSES, SKILLS, ITEMS, QUESTS, MONSTER_TYPES, /* … helpers */ };
```

Es un cambio en `server.js`: que lo haga **un solo agente** (propuesto: OpenCode, que es el dueño) y
añadir `"test": "node --test tests/"` a `package.json`.

## Cambio en curso (OpenCode): Universal Animation Library (UAL)

- Asset: `public/assets/characters/anim/UAL1_Standard.glb` (7.6 MB, Quaternius, CC0).
- Cliente: `UAL_FILE`, `UAL_BONES`, `UAL_CLIPS`, retarget en tiempo real al rig KayKit de 23 huesos,
  `Settings.animationSet` (`ual` por defecto, `kaykit` alternativo) y selector en Ajustes.
- **Mientras dure: OpenCode es dueño de `public/index.html`, `README.md` y `e2e.js`.** DSH no edita
  esos archivos; solo revisa en lectura y ejecuta QA.
- La carga de UAL va en `loadCharacters()` (al entrar al mundo, no en `boot`): mantenerlo así.

### Checklist de QA de UAL (DSH)

- [ ] `Aethelgard.characterAssets()` → `ready`, `ual: true`, `ualClips > 30`, `animationSet: 'ual'`.
- [ ] 4 clases cargan modelo y animación sin errores de consola.
- [ ] `animState()`: reposo `UAL_Idle`, caminar `UAL_Walk`, ataque `UAL_Attack` (según clase).
- [ ] Cambio Ajustes → Animaciones entre `Universal (UAL)` y `KayKit clásicas` sin recargar.
- [ ] `verify.js` sin fallos y E2E completo OK (sin warnings nuevos).
- [ ] Créditos/licencia en README y carpeta `anim/`.

### QA UAL — 2026-11-02 10:50 (headless; preliminar porque OpenCode seguía editando)
- **OK**: 67 clips totales, **42 de UAL**, `animationSet: 'ual'`; reposo `UAL_Idle`; selector Ajustes
  cambia a KayKit (`Walking_A`) y vuelve a UAL (`UAL_Walk`); **0 errores y 0 warnings** de consola.
- **⚠️ Rendimiento**: en headless software, `characterAssets().ready` tardó **274,9 s** (GLB UAL de
  7,6 MB + retarget de 42 clips). `charAssets.ready` se marca **después** del retarget, así que los
  cuerpos no se adjuntan hasta terminar: en equipos lentos el jugador puede quedarse sin modelo un rato.
- **Recomendación a OpenCode**: marcar `ready`/adjuntar con KayKit en cuanto estén los modelos base y
  retargetear UAL en segundo plano (y re-adjuntar al terminar), o cachear clips retargeteados; añadir
  un paso E2E específico de UAL con timeout ampliado. Medir en GPU real antes de dar por buena la carga.

## Cambio en curso (DSH): esqueletos con textura (KayKit Skeletons)

- Pack origen: `Texturas Monstruos/characters/gltf/` (4 GLB con textura PNG embebida, rig de 23 huesos).
- Copiado a `public/assets/monsters/` + `LICENSE-KayKit-Skeletons.txt` (CC0, Kay Lousberg).
- Cliente: `MONSTER_BASE`, `MONSTER_FILES`, `MONSTER_HEIGHTS`, `monsterAssets`, `loadMonsters()`,
  `buildMonsterBody()`, `refreshMonsterModels()`. Mapeo: `skeleton → Skeleton_Warrior`,
  `skeleton_archer → Skeleton_Rogue`, `skeleton_mage → Skeleton_Mage`, `skeleton_minion → Skeleton_Minion`.
  Reutiliza clips KayKit (`Idle_A`, `Walking_A`, `Use_Item`, `Death_A`); fallback procedural intacto.
- **DSH edita `public/index.html` desde ~11:05 hasta terminar el QA.** OpenCode no debe tocar ese archivo
  mientras; si necesita editarlo, avisar en este archivo/registro.
- Diagnóstico nuevo: `Aethelgard.monsterAssets()` → modelos, texturas por modelo, `gltfMonsters` y
  lista de monstruos con posición/clip.
- **QA 2026-11-02 11:52 (headless)**: 4 modelos cargados; texturas embebidas presentes en
  `skeleton 9/10`, `skeleton_archer 9/10`, `skeleton_mage 8/9`, `skeleton_minion 8/9` mallas (la malla
  restante es el material `Glow` de los ojos, sin mapa a propósito); 5 esqueletos GLTF en el mundo;
  capturas `22-esqueleto-detalle.png` / `23-esqueleto-detalle-2.png`. Animaciones se enganchan cuando
  termina `charAssets` (ULA lenta en headless). Fallback procedural verificado si el pack falta.

## Registro

Formato: `AAAA-MM-DD HH:mm · agente · archivo(s) · qué`.

- `2026-11-02 10:00 · DSH · todos · baseline v2.3.0 verificado; E2E 29/29; lock limpio`.
- `2026-11-02 10:0x · DSH · e2e.js/server.js/index.html · CORS, nombres reservados, persistencia dirty, timeout 20 s, versión 2.3.0`.
- `2026-11-02 10:08 · OpenCode · anim/UAL1_Standard.glb + index.html + README · integración Universal Animation (retarget + selector)`.
- `2026-11-02 10:4x · DSH · COORDINACION.md · OpenCode pasa a ser dueño de index.html/README durante UAL; QA en preparación`.
- `2026-11-02 10:50 · DSH · shots/16-19 · QA UAL: carga OK (42 clips), selector OK, 0 errores; rendimiento 275 s en headless (reportado)`.
- `2026-11-02 10:53 · OpenCode · index.html · sigue editando UAL (mtime 10:53); DSH espera para E2E definitivo`.
- `2026-11-02 11:05 · DSH · assets/monsters + index.html · integración de esqueletos KayKit (4 GLB con textura embebida, mapeo por tipo, animaciones y fallback); faltaba en el pack de OpenCode`.
- `2026-11-02 11:2x · DSH · PROTOCOL.md · documentados skeleton_archer/mage/minion, spawns y mapeo visual a modelos`.
