# Hoja de ruta — Aethelgard · Legacy of Shadows

Estado tras la revisión **v2.3**: el juego arranca, el registro/login online funciona con **token de
sesión**, el servidor protege `state.json` con **lock de instancia única**, los personajes usan modelos
3D texturizados y animados (KayKit Adventurers) con **arma por clase, mano secundaria, yelmo visible y
tintes por rareza**, el escenario usa el pack KayKit Forest Nature con instancing, hay **grupo real con
chat de grupo**, el mercader tiene **stock visible y cantidades**, y el servidor aplica **CORS
restringido, nombres reservados y persistencia de combate**. El E2E (online + demo) pasa sin errores
de consola. Lo que queda, por orden de impacto.

## Hecho en v2.3 (referencia)

- Token de sesión (UUID, 12 h) exigido en `join`; `register`/`login` lo devuelven.
- `AETHELGARD_DATA_DIR` + `server.lock` con detección de instancia viva.
- `item_15` Arco Élfico, `item_16` Daga Sagrada, `item_17` Bastón de Aprendiz; starter kit por clase.
- Armas visibles por ítem (espada/hacha/cetro/arco/daga/bastón), tinte por rareza y mano secundaria
  (escudo/libro). Yelmo del Knight visible según `equipment.helm`.
- Grupo: `partyInvite`/`partyAccept`/`partyDecline`/`partyLeave`, `partyUpdate`, chat `party` privado.
- Mercader: selector de cantidad 1–99 y stock por fila.
- CORS restringido a localhost (`AETHELGARD_ORIGINS` para otros orígenes), nombres reservados y
  persistencia de combate en curso (movimiento/daño/regen marcan `dirty`).
- **Monstruos con modelo**: 4 esqueletos KayKit (guerrero, arquero, mago y minion) con textura embebida,
  escalado automático, animaciones KayKit reutilizadas y fallback procedural; tipos `skeleton_archer`,
  `skeleton_mage` y `skeleton_minion` documentados en `PROTOCOL.md`.
- **Universal Animation Library** (UAL, Quaternius CC0) retargetizada al rig KayKit, con selector
  Universal/KayKit en Ajustes (integración de OpenCode).

## 1. Crítico / operación

1. **Límite de conexiones por IP** y salas de Socket.IO por zona para reducir tráfico y abuso.
2. **Gestión de sesiones**: invalidar tokens al cambiar contraseña y añadir cierre de sesión.
3. **Backups automáticos** de `state.json` (rotación diaria) además del `state.corrupt-*`.

## 2. Jugabilidad / contrato

4. **Pertenencia de habilidades por clase.** El servidor acepta cualquier skill de cualquier clase; el
   cliente pinta las 12 en la hotbar. Propuesta: validar `CLASSES[clase].skills.includes(skillId)` y
   construir la hotbar desde `config`.
5. **Comida.** La barra COMIDA baja y al llegar a 0 detiene la regeneración para siempre: no hay ítem
   que la reponga. Propuesta: raciones/viandas en tienda o botín, o restaurar comida al subir de
   nivel/resucitar.
6. **Estado de muerte coherente.** Persistir `dead` (ya hecho) y añadir confirmación de muerte en
   reconexión; revisar la penalización de XP (−10 %) al resucitar.
7. **Portal y zonas.** El portal es decorativo; propuesta: viaje rápido entre santuarios y más
   landmarks por zona.
8. **Equipo con efecto real.** Que armadura/yelmo/botas/anillo aporten stats visibles en la hoja y que
   el yelmo cambie de modelo (no solo mostrar/ocultar el del Knight).
9. **Variantes de personaje.** Barbarian y Rogue del pack aún sin usar: sirven para élites/NPCs o para
   variantes de clase sin descargar arte nuevo.

## 3. Cliente / UX

10. **Móvil completo.** Ya se activa `body.touch` con puntero grueso; falta pulir gestos (tap para
    objetivo/caminar, arrastre para cámara, joystick con zona muerta) y probarlo en un dispositivo
    real o DevTools táctil.
11. **Ajustes con efecto real.** `showFps`, `autoTarget` y `minimapZoom` ya se aplican; añadir UI para
    `invertY` y `damageNumbers`, y aplicar `showNames` a entidades creadas tras el login.
12. **Descartar objeto online.** Hoy se deshabilita en online (no hay evento en el contrato).
    Propuesta: nuevo evento C→S `dropItem {itemId, count}` que cree el drop en el suelo.
13. **Escenario por biomas.** El pack Forest Nature trae 105 modelos (también troncos, tocones y
    helechos). Propuesta: poblar el Bosque Sombrío con setas/helechos, el Abismo con roca volcánica
    extra y el Santuario con detalles de piedra, y teñir el suelo por zona con la paleta del pack.
14. **Accesibilidad.** `aria-live` en toasts, roles y focus-trap en ventanas, tamaños de fuente
    mínimos, navegación por teclado en inventario.
15. **Rendimiento.** Rebuilds de DOM por frame (tracker/party cada 150 ms), `refreshAll` en cada
    `charUpdate`, un div por número flotante, buffer de audio por golpe. En 3D ya se usa instancing
    para el escenario y `SkeletonUtils` para clonar personajes sin recargar GLB.

## 4. Calidad / operación

16. **Suite de pruebas automatizada** más allá del E2E: tests de servidor con `node:test` para
    inventario/equipo/quests/economía y un cliente socket.io de pruebas (devDependency) para validar
    throttles, AoE, token y grupo.
17. **Docker + CI.** `Dockerfile` para `node server.js`, `HEALTHCHECK` a `/api/health` y workflow que
    corra `npm ci`, `npm run verify` y `npm run e2e` en modo headless.
18. **Logs estructurados y métricas.** `pino` o logs JSON, contadores de jugadores, ticks, muertes y
    tasa de error; `/api/metrics` opcional.
19. **Versionado del save.** `version` en `data/state.json` ya existe; añadir migraciones por versión
    (hoy `normalizeCharacter` parchea campos).
20. **Documentación viva.** Mantener `PROTOCOL.md` como contrato y generar tipos/constantes desde un
    único catálogo compartido (`shared/catalog.js`) para que cliente y servidor no diverjan.

## Cómo avanzar ahora (sugerencia de 3 pasos)

1. **Suite `node:test` + CI (16–17)**: congela el contrato antes de seguir añadiendo juego.
2. **Hotbar por clase, comida y muerte (4–6)**: sensación de MMO redonda sin tocar la arquitectura.
3. **Escenario por biomas y accesibilidad (13–14)**: acabado visual y de usabilidad.
