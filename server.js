'use strict';

// Aethelgard - Legacy of Shadows | Backend v2
// Contrato de red: PROTOCOL.md. Datos en memoria + persistencia en data/state.json.
// No modifica models/, logic/ ni world.json; el personaje se extiende aqui.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const GridSystem = require('./logic/grid');
// Cargar mapa dependiendo de variable de entorno
let worldMap;
if (process.env.DUNGEON_WORLD === '1') {
  worldMap = require('./dungeon_world_100.json');
  console.log('[server] Cargando mapa de mazmorra 100x100 (DUNGEON_WORLD=1)');
} else {
  worldMap = require('./world.json');
  console.log('[server] Cargando mundo 200x200 normal');
}
const pkg = require('./package.json');

const app = express();
const httpServer = http.createServer(app);
let PORT = Number(process.env.PORT) || 3100;
const BASE_PORT = PORT;
let listenAttempts = 0;
const VERSION = pkg.version || '2.0.0';
// CORS restringido: por defecto solo localhost/127.0.0.1 en el puerto del servidor.
// Para exponerlo en red, define AETHELGARD_ORIGINS con una lista separada por comas.
const EXTRA_ORIGINS = (process.env.AETHELGARD_ORIGINS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
function originAllowed(origin) {
  if (!origin) return true; // peticiones sin cabecera Origin (curl, health checks, same-origin simple)
  if (EXTRA_ORIGINS.indexOf(origin) !== -1) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname;
    if ((host === 'localhost' || host === '127.0.0.1' || host === '::1') && String(u.port || '') === String(PORT)) return true;
  } catch (err) {}
  return false;
}
const corsOptions = { origin: function (origin, callback) { callback(null, originAllowed(origin)); } };
const io = new Server(httpServer, { cors: corsOptions, maxHttpBufferSize: 16384 });
const TICK_MS = 150;
const TILE_SIZE = 64;
const MAP_SIZE = 200;
const MAX_INVENTORY_ENTRIES = 24;
const MAX_STACK = 99;
const MAX_CHAT_LENGTH = 200;
const DROP_TTL_MS = 60 * 1000;
const MONSTER_ATTACK_CD_MS = 1200;
const MONSTER_LEASH_RANGE = 14;
const SAVE_DEBOUNCE_MS = 1000;
const MAX_LOGIN_FAILURES = 6;
const LOGIN_WINDOW_MS = 60 * 1000;
const MAX_REGISTER_ATTEMPTS = 5;
const REGISTER_WINDOW_MS = 60 * 1000;
// B2: throttle anti-speedhack configurable via MOVE_THROTTLE_MS env var
const DEFAULT_MOVE_THROTTLE_MS = 120;
const MOVE_THROTTLE_MS = Number(process.env.MOVE_THROTTLE_MS) || DEFAULT_MOVE_THROTTLE_MS;

// B1: marcar dirty en combate y movimiento para garantizar persistencia cada 30 s
let lastDirtyCheck = 0;
const DIRTY_INTERVAL_MS = 30000; // 30 segundos
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h (PROTOCOL v2.3)
// DATA_DIR configurable para E2E y para separar instancias (AETHELGARD_DATA_DIR).
const DATA_DIR = path.resolve(process.env.AETHELGARD_DATA_DIR || path.join(__dirname, 'data'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LOCK_FILE = path.join(DATA_DIR, 'server.lock');

app.use(cors(corsOptions));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

// ---------------------------------------------------------------------------
// Catalogos canonicos (PROTOCOL.md secciones 5, 6 y 7)
// ---------------------------------------------------------------------------

const STAT_KEYS = ['str', 'dex', 'int', 'vit', 'wit', 'men'];
const EQUIP_SLOTS = ['weapon', 'armor', 'helm', 'boots', 'ring'];

const CLASSES = {
  DarkKnight: {
    name: 'Caballero Oscuro',
    desc: 'Guerrero de primera linea con gran vitalidad y golpes contundentes.',
    hp: 1200,
    mp: 220,
    cp: 320,
    stats: { str: 18, dex: 10, int: 5, vit: 16, wit: 8, men: 8 },
    growth: { hp: 120, mp: 20, cp: 25, str: 2, dex: 1, int: 1, vit: 2, wit: 1, men: 1 },
    skills: ['basic', 'whirlwind', 'holyShield', 'sprint'],
    starterWeapon: 'item_1',
    start: { x: 0, y: 0 }
  },
  ElfMarksman: {
    name: 'Tirador Elfo',
    desc: 'Arquero agil que castiga a distancia con flechas y magia de hielo.',
    hp: 950,
    mp: 260,
    cp: 400,
    stats: { str: 10, dex: 20, int: 8, vit: 12, wit: 12, men: 8 },
    growth: { hp: 95, mp: 25, cp: 30, str: 1, dex: 2, int: 1, vit: 1, wit: 2, men: 1 },
    skills: ['basic', 'arrowShot', 'iceBolt', 'sprint'],
    starterWeapon: 'item_15',
    start: { x: 1, y: 0 }
  },
  ArcaneSorcerer: {
    name: 'Hechicero Arcano',
    desc: 'Maestro de elementos devastadores; fragil pero letal a distancia.',
    hp: 800,
    mp: 500,
    cp: 250,
    stats: { str: 6, dex: 8, int: 22, vit: 10, wit: 18, men: 12 },
    growth: { hp: 75, mp: 45, cp: 20, str: 1, dex: 1, int: 3, vit: 1, wit: 2, men: 2 },
    skills: ['basic', 'fireball', 'lightning', 'teleport', 'meteor'],
    starterWeapon: 'item_17',
    start: { x: 2, y: 0 }
  },
  Priest: {
    name: 'Sacerdote',
    desc: 'Sanador sagrado que equilibra el castigo divino y la proteccion.',
    hp: 900,
    mp: 450,
    cp: 300,
    stats: { str: 7, dex: 9, int: 16, vit: 12, wit: 18, men: 22 },
    growth: { hp: 85, mp: 40, cp: 25, str: 1, dex: 1, int: 2, vit: 1, wit: 2, men: 3 },
    skills: ['basic', 'smite', 'holyShield', 'potion'],
    starterWeapon: 'item_16',
    start: { x: 3, y: 0 }
  }
};

const SKILLS = [
  { id: 'basic', name: 'Ataque Básico', desc: 'Golpe cuerpo a cuerpo con el arma equipada.', icon: '💥', mp: 0, cd: 900, range: 1, element: 'physical', power: 12, kind: 'damage', key: '1' },
  { id: 'fireball', name: 'Bola de Fuego', desc: 'Lanza una esfera de fuego que quema al objetivo.', icon: '🔥', mp: 25, cd: 2600, range: 9, element: 'fire', power: 46, kind: 'damage', key: '2' },
  { id: 'holyShield', name: 'Escudo Sagrado', desc: 'Reduce el dano recibido durante 12 segundos.', icon: '🛡️', mp: 30, cd: 12000, range: 0, element: 'holy', power: 0, kind: 'buff', key: '3' },
  { id: 'potion', name: 'Poción Rápida', desc: 'Recupera salud al instante sin consumir objetos.', icon: '🧪', mp: 0, cd: 4000, range: 0, element: 'none', power: 0, kind: 'heal', key: '4' },
  { id: 'teleport', name: 'Teletransporte', desc: 'Vuelve al santuario de tu clase.', icon: '🌀', mp: 50, cd: 20000, range: 0, element: 'arcane', power: 0, kind: 'blink', key: '5' },
  { id: 'lightning', name: 'Relámpago', desc: 'Rayos que atraviesan la armadura del enemigo.', icon: '⚡', mp: 35, cd: 5200, range: 9, element: 'lightning', power: 62, kind: 'damage', key: '6' },
  { id: 'iceBolt', name: 'Flecha de Hielo', desc: 'Proyectil helado que ralentiza a la presa.', icon: '❄️', mp: 22, cd: 3400, range: 9, element: 'ice', power: 40, kind: 'damage', key: '7' },
  { id: 'arrowShot', name: 'Disparo Certero', desc: 'Flecha precisa de largo alcance.', icon: '🏹', mp: 12, cd: 1800, range: 10, element: 'physical', power: 34, kind: 'damage', key: '8' },
  { id: 'smite', name: 'Castigo Divino', desc: 'Invoca la luz sagrada sobre el enemigo.', icon: '✨', mp: 38, cd: 7000, range: 6, element: 'holy', power: 55, kind: 'damage', key: '9' },
  { id: 'sprint', name: 'Impulso', desc: 'Aumenta tu velocidad de movimiento durante 9 segundos.', icon: '💨', mp: 14, cd: 9000, range: 0, element: 'physical', power: 0, kind: 'buff', key: '0' },
  { id: 'whirlwind', name: 'Torbellino', desc: 'Giro de arma que alcanza a los enemigos cercanos.', icon: '🌪️', mp: 42, cd: 8500, range: 3, element: 'physical', power: 58, kind: 'damage', key: '-', aoe: true },
  { id: 'meteor', name: 'Meteoro', desc: 'Invoca un meteorito devastador a distancia.', icon: '☄️', mp: 70, cd: 18000, range: 12, element: 'fire', power: 120, kind: 'damage', key: '=', aoe: true }
];

const SKILL_BY_ID = {};
for (const skill of SKILLS) SKILL_BY_ID[skill.id] = skill;

const ITEMS = {
  item_1: { id: 'item_1', name: 'Espada Normal', icon: '⚔️', type: 'weapon', rarity: 'common', value: 10, dmg: 20 },
  item_2: { id: 'item_2', name: 'Armadura Normal', icon: '🛡️', type: 'armor', rarity: 'common', value: 15, def: 10 },
  item_3: { id: 'item_3', name: 'Poción de Vida', icon: '🧪', type: 'potion', rarity: 'common', value: 5, heal: 200 },
  item_4: { id: 'item_4', name: 'Hacha de Guerra', icon: '🪓', type: 'weapon', rarity: 'uncommon', value: 40, dmg: 38 },
  item_5: { id: 'item_5', name: 'Yelmo de Acero', icon: '⛑️', type: 'helm', rarity: 'uncommon', value: 35, def: 14 },
  item_6: { id: 'item_6', name: 'Botas del Viento', icon: '👢', type: 'boots', rarity: 'rare', value: 60, def: 9, stats: { dex: 4 } },
  item_7: { id: 'item_7', name: 'Anillo Arcano', icon: '💍', type: 'ring', rarity: 'rare', value: 80, stats: { int: 6 } },
  item_8: { id: 'item_8', name: 'Cetro de Aeth', icon: '🔮', type: 'weapon', rarity: 'epic', value: 180, dmg: 66, stats: { int: 12 } },
  item_9: { id: 'item_9', name: 'Coraza de Kundun', icon: '🛡️', type: 'armor', rarity: 'legendary', value: 400, def: 42 },
  item_10: { id: 'item_10', name: 'Colmillo de Goblin', icon: '🦴', type: 'material', rarity: 'common', value: 4 },
  item_11: { id: 'item_11', name: 'Esencia Sombría', icon: '✨', type: 'material', rarity: 'rare', value: 25 },
  item_12: { id: 'item_12', name: 'Oro Antiguo', icon: '🪙', type: 'material', rarity: 'uncommon', value: 12 },
  item_13: { id: 'item_13', name: 'Poción de Maná', icon: '🔷', type: 'potion', rarity: 'common', value: 25, healMp: 180 },
  item_14: { id: 'item_14', name: 'Elixir de Aeth', icon: '🧴', type: 'potion', rarity: 'rare', value: 80, heal: 999, healMp: 999 },
  item_15: { id: 'item_15', name: 'Arco Élfico', icon: '🏹', type: 'weapon', rarity: 'uncommon', value: 30, dmg: 24 },
  item_16: { id: 'item_16', name: 'Daga Sagrada', icon: '🗡️', type: 'weapon', rarity: 'uncommon', value: 25, dmg: 18 },
  item_17: { id: 'item_17', name: 'Bastón de Aprendiz', icon: '🪄', type: 'weapon', rarity: 'common', value: 28, dmg: 20 },
  // B2: items de comida (raciones/viandas) que restauran la barra de comida.
  item_18: { id: 'item_18', name: 'Ración de Sobrevivencia', icon: '🍞', type: 'potion', rarity: 'common', value: 15, food: 50 },
  item_19: { id: 'item_19', name: 'Vianda Sagrada', icon: '🍖', type: 'potion', rarity: 'uncommon', value: 30, food: 20 },
  // B12: items de materiales craftables (herrería, minería, madera)
  item_20: { id: 'item_20', name: 'Cobre Nugget Pequeño', icon: '🟢', type: 'material', rarity: 'common', value: 5 },
  item_21: { id: 'item_21', name: 'Cobre Nugget Mediano', icon: '🟢', type: 'material', rarity: 'common', value: 15 },
  item_22: { id: 'item_22', name: 'Cobre Nugget Grande', icon: '🟢', type: 'material', rarity: 'common', value: 40 },
  item_23: { id: 'item_23', name: 'Lamina de Cobre Pequeña', icon: '🟫', type: 'material', rarity: 'uncommon', value: 12 },
  item_24: { id: 'item_24', name: 'Lamina de Cobre Mediana', icon: '🟫', type: 'material', rarity: 'uncommon', value: 30 },
  item_25: { id: 'item_25', name: 'Lamina de Cobre Grande', icon: '🟫', type: 'material', rarity: 'rare', value: 70 },
  item_26: { id: 'item_26', name: 'Varilla de Cobre Pequeña', icon: '🟦', type: 'material', rarity: 'uncommon', value: 18 },
  item_27: { id: 'item_27', name: 'Varilla de Cobre Mediana', icon: '🟦', type: 'material', rarity: 'rare', value: 50 },
  item_28: { id: 'item_28', name: 'Varilla de Cobre Grande', icon: '🟦', type: 'material', rarity: 'epic', value: 120 },
  // Herramientas básicas
  item_29: { id: 'item_29', name: 'Pico de Madera', icon: '⛏️', type: 'tool', rarity: 'common', value: 20, durability: 100 },
  item_30: { id: 'item_30', name: 'Martillo de Herrero', icon: '🔨', type: 'tool', rarity: 'common', value: 25, durability: 150 },
  item_31: { id: 'item_31', name: 'Llave Inglesa', icon: '🔧', type: 'tool', rarity: 'common', value: 18, durability: 80 },
  item_32: { id: 'item_32', name: 'Sierra de Madera', icon: '✂️', type: 'tool', rarity: 'common', value: 22, durability: 90 },
  // Materiales de madera y textiles
  item_33: { id: 'item_33', name: 'Tronco Pequeño', icon: '🌳', type: 'material', rarity: 'common', value: 8 },
  item_34: { id: 'item_34', name: 'Tronco Mediano', icon: '🌳', type: 'material', rarity: 'common', value: 20 },
  item_35: { id: 'item_35', name: 'Tronco Grande', icon: '🌳', type: 'material', rarity: 'uncommon', value: 50 },
  item_36: { id: 'item_36', name: 'Tela de Lino', icon: '🧵', type: 'material', rarity: 'common', value: 6 },
  item_37: { id: 'item_37', name: 'Tela de Yute', icon: '🧵', type: 'material', rarity: 'uncommon', value: 18 }
};

// B12: Recetas de crafting - combinaciones de materiales para crear items
const RECIPES = {
  // Herrería - Cobre
  copper_nugget_to_lamina: {
    id: 'copper_nugget_to_lamina',
    name: 'Fundir Nugget a Lámina',
    description: 'Combina 3 nuggets pequeños para crear 1 lámina pequeña',
    resultItem: 'item_23', // Lamina de Cobre Pequeña
    ingredients: [
      { itemId: 'item_20', count: 3 } // 3 Cobre Nugget Pequeño
    ],
    skillRequired: 'basic',
    minLevel: 1,
    xpReward: 20
  },
  copper_lamina_to_rod: {
    id: 'copper_lamina_to_rod',
    name: 'Forjar Varilla de Cobre',
    description: 'Combina 1 lámina pequeña para crear 1 varilla pequeña',
    resultItem: 'item_26', // Varilla de Cobre Pequeña
    ingredients: [
      { itemId: 'item_23', count: 1 } // 1 Lamina de Cobre Pequeña
    ],
    skillRequired: 'basic',
    minLevel: 1,
    xpReward: 25
  },
  // Herrería - Varillas a herramientas
  copper_rod_to_tool: {
    id: 'copper_rod_to_tool',
    name: 'Crear Herramienta Básica',
    description: 'Combina 1 varilla con una herramienta básica',
    resultItem: 'item_29', // Pico de Madera
    ingredients: [
      { itemId: 'item_26', count: 1 }, // 1 Varilla de Cobre Pequeña
      { itemId: 'item_29', count: 1 }  // 1 Pico de Madera (base)
    ],
    skillRequired: 'basic',
    minLevel: 1,
    xpReward: 30
  },
  // Woodworking - Troncos a materiales
  wood_to_planks: {
    id: 'wood_to_planks',
    name: 'Partir Troncos',
    description: 'Combina 1 tronco para obtener tablas de madera',
    resultItem: 'item_36', // Tela de Lino (usaremos como placeholder para madera)
    ingredients: [
      { itemId: 'item_33', count: 1 } // 1 Tronco Pequeño
    ],
    skillRequired: 'basic',
    minLevel: 1,
    xpReward: 15
  },
  // Tailoring - Textiles
  cloth_to_bandage: {
    id: 'cloth_to_bandage',
    name: 'Curitas de Tela',
    description: 'Combina tela para crear vendas',
    resultItem: 'item_3', // Poción de Vida (usaremos como placeholder para vendas)
    ingredients: [
      { itemId: 'item_36', count: 2 }, // 2 Tela de Lino
      { itemId: 'item_37', count: 1 } // 1 Tela de Yute
    ],
    skillRequired: 'basic',
    minLevel: 1,
    xpReward: 18
  }
};

const ITEM_LIST = Object.values(ITEMS);

const QUESTS = [
  {
    id: 'q1',
    name: 'El Despertar',
    desc: 'Elimina 3 minions esqueletos que merodean cerca del santuario.',
    goal: { type: 'kill', target: 'skeleton_minion', count: 3 },
    reward: { exp: 300, gold: 120 }
  },
  {
    id: 'q2',
    name: 'Huesos del Abismo',
    desc: 'Acaba con 2 guerreros esqueletos y reclama su yelmo de acero.',
    goal: { type: 'kill', target: 'skeleton', count: 2 },
    reward: { exp: 650, gold: 250, itemId: 'item_5' }
  },
  {
    id: 'q3',
    name: 'El Ritual del Abismo',
    desc: 'Los magos esqueletos preparan un ritual en las ruinas. Acaba con 3 y reclama su coraza.',
    goal: { type: 'kill', target: 'skeleton_mage', count: 3 },
    reward: { exp: 2500, gold: 1200, itemId: 'item_9' }
  },
  {
    id: 'q4',
    name: 'Flechas del Bosque',
    desc: 'Los arqueros esqueletos acechan en la espesura. Elimina a 4 para proteger los senderos.',
    goal: { type: 'kill', target: 'skeleton_archer', count: 4 },
    reward: { exp: 900, gold: 300, itemId: 'item_6' }
  },
  {
    id: 'q5',
    name: 'La Horda de Huesos',
    desc: 'Una horda de minions asedia las ruinas. Acaba con 6 de ellos.',
    goal: { type: 'kill', target: 'skeleton_minion', count: 6 },
    reward: { exp: 1800, gold: 600, itemId: 'item_7' }
  },
  {
    id: 'q6',
    name: 'Ecos del Abismo',
    desc: 'Reúne 3 esencias sombrías del Abismo para calmar los ecos.',
    goal: { type: 'collect', target: 'item_11', count: 3 },
    reward: { exp: 1200, gold: 400, itemId: 'item_8' }
  }
];

const QUEST_BY_ID = {};
for (const quest of QUESTS) QUEST_BY_ID[quest.id] = quest;

const MONSTER_TYPES = {
  // Mundo de esqueletos (KayKit Skeletons): unicos enemigos del juego.
  skeleton: { type: 'skeleton', name: 'Guerrero Esqueleto', hp: 220, dmg: 20, aggro: 7, speed: 6, exp: 110, level: 2, def: 10, respawnMs: 15000, stepsPerTurn: 1, moveEveryTicks: 6, attackRange: 1, model: 'skeleton' },
  skeleton_archer: { type: 'skeleton_archer', name: 'Arquero Esqueleto', hp: 180, dmg: 15, aggro: 6, speed: 5, exp: 100, level: 3, def: 6, respawnMs: 12000, stepsPerTurn: 1, moveEveryTicks: 3, attackRange: 2, model: 'skeleton_archer' },
  skeleton_mage: { type: 'skeleton_mage', name: 'Mago Esqueleto', hp: 160, dmg: 22, aggro: 9, speed: 4, exp: 120, level: 4, def: 8, respawnMs: 13000, stepsPerTurn: 1, moveEveryTicks: 4, attackRange: 3, model: 'skeleton_mage' },
  skeleton_minion: { type: 'skeleton_minion', name: 'Minion Esqueleto', hp: 100, dmg: 12, aggro: 5, speed: 3, exp: 80, level: 2, def: 4, respawnMs: 10000, stepsPerTurn: 1, moveEveryTicks: 5, attackRange: 1, model: 'skeleton_minion' }
};

const MONSTER_CONFIG = Object.values(MONSTER_TYPES).map(function (type) {
  return { type: type.type, name: type.name, hp: type.hp, dmg: type.dmg, aggro: type.aggro, speed: type.speed, exp: type.exp };
});

const MONSTER_SPAWNS = [
  // Solo esqueletos (KayKit Skeletons): patrullas repartidas por las cuatro zonas.
  { type: 'skeleton_minion', x: 6, y: 6 },
  { type: 'skeleton_minion', x: 10, y: 13 },
  { type: 'skeleton_minion', x: 4, y: 16 },
  { type: 'skeleton_minion', x: 12, y: 4 },
  { type: 'skeleton_archer', x: 18, y: 6 },
  { type: 'skeleton_archer', x: 22, y: 11 },
  { type: 'skeleton_archer', x: 26, y: 4 },
  { type: 'skeleton_archer', x: 20, y: 16 },
  { type: 'skeleton_mage', x: 24, y: 10 },
  { type: 'skeleton_mage', x: 28, y: 14 },
  { type: 'skeleton_mage', x: 24, y: 20 },
  { type: 'skeleton_mage', x: 28, y: 30 },
  { type: 'skeleton', x: 18, y: 15 },
  { type: 'skeleton', x: 21, y: 17 },
  { type: 'skeleton', x: 20, y: 22 },
  { type: 'skeleton', x: 26, y: 27 },
  { type: 'skeleton_minion', x: 19, y: 18 },
  { type: 'skeleton_minion', x: 27, y: 22 },
  { type: 'skeleton_minion', x: 24, y: 8 },
  { type: 'skeleton_minion', x: 26, y: 12 }
];

const DROP_TABLES = {
  // Botin del mundo de esqueletos (no quedan otros tipos de monstruo).
  skeleton: { gold: [12, 30], items: [{ itemId: 'item_11', weight: 40 }, { itemId: 'item_12', weight: 30 }, { itemId: 'item_5', weight: 30 }] },
  skeleton_archer: { gold: [30, 50], items: [{ itemId: 'item_10', weight: 50 }, { itemId: 'item_12', weight: 30 }, { itemId: 'item_3', weight: 20 }] },
  skeleton_mage: { gold: [35, 60], items: [{ itemId: 'item_13', weight: 40 }, { itemId: 'item_11', weight: 30 }, { itemId: 'item_3', weight: 30 }] },
  skeleton_minion: { gold: [20, 40], items: [{ itemId: 'item_10', weight: 60 }, { itemId: 'item_12', weight: 25 }, { itemId: 'item_3', weight: 15 }] }
};

const SHOP_CATALOG = [
  { itemId: 'item_3', price: 40 },
  { itemId: 'item_13', price: 45 },
  { itemId: 'item_14', price: 120 },
  { itemId: 'item_1', price: 90 },
  { itemId: 'item_2', price: 110 },
  { itemId: 'item_4', price: 260 },
  { itemId: 'item_5', price: 240 },
  { itemId: 'item_6', price: 340 },
  { itemId: 'item_10', price: 12 }
];

const SHOP_BY_ITEM = {};
for (const offer of SHOP_CATALOG) SHOP_BY_ITEM[offer.itemId] = offer;

const SHOP_STOCK = {
  item_3: 999,
  item_13: 999,
  item_14: 999,
  item_1: 99,
  item_2: 99,
  item_4: 99,
  item_5: 99,
  item_6: 99,
  item_10: 999
};

function shopStockPayload() {
  return SHOP_CATALOG.map(function (offer) {
    return { itemId: offer.itemId, price: offer.price, count: toInt(SHOP_STOCK[offer.itemId], 0) };
  });
}

// ---------------------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------------------

const grid = new GridSystem(TILE_SIZE);
for (const wall of worldMap.walls || []) grid.setWall(wall.x, wall.y, true);

const state = { users: [], characters: [] };
const charById = new Map();
const connected = new Map();
const loginFailures = new Map();
const registerAttempts = new Map();
const sessions = new Map(); // token -> { userId, exp }
const parties = new Map(); // partyId -> { id, leaderId, memberIds: [] }
let partySeq = 0;
const partyInvites = new Map(); // invitee charId -> { fromId, partyId, at }
const drops = [];

const monsters = MONSTER_SPAWNS.map(function (spawn, index) {
  const type = MONSTER_TYPES[spawn.type];
  const elite = !!(spawn.elite || type.elite);
  const multiplied = elite && !type.eliteStatsIncluded;
  const hp = multiplied ? Math.round(type.hp * 1.8) : type.hp;
  const damage = multiplied ? Math.round(type.dmg * 1.25) : type.dmg;
  const exp = multiplied ? type.exp * 2 : type.exp;
  const defense = multiplied ? Math.round(type.def * 1.25) : type.def;
  const name = elite && type.name.indexOf('Campeón') !== 0 ? 'Campeón ' + type.name : type.name;
  return {
    id: 'monster_' + (index + 1),
    name: name,
    type: type.type,
    level: type.level,
    elite: elite,
    gridX: spawn.x,
    gridY: spawn.y,
    spawnX: spawn.x,
    spawnY: spawn.y,
    hp: hp,
    maxHp: hp,
    dmg: damage,
    def: defense,
    aggroRange: type.aggro,
    speedTicks: type.moveEveryTicks || type.speed,
    stepsPerTurn: type.stepsPerTurn || 1,
    attackRange: type.attackRange || 1,
    exp: exp,
    respawnMs: type.respawnMs,
    diedAt: 0,
    respawnAt: 0,
    targetId: null,
    lastAttackAt: 0,
    lastStepAt: 0,
    moving: false,
    attackAnim: 0
  };
});

let tickTimer = null;
let saveTimer = null;
let persistTimer = null;
let shutdownTimer = null;
let dirty = false;
let shuttingDown = false;
let dropSeq = 0;
let tickCount = 0;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function getClassDef(className) {
  return typeof className === 'string' && hasOwn(CLASSES, className) ? CLASSES[className] : null;
}

function getItem(itemId) {
  return typeof itemId === 'string' && hasOwn(ITEMS, itemId) ? ITEMS[itemId] : null;
}

function getSkill(skillId) {
  return typeof skillId === 'string' && hasOwn(SKILL_BY_ID, skillId) ? SKILL_BY_ID[skillId] : null;
}

function getQuest(questId) {
  return typeof questId === 'string' && hasOwn(QUEST_BY_ID, questId) ? QUEST_BY_ID[questId] : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function expForLevel(level) {
  return Math.round(100 * Math.pow(level, 1.55));
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a.gridX - b.gridX), Math.abs(a.gridY - b.gridY));
}

function getStartPosition(className) {
  const list = Array.isArray(worldMap.startPositions) ? worldMap.startPositions : [];
  for (const entry of list) {
    if (entry && entry.class === className && Number.isInteger(entry.x) && Number.isInteger(entry.y)) {
      return { x: entry.x, y: entry.y };
    }
  }
  const classDef = getClassDef(className);
  if (classDef && classDef.start) return { x: classDef.start.x, y: classDef.start.y };
  return { x: 0, y: 0 };
}

function getConfig() {
  return {
    tickMs: TICK_MS,
    tileSize: TILE_SIZE,
    mapSize: MAP_SIZE,
    serverTime: Date.now(),
    classes: CLASSES,
    skills: SKILLS,
    items: ITEM_LIST,
    quests: QUESTS,
    monsters: MONSTER_CONFIG
  };
}

function findUser(username) {
  const key = String(username || '').toLowerCase();
  for (const user of state.users) {
    if (user.username.toLowerCase() === key) return user;
  }
  return null;
}

function getSocketCharacter(socket) {
  const characterId = socket && socket.data ? socket.data.characterId : null;
  if (!characterId) return null;
  return charById.get(characterId) || null;
}

function emitToChar(char, event, payload) {
  if (!char || !char.socketId) return;
  const socket = io.sockets.sockets.get(char.socketId);
  if (socket && socket.connected) socket.emit(event, payload);
}

function toast(socket, type, message) {
  if (!socket || !socket.connected) return;
  socket.emit('toast', { type, message });
}

function systemChat(socket, message) {
  if (!socket || !socket.connected) return;
  socket.emit('chat', { channel: 'global', from: 'Sistema', text: message, ts: Date.now(), kind: 'system' });
}

function broadcastOnline() {
  io.emit('online', { count: connected.size });
}

function monsterAt(x, y) {
  for (const monster of monsters) {
    if (monster.hp > 0 && monster.gridX === x && monster.gridY === y) return monster;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inventario y estadisticas derivadas
// ---------------------------------------------------------------------------

function addItem(char, itemId, count) {
  return addItems(char, itemId, count) > 0;
}

function canAddItem(char, itemId) {
  const item = getItem(itemId);
  if (!item) return false;
  const stackable = item.type === 'potion' || item.type === 'material';
  if (stackable) {
    const existing = char.inventory.find(function (entry) { return entry.itemId === itemId; });
    if (existing && existing.count < MAX_STACK) return true;
  }
  return char.inventory.length < MAX_INVENTORY_ENTRIES;
}

function countInventoryItem(char, itemId) {
  let total = 0;
  for (const entry of char.inventory) {
    if (entry && entry.itemId === itemId) total += toInt(entry.count, 0);
  }
  return total;
}

function inventoryCapacity(char, itemId) {
  const item = getItem(itemId);
  if (!item) return 0;
  const stackable = item.type === 'potion' || item.type === 'material';
  let capacity = 0;
  if (stackable) {
    for (const entry of char.inventory) {
      if (entry.itemId === itemId) capacity += Math.max(0, MAX_STACK - entry.count);
    }
    capacity += Math.max(0, MAX_INVENTORY_ENTRIES - char.inventory.length) * MAX_STACK;
  } else {
    capacity = Math.max(0, MAX_INVENTORY_ENTRIES - char.inventory.length);
  }
  return capacity;
}

function addItems(char, itemId, count) {
  const item = getItem(itemId);
  let remaining = Math.max(0, Math.floor(Number(count) || 0));
  if (!item || remaining <= 0) return 0;
  const original = remaining;
  const stackable = item.type === 'potion' || item.type === 'material';
  if (stackable) {
    for (const entry of char.inventory) {
      if (entry.itemId !== itemId || entry.count >= MAX_STACK) continue;
      const amount = Math.min(MAX_STACK - entry.count, remaining);
      entry.count += amount;
      remaining -= amount;
      if (remaining <= 0) return original;
    }
    while (remaining > 0 && char.inventory.length < MAX_INVENTORY_ENTRIES) {
      const amount = Math.min(MAX_STACK, remaining);
      char.inventory.push({ itemId: itemId, count: amount });
      remaining -= amount;
    }
  } else {
    while (remaining > 0 && char.inventory.length < MAX_INVENTORY_ENTRIES) {
      char.inventory.push({ itemId: itemId, count: 1 });
      remaining -= 1;
    }
  }
  return original - remaining;
}

function consumeInventoryItem(char, itemId, amount) {
  let remaining = Math.max(1, Math.floor(Number(amount) || 1));
  for (let index = char.inventory.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const entry = char.inventory[index];
    if (!entry || entry.itemId !== itemId) continue;
    const taken = Math.min(entry.count, remaining);
    entry.count -= taken;
    remaining -= taken;
    if (entry.count <= 0) char.inventory.splice(index, 1);
  }
  return remaining === 0;
}

function recomputeDerived(char) {
  const base = char.baseStats || {};
  const stats = { str: 0, dex: 0, int: 0, vit: 0, wit: 0, men: 0 };
  for (const key of STAT_KEYS) stats[key] = Math.max(0, toInt(base[key], 0));
  let weaponDamage = 0;
  let armorDefense = 0;
  for (const slot of EQUIP_SLOTS) {
    const item = getItem(char.equipment ? char.equipment[slot] : null);
    if (!item) continue;
    if (item.dmg) weaponDamage += item.dmg;
    if (item.def) armorDefense += item.def;
    if (item.stats) {
      for (const key of STAT_KEYS) {
        if (item.stats[key]) stats[key] += toInt(item.stats[key], 0);
      }
    }
  }
  char.stats = stats;
  char.dmg = Math.round(weaponDamage + stats.str * 0.6 + stats.dex * 0.25);
  char.def = Math.round(armorDefense + stats.vit * 0.5 + stats.str * 0.2);
}

function applyStarterKit(char) {
  const classDef = getClassDef(char.class) || CLASSES.DarkKnight;
  char.gold += 50;
  addItem(char, 'item_3', 3);
  // Arma inicial propia de la clase (PROTOCOL v2.3, catalogo item_15/16/17).
  char.equipment.weapon = classDef.starterWeapon || 'item_1';
  recomputeDerived(char);
}

function createCharacter(options) {
  const opts = options || {};
  const className = getClassDef(opts.class) ? opts.class : 'DarkKnight';
  const classDef = CLASSES[className];
  const start = getStartPosition(className);
  const char = {
    id: typeof opts.id === 'string' && opts.id ? opts.id : generateId('char'),
    userId: typeof opts.userId === 'string' ? opts.userId : null,
    name: typeof opts.name === 'string' && opts.name.trim() ? opts.name.trim().slice(0, 16) : 'Aventurero',
    class: className,
    level: 1,
    exp: 0,
    expNext: expForLevel(1),
    hp: classDef.hp,
    maxHp: classDef.hp,
    mp: classDef.mp,
    maxMp: classDef.mp,
    cp: classDef.cp,
    maxCp: classDef.cp,
    food: 100,
    maxFood: 100,
    gold: 0,
    gridX: start.x,
    gridY: start.y,
    baseStats: { str: classDef.stats.str, dex: classDef.stats.dex, int: classDef.stats.int, vit: classDef.stats.vit, wit: classDef.stats.wit, men: classDef.stats.men },
    stats: { str: classDef.stats.str, dex: classDef.stats.dex, int: classDef.stats.int, vit: classDef.stats.vit, wit: classDef.stats.wit, men: classDef.stats.men },
    dmg: 0,
    def: 0,
    inventory: [],
    equipment: { weapon: null, armor: null, helm: null, boots: null, ring: null },
    quests: [],
    kills: 0,
    deaths: 0,
    statPoints: 0,
    online: false,
    dead: false,
    targetId: null,
    path: [],
    moving: false,
    attackAnim: 0,
    cooldowns: {},
    buffs: {},
    lastMoveAt: 0,
    lastAcceptedMoveAt: 0,
    lastRegenAt: 0,
    lastFoodAt: 0,
    socketId: null
  };
  recomputeDerived(char);
  return char;
}

function normalizeCharacter(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const className = getClassDef(raw.class) ? raw.class : 'DarkKnight';
  const char = createCharacter({
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateId('char'),
    userId: typeof raw.userId === 'string' ? raw.userId : null,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Aventurero',
    class: className
  });
  char.level = clamp(toInt(raw.level, 1), 1, 999);
  char.expNext = expForLevel(char.level);
  char.exp = Math.max(0, toInt(raw.exp, 0));
  char.maxHp = Math.max(1, toInt(raw.maxHp, char.maxHp));
  char.maxMp = Math.max(0, toInt(raw.maxMp, char.maxMp));
  char.maxCp = Math.max(0, toInt(raw.maxCp, char.maxCp));
  char.hp = clamp(toInt(raw.hp, char.maxHp), 1, char.maxHp);
  char.mp = clamp(toInt(raw.mp, char.maxMp), 0, char.maxMp);
  char.cp = clamp(toInt(raw.cp, char.maxCp), 0, char.maxCp);
  char.food = clamp(toInt(raw.food, 100), 0, char.maxFood);
  char.gold = Math.max(0, toInt(raw.gold, 0));
  char.gridX = clamp(toInt(raw.gridX, char.gridX), 0, MAP_SIZE - 1);
  char.gridY = clamp(toInt(raw.gridY, char.gridY), 0, MAP_SIZE - 1);
  const savedStats = raw.baseStats && typeof raw.baseStats === 'object' ? raw.baseStats : raw.stats;
  if (savedStats && typeof savedStats === 'object') {
    for (const key of STAT_KEYS) char.baseStats[key] = Math.max(0, toInt(savedStats[key], char.baseStats[key]));
  }
  if (Array.isArray(raw.inventory)) {
    char.inventory = [];
    for (const entry of raw.inventory) {
      if (!entry || typeof entry.itemId !== 'string' || !getItem(entry.itemId)) continue;
      addItem(char, entry.itemId, clamp(toInt(entry.count, 1), 1, MAX_STACK));
    }
  }
  if (raw.equipment && typeof raw.equipment === 'object') {
    for (const slot of EQUIP_SLOTS) {
      const itemId = raw.equipment[slot];
      const item = getItem(itemId);
      if (item && item.type === slot) char.equipment[slot] = itemId;
    }
  }
  if (Array.isArray(raw.quests)) {
    for (const quest of raw.quests) {
      if (!quest || typeof quest.id !== 'string') continue;
      const questDef = getQuest(quest.id);
      if (!questDef) continue;
      if (char.quests.some(function (existing) { return existing.id === quest.id; })) continue;
      char.quests.push({
        id: quest.id,
        state: quest.state === 'done' ? 'done' : 'active',
        progress: clamp(toInt(quest.progress, 0), 0, questDef.goal.count)
      });
    }
  }
  char.kills = Math.max(0, toInt(raw.kills, 0));
  char.deaths = Math.max(0, toInt(raw.deaths, 0));
  char.statPoints = Math.max(0, toInt(raw.statPoints, 0));
  char.online = false;
  char.dead = raw.dead === true; // B4: la muerte se persiste; al cargar no se resucita gratis.
  char.socketId = null;
  char.path = [];
  char.cooldowns = {};
  char.buffs = {};
  char.targetId = null;
  applyCollectProgress(char);
  recomputeDerived(char);
  return char;
}

function publicQuests(char) {
  return char.quests.map(function (quest) {
    return { id: quest.id, state: quest.state, progress: quest.progress };
  });
}

function publicChar(char) {
  return {
    id: char.id,
    name: char.name,
    class: char.class,
    level: char.level,
    exp: char.exp,
    expNext: char.expNext,
    hp: char.hp,
    maxHp: char.maxHp,
    mp: char.mp,
    maxMp: char.maxMp,
    cp: char.cp,
    maxCp: char.maxCp,
    food: Math.round(char.food),
    maxFood: char.maxFood,
    gold: char.gold,
    gridX: char.gridX,
    gridY: char.gridY,
    stats: { str: char.stats.str, dex: char.stats.dex, int: char.stats.int, vit: char.stats.vit, wit: char.stats.wit, men: char.stats.men },
    dmg: char.dmg,
    def: char.def,
    statPoints: char.statPoints || 0,
    inventory: char.inventory.map(function (entry) { return { itemId: entry.itemId, count: entry.count }; }),
    equipment: {
      weapon: char.equipment.weapon || null,
      armor: char.equipment.armor || null,
      helm: char.equipment.helm || null,
      boots: char.equipment.boots || null,
      ring: char.equipment.ring || null
    },
    quests: publicQuests(char),
    kills: char.kills,
    deaths: char.deaths,
    online: !!char.online
  };
}

function playerPayload(char) {
  return {
    id: char.id,
    name: char.name,
    class: char.class,
    level: char.level,
    gridX: char.gridX,
    gridY: char.gridY,
    hp: char.hp,
    maxHp: char.maxHp,
    mp: char.mp,
    maxMp: char.maxMp,
    cp: char.cp,
    maxCp: char.maxCp,
    food: Math.round(char.food),
    dead: !!char.dead,
    moving: !!char.moving,
    attackAnim: char.attackAnim > 0 ? char.attackAnim : 0,
    // Item equipado en la mano (los demas clientes dibujan el arma visible).
    weapon: char.equipment && char.equipment.weapon ? char.equipment.weapon : null,
    // Yelmo equipado (solo visual para el resto de clientes; PROTOCOL v2.3).
    helm: char.equipment && char.equipment.helm ? char.equipment.helm : null
  };
}

function monsterPayload(monster) {
  return {
    id: monster.id,
    name: monster.name,
    type: monster.type,
    level: monster.level,
    gridX: monster.gridX,
    gridY: monster.gridY,
    hp: monster.hp,
    maxHp: monster.maxHp,
    moving: !!monster.moving,
    attackAnim: monster.attackAnim > 0 ? monster.attackAnim : 0,
    targetId: monster.targetId || null,
    elite: !!monster.elite
  };
}

function dropPayload(drop) {
  return { id: drop.id, itemId: drop.itemId, gridX: drop.gridX, gridY: drop.gridY, gold: drop.gold };
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Instancia unica por DATA_DIR (server.lock)
// ---------------------------------------------------------------------------

function readLockPid() {
  try {
    const raw = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    return raw && Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : null;
  } catch (err) {
    return null; // JSON invalido o archivo ilegible: se considera obsoleto.
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // si no lanza, el proceso existe
    return true;
  } catch (err) {
    return false;
  }
}

function writeLockFile() {
  try {
    ensureDataDir();
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, port: PORT, startedAt: Date.now() }), 'utf8');
  } catch (err) {
    console.error('[server] No se pudo escribir server.lock: ' + (err && err.message ? err.message : 'error'));
  }
}

function removeLockFile() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch (err) {
    console.error('[server] No se pudo borrar server.lock: ' + (err && err.message ? err.message : 'error'));
  }
}

function acquireInstanceLock() {
  ensureDataDir();
  if (fs.existsSync(LOCK_FILE)) {
    const pid = readLockPid();
    if (isProcessAlive(pid)) {
      console.error('[server] Ya hay una instancia de Aethelgard usando dir=' + DATA_DIR + ' (pid ' + pid + '). Abortando para no corromper state.json.');
      process.exit(1);
    }
    try {
      fs.unlinkSync(LOCK_FILE); // lock obsoleto: el PID ya no existe
    } catch (err) {
      console.error('[server] No se pudo borrar el server.lock obsoleto: ' + (err && err.message ? err.message : 'error'));
    }
  }
  writeLockFile();
}

function charForSave(char) {
  return {
    id: char.id,
    userId: char.userId,
    name: char.name,
    class: char.class,
    level: char.level,
    exp: char.exp,
    expNext: char.expNext,
    hp: char.hp,
    maxHp: char.maxHp,
    mp: char.mp,
    maxMp: char.maxMp,
    cp: char.cp,
    maxCp: char.maxCp,
    food: Math.round(char.food),
    maxFood: char.maxFood,
    gold: char.gold,
    gridX: char.gridX,
    gridY: char.gridY,
    baseStats: { str: char.baseStats.str, dex: char.baseStats.dex, int: char.baseStats.int, vit: char.baseStats.vit, wit: char.baseStats.wit, men: char.baseStats.men },
    inventory: char.inventory.map(function (entry) { return { itemId: entry.itemId, count: entry.count }; }),
    equipment: {
      weapon: char.equipment.weapon || null,
      armor: char.equipment.armor || null,
      helm: char.equipment.helm || null,
      boots: char.equipment.boots || null,
      ring: char.equipment.ring || null
    },
    quests: publicQuests(char),
    kills: char.kills,
    deaths: char.deaths,
    dead: !!char.dead, // B4: persistir la muerte para que el reinicio no regale la resurreccion.
    statPoints: char.statPoints || 0
  };
}

function serializeState() {
  return {
    version: 2,
    savedAt: Date.now(),
    users: state.users.map(function (user) {
      return { id: user.id, username: user.username, passwordHash: user.passwordHash, characterId: user.characterId, createdAt: user.createdAt };
    }),
    characters: state.characters.map(charForSave)
  };
}

function saveStateNow() {
  try {
    ensureDataDir();
    const target = STATE_FILE;
    const temp = STATE_FILE + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(serializeState(), null, 2), 'utf8');
    fs.renameSync(temp, target);
    dirty = false;
  } catch (err) {
    console.error('[state] No se pudo guardar state.json: ' + (err && err.message ? err.message : 'error'));
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    if (dirty) saveStateNow();
  }, SAVE_DEBOUNCE_MS);
}

async function seedDemoAccounts() {
  const demoAccounts = [
    { username: 'demo', password: 'demo1234', className: 'DarkKnight' },
    { username: 'kundun', password: 'kundun1234', className: 'ArcaneSorcerer' }
  ];
  for (const demo of demoAccounts) {
    const passwordHash = await bcrypt.hash(demo.password, 10);
    addUserWithCharacter(demo.username, passwordHash, demo.className, true);
  }
}

function addUserWithCharacter(username, passwordHash, className, withStarterKit) {
  const user = { id: generateId('user'), username: username, passwordHash: passwordHash, characterId: null, createdAt: Date.now() };
  const char = createCharacter({ userId: user.id, name: username, class: className });
  if (withStarterKit) applyStarterKit(char);
  user.characterId = char.id;
  state.users.push(user);
  state.characters.push(char);
  charById.set(char.id, char);
  return { user: user, char: char };
}

async function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    // B1: los demos solo se siembran cuando no existe state.json.
    await seedDemoAccounts();
    saveStateNow();
    console.log('[state] Datos demo creados en ' + STATE_FILE);
  } else {
    let raw = null;
    let invalidReason = '';
    try {
      raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (err) {
      invalidReason = 'JSON invalido (' + (err && err.message ? err.message : 'error') + ')';
    }
    if (!invalidReason && (!raw || !Array.isArray(raw.users) || !Array.isArray(raw.characters))) {
      invalidReason = 'estructura invalida (users/characters no son arrays)';
    }
    if (!invalidReason) {
      const users = raw.users
        .filter(function (user) { return user && typeof user.username === 'string' && typeof user.passwordHash === 'string'; })
        .map(function (user) {
          return {
            id: typeof user.id === 'string' && user.id ? user.id : generateId('user'),
            username: user.username,
            passwordHash: user.passwordHash,
            characterId: typeof user.characterId === 'string' ? user.characterId : null,
            createdAt: toInt(user.createdAt, Date.now())
          };
        });
      const characters = raw.characters.map(normalizeCharacter).filter(Boolean);
      if (users.length === 0 || characters.length === 0) {
        invalidReason = 'sin usuarios o personajes cargables';
      } else {
        state.users = users;
        state.characters = characters;
        for (const user of state.users) {
          if (user.characterId) continue;
          const linked = state.characters.find(function (char) { return char.userId === user.id; });
          if (linked) user.characterId = linked.id;
        }
      }
    }
    if (invalidReason) {
      // B1: conservar el archivo danado y abortar; nunca sobrescribirlo con demos.
      const backupFile = path.join(DATA_DIR, 'state.corrupt-' + Date.now() + '.json');
      try {
        fs.renameSync(STATE_FILE, backupFile);
        console.error('[state] state.json ' + invalidReason + '. Se ha movido a ' + backupFile + '. Arranque abortado para no perder datos.');
      } catch (renameErr) {
        console.error('[state] state.json ' + invalidReason + ' y no se pudo mover (' + (renameErr && renameErr.message ? renameErr.message : 'error') + '). Arranque abortado para no sobrescribir.');
      }
      process.exit(1);
    }
  }
  charById.clear();
  for (const char of state.characters) charById.set(char.id, char);
  console.log('[state] Usuarios cargados: ' + state.users.length + ' | Personajes: ' + state.characters.length);
}

// ---------------------------------------------------------------------------
// Progresion, botin y quests
// ---------------------------------------------------------------------------

function publicQuestList(char) {
  return publicQuests(char);
}

function computeCollectProgress(char, quest) {
  if (!quest || !quest.goal || quest.goal.type !== 'collect') return 0;
  return Math.min(quest.goal.count, countInventoryItem(char, quest.goal.target));
}

function applyCollectProgress(char) {
  let changed = false;
  for (const entry of char.quests) {
    if (entry.state !== 'active') continue;
    const quest = getQuest(entry.id);
    if (!quest || quest.goal.type !== 'collect') continue;
    const progress = computeCollectProgress(char, quest);
    if (entry.progress !== progress) {
      entry.progress = progress;
      changed = true;
    }
  }
  return changed;
}

function syncCollectQuests(char) {
  const changed = applyCollectProgress(char);
  if (changed) emitToChar(char, 'questUpdate', { quests: publicQuestList(char) });
  return changed;
}

function updateQuestProgress(char, goalType, target, amount) {
  let changed = false;
  for (const entry of char.quests) {
    if (entry.state !== 'active') continue;
    const quest = getQuest(entry.id);
    if (!quest || quest.goal.type !== goalType) continue;
    if (String(quest.goal.target) !== String(target)) continue;
    const before = entry.progress;
    entry.progress = Math.min(quest.goal.count, entry.progress + amount);
    if (entry.progress !== before) changed = true;
  }
  if (changed) emitToChar(char, 'questUpdate', { quests: publicQuestList(char) });
}

function grantExperience(char) {
  const classDef = getClassDef(char.class) || CLASSES.DarkKnight;
  const growth = classDef.growth;
  let gained = 0;
  while (char.expNext > 0 && char.exp >= char.expNext && gained < 100) {
    char.exp -= char.expNext;
    char.level += 1;
    gained += 1;
    for (const key of STAT_KEYS) char.baseStats[key] = (char.baseStats[key] || 0) + (growth[key] || 0);
    char.maxHp += growth.hp || 0;
    char.maxMp += growth.mp || 0;
    char.maxCp += growth.cp || 0;
    char.statPoints = (char.statPoints || 0) + 3;
    char.expNext = expForLevel(char.level);
  }
  if (gained > 0) {
    char.hp = char.maxHp;
    char.mp = char.maxMp;
    char.cp = char.maxCp;
    recomputeDerived(char);
    emitToChar(char, 'levelUp', {
      level: char.level,
      maxHp: char.maxHp,
      maxMp: char.maxMp,
      stats: { str: char.stats.str, dex: char.stats.dex, int: char.stats.int, vit: char.stats.vit, wit: char.stats.wit, men: char.stats.men }
    });
    emitToChar(char, 'toast', { type: 'success', message: 'Has subido al nivel ' + char.level + '.' });
    scheduleSave();
  }
  emitToChar(char, 'charUpdate', { char: publicChar(char) });
  return gained;
}

function pickWeighted(entries) {
  let total = 0;
  for (const entry of entries) total += entry.weight;
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.itemId;
  }
  return entries.length ? entries[entries.length - 1].itemId : null;
}

function spawnDrops(monster) {
  const table = DROP_TABLES[monster.type];
  if (!table) return;
  const itemId = pickWeighted(table.items);
  if (!itemId) return;
  const goldMultiplier = monster.elite ? 2 : 1;
  drops.push({
    id: 'drop_' + (++dropSeq),
    itemId: itemId,
    gridX: monster.gridX,
    gridY: monster.gridY,
    gold: randomInt(table.gold[0], table.gold[1]) * goldMultiplier,
    expiresAt: Date.now() + DROP_TTL_MS
  });
}

function killMonster(monster, char) {
  const now = Date.now();
  monster.hp = 0;
  monster.diedAt = now;
  monster.respawnAt = now + monster.respawnMs;
  monster.targetId = null;
  monster.moving = false;
  monster.attackAnim = 0;
  spawnDrops(monster);
  for (const player of connected.values()) {
    if (player.targetId === monster.id) player.targetId = null;
  }
  if (!char) return;
  char.kills += 1;
  char.exp += monster.exp;
  updateQuestProgress(char, 'kill', monster.type, 1);
  grantExperience(char);
  scheduleSave();
}

function handlePlayerDeath(char, killerName) {
  char.dead = true;
  char.hp = 0;
  char.path = [];
  char.targetId = null;
  char.moving = false;
  char.cooldowns = {};
  char.buffs = {};
  emitToChar(char, 'death', { killerName: killerName || 'Desconocido' });
  io.emit('chat', { channel: 'global', from: 'Sistema', text: char.name + ' ha caido en combate.', ts: Date.now(), kind: 'system' });
  scheduleSave();
}

// ---------------------------------------------------------------------------
// Combate
// ---------------------------------------------------------------------------

function computePlayerDamage(char, monster, skill) {
  const stats = char.stats;
  let base = 0;
  if (skill.element === 'physical') {
    base = skill.power + char.dmg * 0.7 + stats.str * 0.4;
    if (char.class === 'ElfMarksman') base += stats.dex * 0.35;
  } else {
    base = skill.power + stats.int * 1.1 + char.dmg * 0.25;
    if (skill.element === 'holy') base += stats.men * 0.35;
  }
  const variance = 0.9 + Math.random() * 0.2;
  const critChance = Math.min(0.35, 0.05 + stats.dex * 0.002);
  const crit = Math.random() < critChance;
  const armor = Math.max(0, monster.def || 0);
  let damage = base * variance * (crit ? 1.6 : 1);
  damage = damage * (100 / (100 + armor * 4));
  return { damage: Math.max(1, Math.round(damage)), crit: crit };
}

function canCast(char, skill, socket) {
  if (char.dead || char.hp <= 0) {
    toast(socket, 'error', 'No puedes usar habilidades estando muerto.');
    return false;
  }
  const readyAt = char.cooldowns[skill.id] || 0;
  if (Date.now() < readyAt) {
    toast(socket, 'warn', skill.name + ' todavia esta en recarga.');
    return false;
  }
  if (char.mp < skill.mp) {
    toast(socket, 'error', 'No tienes mana suficiente.');
    return false;
  }
  return true;
}

function applyCastCost(char, skill) {
  char.mp = Math.max(0, char.mp - skill.mp);
  if (skill.cd > 0) char.cooldowns[skill.id] = Date.now() + skill.cd;
  char.attackAnim = Math.max(char.attackAnim, 3);
  dirty = true; // el combate en curso tambien se persiste (autosave cada 30 s)
}

// B6: dano en area simple. whirlwind golpea alrededor del jugador y meteor alrededor
// del objetivo; el coste de mana y el cooldown se aplican una sola vez por casteo.
function castDamageSkill(char, socket, monster, skill) {
  if (!canCast(char, skill, socket)) return false;
  if (chebyshev(char, monster) > skill.range) {
    toast(socket, 'warn', 'El objetivo esta fuera de alcance.');
    return false;
  }
  applyCastCost(char, skill);
  const targets = [];
  if (skill.aoe) {
    const center = skill.id === 'whirlwind'
      ? { gridX: char.gridX, gridY: char.gridY }
      : { gridX: monster.gridX, gridY: monster.gridY };
    const radius = 3;
    for (const candidate of monsters) {
      if (candidate.hp <= 0) continue;
      if (chebyshev(candidate, center) > radius) continue;
      targets.push(candidate);
    }
    if (targets.indexOf(monster) === -1) targets.push(monster);
  } else {
    targets.push(monster);
  }
  for (const target of targets) {
    const result = computePlayerDamage(char, target, skill);
    target.hp = Math.max(0, target.hp - result.damage);
    target.attackAnim = 3;
    if (!target.targetId && char.hp > 0) target.targetId = char.id;
    const killed = target.hp <= 0;
    io.emit('combat', {
      attackerId: char.id,
      attackerName: char.name,
      targetId: target.id,
      targetName: target.name,
      damage: result.damage,
      crit: result.crit,
      element: skill.element,
      skillId: skill.id,
      targetHp: target.hp,
      targetMaxHp: target.maxHp,
      killed: killed
    });
    io.emit('combatResult', { attackerName: char.name, targetName: target.name, damage: result.damage, targetHp: target.hp });
    if (killed) killMonster(target, char);
  }
  emitToChar(char, 'charUpdate', { char: publicChar(char) });
  return true;
}

function useHealSkill(char, socket, skill) {
  if (!canCast(char, skill, socket)) return false;
  if (char.hp >= char.maxHp) {
    toast(socket, 'info', 'Tu salud ya esta al maximo.');
    return false;
  }
  applyCastCost(char, skill);
  const healed = Math.min(char.maxHp - char.hp, Math.round(char.maxHp * 0.25));
  char.hp += healed;
  emitToChar(char, 'charUpdate', { char: publicChar(char) });
  toast(socket, 'success', 'Has recuperado ' + healed + ' de salud.');
  return true;
}

function useBuffSkill(char, socket, skill) {
  if (!canCast(char, skill, socket)) return false;
  const now = Date.now();
  if (skill.id === 'holyShield') {
    applyCastCost(char, skill);
    char.buffs.holyShieldUntil = now + 12000;
    emitToChar(char, 'charUpdate', { char: publicChar(char) });
    // B7: sincronizar el buff con la UI (id 'shield' es el que usa el cliente al castearlo).
    emitToChar(char, 'buff', { buff: { id: 'shield', name: 'Escudo', icon: skill.icon, dur: 12000 } });
    toast(socket, 'success', 'Escudo Sagrado activo: reduciras el dano recibido.');
    return true;
  }
  if (skill.id === 'sprint') {
    applyCastCost(char, skill);
    char.buffs.sprintUntil = now + 9000;
    emitToChar(char, 'charUpdate', { char: publicChar(char) });
    // B7: id 'sprint' para que el cliente refresque el buff que ya pinto al castear.
    emitToChar(char, 'buff', { buff: { id: 'sprint', name: 'Impulso', icon: skill.icon, dur: 9000 } });
    toast(socket, 'success', 'Impulso activo: te moveras mas rapido.');
    return true;
  }
  toast(socket, 'error', 'Esa habilidad no tiene efecto.');
  return false;
}

function useBlinkSkill(char, socket, skill) {
  if (!canCast(char, skill, socket)) return false;
  applyCastCost(char, skill);
  const start = getStartPosition(char.class);
  char.gridX = start.x;
  char.gridY = start.y;
  char.path = [];
  char.targetId = null;
  char.moving = false;
  emitToChar(char, 'charUpdate', { char: publicChar(char) });
  // B7: aviso visual del blink (el cliente escucha 'teleportFx').
  emitToChar(char, 'teleportFx', { gridX: char.gridX, gridY: char.gridY });
  toast(socket, 'success', 'Te has teletransportado al santuario de tu clase.');
  return true;
}

function monsterAttack(monster, char) {
  const crit = Math.random() < 0.08;
  let raw = monster.dmg * (0.9 + Math.random() * 0.2);
  if (crit) raw *= 1.5;
  const armor = Math.max(0, char.def || 0);
  let damage = raw * (1 - armor / (armor + 120));
  if (char.buffs.holyShieldUntil && char.buffs.holyShieldUntil > Date.now()) damage *= 0.6;
  damage = Math.max(1, Math.round(damage));
  char.hp = Math.max(0, char.hp - damage);
  dirty = true; // HP/estado de combate se persisten en el proximo autosave
  const killed = char.hp <= 0;
  io.emit('combat', {
    attackerId: monster.id,
    attackerName: monster.name,
    targetId: char.id,
    targetName: char.name,
    damage: damage,
    crit: crit,
    element: 'physical',
    skillId: 'basic',
    targetHp: char.hp,
    targetMaxHp: char.maxHp,
    killed: killed
  });
  io.emit('combatResult', { attackerName: monster.name, targetName: char.name, damage: damage, targetHp: char.hp });
  if (killed) {
    monster.targetId = null;
    handlePlayerDeath(char, monster.name);
  }
}

// ---------------------------------------------------------------------------
// Movimiento y busqueda de caminos
// ---------------------------------------------------------------------------

function applyPlayerStep(char, dx, dy) {
  if (char.dead) return false;
  const result = grid.tryMove(char, dx, dy);
  if (!result.allowed) return false;
  if (monsterAt(result.newX, result.newY)) return false;
  char.gridX = result.newX;
  char.gridY = result.newY;
  char.moving = true;
  char.lastMoveAt = Date.now();
  char.lastAcceptedMoveAt = char.lastMoveAt; // B2: marca el ultimo paso aceptado (throttle de move).
  dirty = true; // posicion persistente aunque no haya otra accion
  return true;
}

function findPath(startX, startY, targetX, targetY) {
  if (startX === targetX && startY === targetY) return [];
  const total = MAP_SIZE * MAP_SIZE;
  const visited = new Uint8Array(total);
  const previous = new Int32Array(total);
  previous.fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const startIndex = startY * MAP_SIZE + startX;
  const goalIndex = targetY * MAP_SIZE + targetX;
  visited[startIndex] = 1;
  queue[tail] = startIndex;
  tail += 1;
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let found = false;
  while (head < tail) {
    const index = queue[head];
    head += 1;
    if (index === goalIndex) {
      found = true;
      break;
    }
    const currentX = index % MAP_SIZE;
    const currentY = (index - currentX) / MAP_SIZE;
    for (const direction of directions) {
      const nextX = currentX + direction[0];
      const nextY = currentY + direction[1];
      if (nextX < 0 || nextY < 0 || nextX >= MAP_SIZE || nextY >= MAP_SIZE) continue;
      if (grid.isWall(nextX, nextY)) continue;
      const nextIndex = nextY * MAP_SIZE + nextX;
      if (visited[nextIndex]) continue;
      if (nextIndex !== goalIndex && monsterAt(nextX, nextY)) continue;
      visited[nextIndex] = 1;
      previous[nextIndex] = index;
      if (tail >= total) break;
      queue[tail] = nextIndex;
      tail += 1;
    }
  }
  if (!found) return null;
  const path = [];
  let cursor = goalIndex;
  while (cursor !== startIndex && cursor >= 0) {
    const cursorX = cursor % MAP_SIZE;
    const cursorY = (cursor - cursorX) / MAP_SIZE;
    path.push({ x: cursorX, y: cursorY });
    cursor = previous[cursor];
  }
  path.reverse();
  return path;
}

function advancePath(char) {
  const steps = char.buffs.sprintUntil && char.buffs.sprintUntil > Date.now() ? 2 : 1;
  for (let step = 0; step < steps; step += 1) {
    if (!char.path.length) return;
    const next = char.path[0];
    if (!next || grid.isWall(next.x, next.y) || monsterAt(next.x, next.y)) {
      char.path = [];
      return;
    }
    const dx = next.x - char.gridX;
    const dy = next.y - char.gridY;
    if (Math.abs(dx) + Math.abs(dy) !== 1) {
      char.path = [];
      return;
    }
    char.path.shift();
    char.gridX = next.x;
    char.gridY = next.y;
    char.moving = true;
    char.lastMoveAt = Date.now();
    char.lastAcceptedMoveAt = char.lastMoveAt; // B2: el path tambien cuenta como movimiento aceptado.
    dirty = true;
  }
}

// ---------------------------------------------------------------------------
// IA de monstruos y tick de mundo
// ---------------------------------------------------------------------------

function monsterCanStep(monster, dx, dy) {
  const nextX = monster.gridX + dx;
  const nextY = monster.gridY + dy;
  if (nextX < 0 || nextY < 0 || nextX >= MAP_SIZE || nextY >= MAP_SIZE) return false;
  if (grid.isWall(nextX, nextY)) return false;
  for (const other of monsters) {
    if (other !== monster && other.hp > 0 && other.gridX === nextX && other.gridY === nextY) return false;
  }
  for (const player of connected.values()) {
    if (!player.dead && player.gridX === nextX && player.gridY === nextY) return false;
  }
  return true;
}

function stepMonsterToward(monster, destination) {
  const deltaX = destination.gridX - monster.gridX;
  const deltaY = destination.gridY - monster.gridY;
  const stepX = Math.sign(deltaX);
  const stepY = Math.sign(deltaY);
  const horizontalFirst = Math.abs(deltaX) >= Math.abs(deltaY);
  const attempts = horizontalFirst ? [[stepX, 0], [0, stepY]] : [[0, stepY], [stepX, 0]];
  for (const attempt of attempts) {
    if (attempt[0] === 0 && attempt[1] === 0) continue;
    if (!monsterCanStep(monster, attempt[0], attempt[1])) continue;
    monster.gridX += attempt[0];
    monster.gridY += attempt[1];
    monster.moving = true;
    return true;
  }
  return false;
}

function updateMonster(monster, now) {
  let target = monster.targetId ? connected.get(monster.targetId) || null : null;
  if (target && (target.dead || target.hp <= 0)) {
    monster.targetId = null;
    target = null;
  }
  const fromSpawn = chebyshev({ gridX: monster.gridX, gridY: monster.gridY }, { gridX: monster.spawnX, gridY: monster.spawnY });
  if (target) {
    const targetFromSpawn = chebyshev(target, { gridX: monster.spawnX, gridY: monster.spawnY });
    const distanceToTarget = chebyshev(monster, target);
    if (distanceToTarget > monster.aggroRange + 6 || targetFromSpawn > MONSTER_LEASH_RANGE || fromSpawn > MONSTER_LEASH_RANGE) {
      monster.targetId = null;
      target = null;
    }
  }
  if (!target) {
    let best = null;
    let bestDistance = Infinity;
    for (const player of connected.values()) {
      if (player.dead || player.hp <= 0) continue;
      const playerFromSpawn = chebyshev(player, { gridX: monster.spawnX, gridY: monster.spawnY });
      if (playerFromSpawn > MONSTER_LEASH_RANGE) continue;
      const distance = chebyshev(monster, player);
      if (distance > monster.aggroRange) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = player;
      }
    }
    if (best) {
      target = best;
      monster.targetId = best.id;
    }
  }
  if (target) {
    const distance = chebyshev(monster, target);
    const attackRange = monster.attackRange || 1;
    if (distance <= attackRange) {
      if (now - monster.lastAttackAt >= MONSTER_ATTACK_CD_MS) {
        monster.lastAttackAt = now;
        monster.attackAnim = 3;
        monsterAttack(monster, target);
      }
      return;
    }
    if (now - monster.lastStepAt >= monster.speedTicks * TICK_MS) {
      monster.lastStepAt = now;
      const steps = monster.stepsPerTurn || 1;
      for (let step = 0; step < steps; step += 1) {
        if (chebyshev(monster, target) <= attackRange) break;
        if (!stepMonsterToward(monster, { gridX: target.gridX, gridY: target.gridY })) break;
      }
    }
    return;
  }
  if (fromSpawn > 0 && now - monster.lastStepAt >= monster.speedTicks * TICK_MS) {
    monster.lastStepAt = now;
    const steps = monster.stepsPerTurn || 1;
    for (let step = 0; step < steps; step += 1) {
      if (!stepMonsterToward(monster, { gridX: monster.spawnX, gridY: monster.spawnY })) break;
    }
  }
}

function regeneratePlayers(now) {
  for (const char of connected.values()) {
    if (char.dead || char.hp <= 0) continue;
    if (now - char.lastRegenAt >= 900) {
      char.lastRegenAt = now;
      if (char.food >= 10) {
        char.hp = Math.min(char.maxHp, char.hp + Math.max(1, Math.round(char.maxHp * 0.02)));
        char.mp = Math.min(char.maxMp, char.mp + Math.max(1, Math.round(char.maxMp * 0.03)));
        char.cp = Math.min(char.maxCp, char.cp + Math.max(1, Math.round(char.maxCp * 0.05)));
        dirty = true;
      }
    }
    if (now - char.lastFoodAt >= 9000) {
      char.lastFoodAt = now;
      const previousFood = char.food;
      char.food = Math.max(0, char.food - 1);
      dirty = true;
      if (previousFood >= 10 && char.food < 10) {
        emitToChar(char, 'toast', { type: 'warn', message: 'Tu comida escasea: la regeneracion se ha detenido.' });
      }
    }
  }
}

function worldTick() {
  tickCount += 1;
  const now = Date.now();

  // B1: marcar dirty cada intervalo para garantizar persistencia de combate/estado
  if (now - lastDirtyCheck >= DIRTY_INTERVAL_MS) {
    lastDirtyCheck = now;
    dirty = true; // forzamos save en el proximo ciclo
  }

  if (tickCount % 120 === 0) {
    purgeStaleRateLimits(); // B15: limpieza periodica de rate limits.
    purgeSessions(); // A1: limpieza de sesiones caducadas.
  }

  for (const monster of monsters) {
    if (monster.hp <= 0 && monster.respawnAt > 0 && now >= monster.respawnAt) {
      // B11: si la celda de spawn esta ocupada no reaparece todavia; se reintenta al siguiente tick.
      let occupied = false;
      for (const other of monsters) {
        if (other !== monster && other.hp > 0 && other.gridX === monster.spawnX && other.gridY === monster.spawnY) {
          occupied = true;
          break;
        }
      }
      if (!occupied) {
        for (const player of connected.values()) {
          if (!player.dead && player.gridX === monster.spawnX && player.gridY === monster.spawnY) {
            occupied = true;
            break;
          }
        }
      }
      if (occupied) continue;
      monster.hp = monster.maxHp;
      monster.gridX = monster.spawnX;
      monster.gridY = monster.spawnY;
      monster.targetId = null;
      monster.diedAt = 0;
      monster.respawnAt = 0;
      monster.lastAttackAt = 0;
      monster.lastStepAt = 0;
      monster.moving = false;
      monster.attackAnim = 0;
    }
  }

  for (const char of connected.values()) {
    if (!char.dead && char.path.length) advancePath(char);
  }

  for (const monster of monsters) {
    if (monster.hp > 0) updateMonster(monster, now);
  }

  regeneratePlayers(now);

  for (let index = drops.length - 1; index >= 0; index -= 1) {
    if (drops[index].expiresAt <= now) drops.splice(index, 1);
  }

  const players = [];
  for (const char of connected.values()) players.push(playerPayload(char));
  const aliveMonsters = [];
  for (const monster of monsters) {
    if (monster.hp > 0) aliveMonsters.push(monsterPayload(monster));
  }
  const worldDrops = drops.map(dropPayload);
  // B25: solo los sockets que hicieron join entran en 'world-room'.
  io.to('world-room').emit('world', { t: now, players: players, monsters: aliveMonsters, drops: worldDrops });
  io.to('world-room').emit('updateWorld', { players: players, monsters: aliveMonsters });

  for (const char of connected.values()) {
    char.moving = false;
    if (char.attackAnim > 0) char.attackAnim -= 1;
  }
  for (const monster of monsters) {
    monster.moving = false;
    if (monster.attackAnim > 0) monster.attackAnim -= 1;
  }
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

const USERNAME_PATTERN = /^[A-Za-z0-9_ÁÉÍÓÚáéíóúñÑ]{3,16}$/;
// Nombres reservados para evitar suplantacion en el chat (PROTOCOL v2.3).
const RESERVED_NAMES = new Set(['sistema', 'system', 'admin', 'administrador', 'gm', 'moderador', 'staff', 'soporte', 'servidor', 'server', 'aethelgard']);

function validateRegistration(username, password, className) {
  if (!USERNAME_PATTERN.test(username)) return 'El usuario debe tener entre 3 y 16 caracteres alfanumericos.';
  if (RESERVED_NAMES.has(username.toLowerCase())) return 'Ese nombre esta reservado.';
  if (typeof password !== 'string' || password.length < 4 || password.length > 64) return 'La contrasena debe tener entre 4 y 64 caracteres.';
  if (!getClassDef(className)) return 'Clase invalida.';
  return null;
}

function isLoginBlocked(ip) {
  const entry = loginFailures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.delete(ip);
    return false;
  }
  return entry.count >= MAX_LOGIN_FAILURES;
}

function registerLoginFailure(ip) {
  const now = Date.now();
  const entry = loginFailures.get(ip);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.set(ip, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

function clearLoginFailures(ip) {
  loginFailures.delete(ip);
}

// B3: rate limit de registro (5 POST /api/register por IP y minuto).
function isRegisterBlocked(ip) {
  const entry = registerAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > REGISTER_WINDOW_MS) {
    registerAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_REGISTER_ATTEMPTS;
}

function registerRegisterAttempt(ip) {
  const now = Date.now();
  const entry = registerAttempts.get(ip);
  if (!entry || now - entry.firstAt > REGISTER_WINDOW_MS) {
    registerAttempts.set(ip, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

// B15: purga periodica de los maps de rate limit (llamada desde worldTick cada ~120 ticks).
function purgeStaleRateLimits() {
  const now = Date.now();
  for (const ip of Array.from(loginFailures.keys())) {
    const entry = loginFailures.get(ip);
    if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) loginFailures.delete(ip);
  }
  for (const ip of Array.from(registerAttempts.keys())) {
    const entry = registerAttempts.get(ip);
    if (!entry || now - entry.firstAt > REGISTER_WINDOW_MS) registerAttempts.delete(ip);
  }
}

// ---------------------------------------------------------------------------
// Sesiones (token en memoria, PROTOCOL v2.3)
// ---------------------------------------------------------------------------

function issueSession(userId) {
  const token = crypto.randomUUID();
  sessions.set(token, { userId: userId, exp: Date.now() + SESSION_TTL_MS });
  return token;
}

function validateSession(token, userId) {
  if (typeof token !== 'string' || !token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.exp <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return session.userId === userId;
}

function purgeSessions() {
  const now = Date.now();
  for (const token of Array.from(sessions.keys())) {
    const session = sessions.get(token);
    if (!session || session.exp <= now) sessions.delete(token);
  }
}

app.get('/api/health', function (req, res) {
  res.json({
    ok: true,
    uptime: Math.floor(process.uptime()),
    players: connected.size,
    monsters: monsters.filter(function (monster) { return monster.hp > 0; }).length,
    version: VERSION
  });
});

app.get('/api/world', function (req, res) {
  res.json({ config: getConfig() });
});

app.post('/api/register', async function (req, res) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'desconocida';
  try {
    if (isRegisterBlocked(ip)) {
      return res.status(429).json({ message: 'Demasiados registros. Intentalo de nuevo en un minuto.' });
    }
    registerRegisterAttempt(ip);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const className = body.class === undefined || body.class === null ? 'DarkKnight' : body.class;
    const validationError = validateRegistration(username, password, className);
    if (validationError) return res.status(400).json({ message: validationError });
    if (findUser(username)) return res.status(400).json({ message: 'Ese nombre de usuario ya existe.' });
    const passwordHash = await bcrypt.hash(password, 10);
    if (findUser(username)) return res.status(400).json({ message: 'Ese nombre de usuario ya existe.' });
    const created = addUserWithCharacter(username, passwordHash, className, true);
    const token = issueSession(created.user.id); // A1: token de sesion (no se loguea).
    scheduleSave();
    console.log('[api] Nuevo registro: ' + username);
    return res.status(201).json({ userId: created.user.id, characterId: created.char.id, char: publicChar(created.char), token });
  } catch (err) {
    console.error('[api/register] ' + (err && err.message ? err.message : 'error'));
    return res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.post('/api/login', async function (req, res) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'desconocida';
  try {
    if (isLoginBlocked(ip)) {
      return res.status(429).json({ message: 'Demasiados intentos fallidos. Intentalo de nuevo en un minuto.' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = findUser(username);
    // B16: comparar siempre (hash dummy si el usuario no existe) para no filtrar por timing.
    const hashToCompare = user ? user.passwordHash : DUMMY_PASSWORD_HASH;
    const passwordMatches = await bcrypt.compare(password, hashToCompare).catch(function () { return false; });
    const valid = !!user && password.length > 0 && passwordMatches;
    if (!valid) {
      registerLoginFailure(ip);
      return res.status(401).json({ message: 'Usuario o contrasena incorrectos.' });
    }
    clearLoginFailures(ip);
    const char = user.characterId ? charById.get(user.characterId) : null;
    if (!char) return res.status(500).json({ message: 'El personaje del usuario no existe.' });
    const token = issueSession(user.id); // A1: token de sesion (no se loguea).
    return res.json({ userId: user.id, char: publicChar(char), token });
  } catch (err) {
    console.error('[api/login] ' + (err && err.message ? err.message : 'error'));
    return res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.use(function (req, res, next) {
  if (req.path === '/api' || req.path.indexOf('/api/') === 0) {
    return res.status(404).json({ message: 'Ruta no encontrada' });
  }
  return next();
});

app.use(function (err, req, res, next) {
  const message = err && err.message ? err.message : 'Error desconocido';
  console.error('[http] ' + message);
  if (res.headersSent) return next(err);
  const status = err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  const clientMessage = status === 500 ? 'Error interno del servidor' : (status === 413 ? 'Solicitud demasiado grande' : 'Solicitud invalida');
  return res.status(status).json({ message: clientMessage });
});

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

function registerSocketHandler(socket, event, handler) {
  socket.on(event, function () {
    const args = Array.prototype.slice.call(arguments);
    Promise.resolve()
      .then(function () { return handler.apply(null, args); })
      .catch(function (err) {
        console.error('[socket:' + event + '] ' + (err && err.message ? err.message : 'error'));
        toast(socket, 'error', 'Ha ocurrido un error inesperado.');
      });
  });
}

function sanitizeChat(text) {
  const raw = typeof text === 'string' ? text : '';
  return raw
    .replace(/[<>]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, MAX_CHAT_LENGTH);
}

function handleChatCommand(socket, char, text) {
  const parts = text.slice(1).trim().split(/\s+/);
  const command = (parts[0] || '').toLowerCase();
  if (command === 'help') {
    systemChat(socket, 'Comandos: /help, /online, /who, /stats.');
    return;
  }
  if (command === 'online' || command === 'who') {
    const names = [];
    for (const player of connected.values()) {
      names.push(player.name + ' (Nv.' + player.level + ' ' + player.class + ')');
    }
    systemChat(socket, 'Conectados (' + connected.size + '): ' + (names.length ? names.join(', ') : 'nadie'));
    return;
  }
  if (command === 'stats') {
    systemChat(socket, char.name + ' - ' + char.class + ' Nv.' + char.level + ' | HP ' + char.hp + '/' + char.maxHp + ' | MP ' + char.mp + '/' + char.maxMp + ' | CP ' + char.cp + '/' + char.maxCp + ' | Oro ' + char.gold + ' | EXP ' + char.exp + '/' + char.expNext + ' | Kills ' + char.kills + ' | Muertes ' + char.deaths);
    return;
  }
  systemChat(socket, 'Comando desconocido. Usa /help para ver la lista.');
}

// ---------------------------------------------------------------------------
// Grupos (party en memoria, PROTOCOL v2.3)
// ---------------------------------------------------------------------------

function getConnectedByName(name) {
  if (typeof name !== 'string') return null;
  const key = name.trim().toLowerCase();
  if (!key) return null;
  for (const player of connected.values()) {
    if (player.name.toLowerCase() === key) return player;
  }
  return null;
}

function partyOfChar(charId) {
  for (const party of parties.values()) {
    if (party.memberIds.indexOf(charId) !== -1) return party;
  }
  return null;
}

function membersPayload(party) {
  const members = [];
  for (const memberId of party.memberIds) {
    const char = charById.get(memberId);
    if (!char) continue;
    members.push({
      id: char.id,
      name: char.name,
      class: char.class,
      level: char.level,
      hp: char.hp,
      maxHp: char.maxHp,
      online: connected.has(char.id)
    });
  }
  return members;
}

function broadcastParty(party) {
  if (!party) return;
  const payload = { partyId: party.id, members: membersPayload(party) };
  for (const memberId of party.memberIds) {
    const member = charById.get(memberId);
    if (member) emitToChar(member, 'partyUpdate', payload);
  }
}

function sendPartyNull(char) {
  if (char) emitToChar(char, 'partyUpdate', { partyId: null });
}

function leaveParty(char) {
  if (!char) return;
  const party = partyOfChar(char.id);
  if (party) {
    const index = party.memberIds.indexOf(char.id);
    if (index !== -1) party.memberIds.splice(index, 1);
    if (party.memberIds.length === 0) {
      parties.delete(party.id);
    } else {
      if (party.leaderId === char.id) party.leaderId = party.memberIds[0];
      broadcastParty(party);
    }
  }
  // Limpia invitaciones donde el personaje sea invitado o invitador.
  for (const inviteeId of Array.from(partyInvites.keys())) {
    const invite = partyInvites.get(inviteeId);
    if (!invite) continue;
    if (inviteeId === char.id || invite.fromId === char.id) partyInvites.delete(inviteeId);
  }
  sendPartyNull(char);
}

function handleDisconnect(socket) {
  const char = getSocketCharacter(socket);
  if (!char || char.socketId !== socket.id) return;
  connected.delete(char.id);
  char.online = false;
  char.socketId = null;
  char.moving = false;
  char.attackAnim = 0;
  char.path = [];
  char.targetId = null;
  for (const monster of monsters) {
    if (monster.targetId === char.id) monster.targetId = null;
  }
  leaveParty(char); // D16: sale del grupo y limpia invitaciones pendientes (tambien las enviadas).
  scheduleSave(); // B19: guardado debounced, no bloqueante, en cada desconexion.
  broadcastOnline();
  io.emit('chat', { channel: 'global', from: 'Sistema', text: char.name + ' ha abandonado el mundo.', ts: Date.now(), kind: 'system' });
  console.log('[socket] Desconectado: ' + char.name);
}

io.on('connection', function (socket) {
  registerSocketHandler(socket, 'join', async function (payload, callback) {
    const respond = typeof callback === 'function' ? callback : function () {};
    const username = payload && typeof payload.username === 'string' ? payload.username.trim() : '';
    const token = payload && typeof payload.token === 'string' ? payload.token : '';
    if (!username) return respond({ success: false, message: 'Usuario requerido.' });
    if (socket.data.characterId) return respond({ success: false, message: 'Este socket ya esta conectado al mundo.' });
    const user = findUser(username);
    if (!user) return respond({ success: false, message: 'Usuario no encontrado.' });
    // A1: sin token valido no se entra (aunque venga el username correcto).
    if (!validateSession(token, user.id)) {
      return respond({ success: false, message: 'Sesion invalida. Vuelve a iniciar sesion.' });
    }
    const char = user.characterId ? charById.get(user.characterId) : null;
    if (!char) return respond({ success: false, message: 'Personaje no encontrado.' });
    const currentSocket = char.socketId ? io.sockets.sockets.get(char.socketId) : null;
    if (currentSocket && currentSocket.connected && currentSocket.id !== socket.id) {
      return respond({ success: false, message: 'El personaje ya esta conectado.' });
    }
    char.online = true;
    char.socketId = socket.id;
    char.lastRegenAt = Date.now();
    char.lastFoodAt = Date.now();
    socket.data.characterId = char.id;
    connected.set(char.id, char);
    socket.join('world-room'); // B25: solo los sockets con join reciben world/updateWorld.
    // B20: notificar estado de muerte al reconectar (si el personaje estuvo muerto).
    if (char.dead) emitToChar(char, 'death', { killerName: 'Desconocido' });
    respond({ success: true, char: publicChar(char), online: connected.size, config: getConfig() });
    broadcastOnline();
    io.emit('chat', { channel: 'global', from: 'Sistema', text: char.name + ' se ha conectado al mundo.', ts: Date.now(), kind: 'system' });
    console.log('[socket] Conectado: ' + char.name);
    scheduleSave();
  });

  registerSocketHandler(socket, 'move', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char || char.dead || char.hp <= 0) return;
    if (char.path.length > 0) return; // B2: con path activo el movimiento lo lleva el tick.
    const now = Date.now();
    const throttleLimit = Number(process.env.MOVE_THROTTLE_MS) || DEFAULT_MOVE_THROTTLE_MS;
    if (now - (char.lastAcceptedMoveAt || 0) < throttleLimit) return; // B2: throttle anti-speedhack configurable
    const dx = payload ? payload.dx : undefined;
    const dy = payload ? payload.dy : undefined;
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) return;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return;
    char.path = [];
    applyPlayerStep(char, dx, dy);
  });

  registerSocketHandler(socket, 'moveTo', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (char.dead || char.hp <= 0) {
      char.path = []; // B30: cualquier moveTo invalido cancela el path anterior.
      return;
    }
    const x = payload ? payload.x : undefined;
    const y = payload ? payload.y : undefined;
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      char.path = [];
      return;
    }
    if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) {
      char.path = [];
      return;
    }
    if (grid.isWall(x, y) || monsterAt(x, y)) {
      char.path = [];
      return;
    }
    if (x === char.gridX && y === char.gridY) {
      char.path = [];
      return;
    }
    const path = findPath(char.gridX, char.gridY, x, y);
    if (!path || path.length === 0 || path.length > 200) {
      // B30: no aceptar caminos demasiado largos (limite de coste/latencia).
      char.path = [];
      if (path && path.length > 200) toast(socket, 'warn', 'Ese destino esta demasiado lejos.');
      return;
    }
    char.path = path;
  });

  registerSocketHandler(socket, 'setTarget', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char || char.dead) return;
    const targetId = payload ? payload.targetId : null;
    if (targetId === null || targetId === undefined || targetId === '') {
      char.targetId = null;
      return;
    }
    if (typeof targetId !== 'string') return;
    const monster = monsters.find(function (entry) { return entry.id === targetId && entry.hp > 0; });
    if (!monster) {
      char.targetId = null;
      toast(socket, 'warn', 'Objetivo no valido.');
      return;
    }
    char.targetId = monster.id;
  });

  registerSocketHandler(socket, 'attack', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (char.dead || char.hp <= 0) {
      toast(socket, 'error', 'Estas muerto. Usa la resurreccion para volver al combate.');
      return;
    }
    const targetId = payload ? payload.targetId : null;
    const skillId = payload && typeof payload.skillId === 'string' ? payload.skillId : 'basic';
    if (typeof targetId !== 'string') {
      toast(socket, 'warn', 'Objetivo no valido.');
      return;
    }
    const skill = getSkill(skillId);
    if (!skill || skill.kind !== 'damage') {
      toast(socket, 'error', 'Esa habilidad no sirve para atacar.');
      return;
    }
    const monster = monsters.find(function (entry) { return entry.id === targetId && entry.hp > 0; });
    if (!monster) {
      toast(socket, 'warn', 'El objetivo no esta vivo.');
      return;
    }
    castDamageSkill(char, socket, monster, skill);
  });

  registerSocketHandler(socket, 'skill', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (char.dead || char.hp <= 0) {
      toast(socket, 'error', 'No puedes usar habilidades estando muerto.');
      return;
    }
    const skillId = payload ? payload.skillId : null;
    const skill = getSkill(skillId);
    if (!skill) {
      toast(socket, 'error', 'Habilidad desconocida.');
      return;
    }
    // B5: validar que la skill pertenece a la clase del personaje.
    const classDef = getClassDef(char.class);
    if (classDef && !classDef.skills.includes(skillId)) {
      toast(socket, 'error', 'Esta habilidad no pertenece a tu clase.');
      return;
    }
    if (skill.kind === 'damage') {
      const targetId = payload ? payload.targetId : null;
      if (typeof targetId !== 'string') {
        toast(socket, 'warn', 'Selecciona un objetivo para esa habilidad.');
        return;
      }
      const monster = monsters.find(function (entry) { return entry.id === targetId && entry.hp > 0; });
      if (!monster) {
        toast(socket, 'warn', 'El objetivo no esta vivo.');
        return;
      }
      castDamageSkill(char, socket, monster, skill);
      return;
    }
    if (skill.kind === 'heal') {
      useHealSkill(char, socket, skill);
      return;
    }
    if (skill.kind === 'buff') {
      useBuffSkill(char, socket, skill);
      return;
    }
    if (skill.kind === 'blink') {
      useBlinkSkill(char, socket, skill);
      return;
    }
    toast(socket, 'error', 'Habilidad no soportada.');
  });

  registerSocketHandler(socket, 'pickup', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char || char.dead) return;
    const dropId = payload ? payload.dropId : null;
    if (typeof dropId !== 'string') return;
    const index = drops.findIndex(function (drop) { return drop.id === dropId; });
    if (index === -1) {
      toast(socket, 'warn', 'Ese objeto ya no esta en el suelo.');
      return;
    }
    const drop = drops[index];
    if (drop.expiresAt <= Date.now()) {
      drops.splice(index, 1);
      toast(socket, 'warn', 'Ese objeto se ha desvanecido.');
      return;
    }
    if (Math.hypot(char.gridX - drop.gridX, char.gridY - drop.gridY) > 3.5) { // B27: alinear con el cliente.
      toast(socket, 'warn', 'Estas demasiado lejos de ese objeto.');
      return;
    }
    const item = getItem(drop.itemId);
    const canTakeItem = !!(item && canAddItem(char, drop.itemId));
    const goldTaken = Math.max(0, toInt(drop.gold, 0));
    // B10: con el inventario lleno, el oro se recoge igualmente; el objeto se queda en el suelo.
    if (!canTakeItem && goldTaken <= 0) {
      toast(socket, 'error', 'Inventario lleno: no puedes recoger mas objetos.');
      return;
    }
    if (canTakeItem) {
      drops.splice(index, 1);
      addItem(char, drop.itemId, 1);
      syncCollectQuests(char);
    } else {
      drop.gold = 0;
    }
    if (goldTaken > 0) char.gold += goldTaken;
    const lootPayload = { gold: goldTaken };
    if (canTakeItem) {
      lootPayload.itemId = drop.itemId;
      lootPayload.item = item;
      lootPayload.count = 1;
    }
    emitToChar(char, 'loot', lootPayload);
    emitToChar(char, 'charUpdate', { char: publicChar(char) });
    if (!canTakeItem) {
      toast(socket, 'warn', 'Recogiste ' + goldTaken + ' de oro; el objeto sigue en el suelo (inventario lleno).');
    }
    scheduleSave();
  });

  registerSocketHandler(socket, 'useItem', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    const itemId = payload ? payload.itemId : null;
    const item = getItem(itemId);
    if (!item) {
      toast(socket, 'error', 'Objeto desconocido.');
      return;
    }
    if (char.dead) {
      toast(socket, 'error', 'No puedes usar objetos estando muerto.');
      return;
    }
    const entry = char.inventory.find(function (inventoryEntry) { return inventoryEntry.itemId === itemId; });
    if (!entry) {
      toast(socket, 'error', 'No tienes ese objeto.');
      return;
    }
    // B11: los items de tipo 'potion' pueden ser de curación (HP/MP) o de comida (food).
    if (item.type !== 'potion') {
      toast(socket, 'warn', 'Ese objeto no se puede consumir.');
      return;
    }
    // Items de comida: item_18 (Ración) y item_19 (Vianda) restauran la barra de comida.
    if (item.food !== undefined) {
      const foodHeal = Math.max(0, Number(item.food) || 0);
      const beforeFood = char.food;
      char.food = Math.min(char.maxFood, char.food + foodHeal);
      const recoveredFood = char.food - beforeFood;
      consumeInventoryItem(char, itemId, 1);
      emitToChar(char, 'charUpdate', { char: publicChar(char) });
      if (recoveredFood > 0) {
        toast(socket, 'success', 'Has usado ' + item.name + ' y recuperado ' + recoveredFood + ' de comida.');
      } else {
        toast(socket, 'info', 'Tu comida ya estaba al maximo; no se ha consumido el objeto.');
      }
      scheduleSave();
      return;
    }
    const heal = Math.max(0, Number(item.heal) || 0);
    const healMp = Math.max(0, Number(item.healMp) || 0);
    if (heal <= 0 && healMp <= 0) {
      toast(socket, 'warn', 'Ese objeto no restaura nada.');
      return;
    }
    const beforeHp = char.hp;
    const beforeMp = char.mp;
    char.hp = Math.min(char.maxHp, char.hp + heal);
    char.mp = Math.min(char.maxMp, char.mp + healMp);
    const recoveredHp = char.hp - beforeHp;
    const recoveredMp = char.mp - beforeMp;
    if (recoveredHp <= 0 && recoveredMp <= 0) {
      // B13: no consumir la pocion si no aporta nada.
      toast(socket, 'info', 'Tu salud y tu mana ya estaban al maximo; no se ha consumido el objeto.');
      return;
    }
    consumeInventoryItem(char, itemId, 1);
    emitToChar(char, 'charUpdate', { char: publicChar(char) });
    const parts = [];
    if (recoveredHp > 0) parts.push(recoveredHp + ' de salud');
    if (recoveredMp > 0) parts.push(recoveredMp + ' de mana');
    toast(socket, 'success', 'Has usado ' + item.name + ' y recuperado ' + parts.join(' y ') + '.');
    scheduleSave();
  });

  registerSocketHandler(socket, 'equip', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (char.dead) {
      toast(socket, 'error', 'No puedes equipar objetos estando muerto.');
      return;
    }
    const itemId = payload ? payload.itemId : null;
    const item = getItem(itemId);
    if (!item) {
      toast(socket, 'error', 'Objeto desconocido.');
      return;
    }
    if (EQUIP_SLOTS.indexOf(item.type) === -1) {
      toast(socket, 'warn', 'Ese objeto no se puede equipar.');
      return;
    }
    if (char.equipment[item.type] === itemId) {
      emitToChar(char, 'charUpdate', { char: publicChar(char) });
      toast(socket, 'info', 'Ya tienes ' + item.name + ' equipado.');
      return;
    }
    const inInventory = char.inventory.some(function (entry) { return entry.itemId === itemId; });
    if (!inInventory) {
      toast(socket, 'error', 'No tienes ese objeto.');
      return;
    }
    const slot = item.type;
    const previous = char.equipment[slot] || null;
    consumeInventoryItem(char, itemId, 1);
    if (previous) {
      if (!addItem(char, previous, 1)) {
        addItem(char, itemId, 1);
        toast(socket, 'error', 'Inventario lleno: no puedes cambiar ese objeto.');
        return;
      }
    }
    char.equipment[slot] = itemId;
    recomputeDerived(char);
    emitToChar(char, 'charUpdate', { char: publicChar(char) });
    toast(socket, 'success', 'Has equipado ' + item.name + '.');
    scheduleSave();
  });

  registerSocketHandler(socket, 'unequip', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (char.dead) {
      toast(socket, 'error', 'No puedes desequipar objetos estando muerto.');
      return;
    }
    const slot = payload ? payload.slot : null;
    if (typeof slot !== 'string' || EQUIP_SLOTS.indexOf(slot) === -1) {
      toast(socket, 'warn', 'Ranura no valida.');
      return;
    }
    const itemId = char.equipment[slot];
    if (!itemId) {
      toast(socket, 'warn', 'No hay nada equipado en esa ranura.');
      return;
    }
    if (!addItem(char, itemId, 1)) {
      toast(socket, 'error', 'Inventario lleno: no puedes desequipar ese objeto.');
      return;
    }
    char.equipment[slot] = null;
    const item = getItem(itemId);
    recomputeDerived(char);
    emitToChar(char, 'charUpdate', { char: publicChar(char) });
    toast(socket, 'success', 'Has desequipado ' + (item ? item.name : 'el objeto') + '.');
    scheduleSave();
  });

  registerSocketHandler(socket, 'allocStat', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (char.dead) {
      toast(socket, 'error', 'No puedes asignar atributos estando muerto.');
      return;
    }
    const stat = payload ? payload.stat : null;
    if (typeof stat !== 'string' || STAT_KEYS.indexOf(stat) === -1) {
      toast(socket, 'error', 'Atributo no valido.');
      return;
    }
    if ((char.statPoints || 0) <= 0) {
      toast(socket, 'error', 'No tienes puntos de atributo disponibles.');
      return;
    }
    char.statPoints -= 1;
    char.baseStats[stat] = (char.baseStats[stat] || 0) + 1;
    recomputeDerived(char);
    emitToChar(char, 'charUpdate', { char: publicChar(char) });
    toast(socket, 'success', 'Has aumentado ' + stat.toUpperCase() + ' en 1.');
    scheduleSave();
  });

  registerSocketHandler(socket, 'shop', function () {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (char.dead) {
      toast(socket, 'error', 'No puedes abrir la tienda estando muerto.');
      return;
    }
    emitToChar(char, 'shopStock', { stock: shopStockPayload() });
  });

  registerSocketHandler(socket, 'buy', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (char.dead) {
      toast(socket, 'error', 'No puedes comprar estando muerto.');
      return;
    }
    const itemId = payload ? payload.itemId : null;
    const item = getItem(itemId);
    const offer = typeof itemId === 'string' && hasOwn(SHOP_BY_ITEM, itemId) ? SHOP_BY_ITEM[itemId] : null;
    if (!item || !offer) {
      toast(socket, 'error', 'Ese objeto no esta en venta.');
      return;
    }
    let count = 1;
    if (payload && payload.count !== undefined && payload.count !== null) {
      if (!Number.isInteger(payload.count) || payload.count < 1 || payload.count > 99) {
        toast(socket, 'warn', 'Cantidad no valida.');
        return;
      }
      count = payload.count;
    }
    const stock = toInt(SHOP_STOCK[itemId], 0);
    if (stock < count) {
      toast(socket, 'error', 'No hay suficiente stock de ese objeto.');
      return;
    }
    const total = offer.price * count;
    if (char.gold < total) {
      toast(socket, 'error', 'No tienes oro suficiente.');
      return;
    }
    if (inventoryCapacity(char, itemId) < count) {
      toast(socket, 'error', 'Inventario lleno: no puedes comprar mas objetos.');
      return;
    }
    char.gold -= total;
    SHOP_STOCK[itemId] = stock - count;
    addItems(char, itemId, count);
    syncCollectQuests(char);
    emitToChar(char, 'charUpdate', { char: publicChar(char) });
    emitToChar(char, 'loot', { itemId: itemId, item: item, count: count, gold: 0 });
    emitToChar(char, 'shopStock', { stock: shopStockPayload() });
    toast(socket, 'success', 'Has comprado ' + item.name + ' x' + count + ' por ' + total + ' de oro.');
    scheduleSave();
  });

  // B12: Nuevo handler de crafting
  registerSocketHandler(socket, 'craft', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (char.dead) {
      toast(socket, 'error', 'No puedes hacer crafting estando muerto.');
      return;
    }
    const recipeId = payload ? payload.recipeId : null;
    if (!recipeId) {
      toast(socket, 'error', 'ID de receta requerido.');
      return;
    }
    const recipe = RECIPES[recipeId];
    if (!recipe) {
      toast(socket, 'error', 'Receta desconocida.');
      return;
    }
    // Validar nivel mínimo
    if (char.level < recipe.minLevel) {
      toast(socket, 'error', 'Nivel demasiado bajo para esta receta. Nivel mínimo: ' + recipe.minLevel + '.');
      return;
    }
    // Validar skill requerida
    if (recipe.skillRequired) {
      const hasSkill = char.skills && char.skills.includes(recipe.skillRequired);
      if (!hasSkill) {
        toast(socket, 'error', 'No tienes la skill requerida para esta receta.');
        return;
      }
    }
    // Verificar ingredientes en el inventario
    let hasAllIngredients = true;
    for (const ingredient of recipe.ingredients) {
      const count = countInventoryItem(char, ingredient.itemId);
      if (count < ingredient.count) {
        hasAllIngredients = false;
        break;
      }
    }
    if (!hasAllIngredients) {
      toast(socket, 'error', 'No tienes suficientes ingredientes para esta receta.');
      return;
    }
    // Consumir ingredientes
    for (const ingredient of recipe.ingredients) {
      consumeInventoryItem(char, ingredient.itemId, ingredient.count);
    }
    // Otorgar resultado
    const result = addItem(char, recipe.resultItem, 1);
    // Otorgar experiencia
    char.xp += recipe.xpReward;
    grantExperience(char); // Esto sube de nivel si corresponde
    dirty = true;
    scheduleSave();
    // Emitir notificación
    const item = getItem(recipe.resultItem);
    toast(socket, 'success', 'Has craftado ' + (item ? item.name : 'item') + ' y ganaste ' + recipe.xpReward + ' de experiencia.');
    emitToChar(char, 'charUpdate', { char: publicChar(char) });
  });

  registerSocketHandler(socket, 'sell', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (char.dead) {
      toast(socket, 'error', 'No puedes vender estando muerto.');
      return;
    }
    const itemId = payload ? payload.itemId : null;
    const item = getItem(itemId);
    if (!item) {
      toast(socket, 'error', 'Objeto desconocido.');
      return;
    }
    let count = 1;
    if (payload && payload.count !== undefined && payload.count !== null) {
      if (!Number.isInteger(payload.count) || payload.count < 1 || payload.count > 99) {
        toast(socket, 'warn', 'Cantidad no valida.');
        return;
      }
      count = payload.count;
    }
    if (countInventoryItem(char, itemId) < count) {
      toast(socket, 'error', 'No tienes suficientes unidades de ese objeto.');
      return;
    }
    const unitPrice = Math.max(1, Math.floor(toInt(item.value, 0) * 0.6));
    const total = unitPrice * count;
    consumeInventoryItem(char, itemId, count);
    char.gold += total;
    syncCollectQuests(char);
    emitToChar(char, 'charUpdate', { char: publicChar(char) });
    emitToChar(char, 'loot', { gold: total });
    emitToChar(char, 'shopStock', { stock: shopStockPayload() });
    toast(socket, 'success', 'Has vendido ' + item.name + ' x' + count + ' por ' + total + ' de oro.');
    scheduleSave();
  });

  registerSocketHandler(socket, 'quest', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (char.dead) {
      toast(socket, 'error', 'No puedes gestionar misiones estando muerto.');
      return;
    }
    const action = payload ? payload.action : null;
    const questId = payload ? payload.questId : null;
    const quest = getQuest(questId);
    if (!quest) {
      toast(socket, 'error', 'Mision desconocida.');
      return;
    }
    if (action === 'accept') {
      const existing = char.quests.some(function (entry) { return entry.id === questId; });
      if (existing) {
        toast(socket, 'info', 'Ya tienes esa mision.');
        return;
      }
      const initialProgress = quest.goal.type === 'collect' ? computeCollectProgress(char, quest) : 0;
      char.quests.push({ id: questId, state: 'active', progress: initialProgress });
      emitToChar(char, 'questUpdate', { quests: publicQuestList(char) });
      toast(socket, 'success', 'Mision aceptada: ' + quest.name + '.');
      scheduleSave();
      return;
    }
    if (action === 'complete') {
      const entry = char.quests.find(function (questEntry) { return questEntry.id === questId; });
      if (!entry || entry.state !== 'active') {
        toast(socket, 'error', 'No tienes esa mision activa.');
        return;
      }
      applyCollectProgress(char);
      if (entry.progress < quest.goal.count) {
        toast(socket, 'warn', 'Aun no has completado el objetivo (' + entry.progress + '/' + quest.goal.count + ').');
        return;
      }
      const reward = quest.reward || {};
      if (reward.itemId && !addItem(char, reward.itemId, 1)) {
        toast(socket, 'error', 'Inventario lleno: libera espacio para reclamar la recompensa.');
        return;
      }
      entry.state = 'done';
      char.gold += reward.gold || 0;
      char.exp += reward.exp || 0;
      grantExperience(char);
      emitToChar(char, 'questUpdate', { quests: publicQuestList(char) });
      if (reward.itemId) {
        emitToChar(char, 'loot', { itemId: reward.itemId, item: getItem(reward.itemId), count: 1, gold: reward.gold || 0 });
      } else {
        emitToChar(char, 'loot', { gold: reward.gold || 0 });
      }
      toast(socket, 'success', 'Mision completada: ' + quest.name + '.');
      scheduleSave();
      return;
    }
    toast(socket, 'error', 'Accion de mision invalida.');
  });

  registerSocketHandler(socket, 'chat', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    const channel = payload && typeof payload.channel === 'string' ? payload.channel.toLowerCase() : '';
    if (['global', 'local', 'party', 'help'].indexOf(channel) === -1) {
      toast(socket, 'warn', 'Canal de chat invalido.');
      return;
    }
    // B12: maximo 3 mensajes por socket cada 2 s.
    const now = Date.now();
    if (!socket.data.chatWindowStart || now - socket.data.chatWindowStart >= 2000) {
      socket.data.chatWindowStart = now;
      socket.data.chatCount = 0;
    }
    socket.data.chatCount = (socket.data.chatCount || 0) + 1;
    if (socket.data.chatCount > 3) {
      toast(socket, 'warn', 'Estas enviando mensajes demasiado rapido. Espera un momento.');
      return;
    }
    const text = sanitizeChat(payload ? payload.text : '');
    if (!text) return;
    if (text.charAt(0) === '/') {
      handleChatCommand(socket, char, text);
      return;
    }
    if (channel === 'party') {
      // D17: el chat de grupo solo llega a los miembros del grupo.
      const party = partyOfChar(char.id);
      if (!party) {
        toast(socket, 'warn', 'No estas en un grupo.');
        return;
      }
      const chatPayload = { channel: 'party', from: char.name, text: text, ts: Date.now(), kind: 'player' };
      for (const memberId of party.memberIds) {
        const member = charById.get(memberId);
        if (member) emitToChar(member, 'chat', chatPayload);
      }
      return;
    }
    io.emit('chat', { channel: channel, from: char.name, text: text, ts: Date.now(), kind: 'player' });
  });

  registerSocketHandler(socket, 'partyInvite', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    const targetName = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!targetName) {
      toast(socket, 'warn', 'Nombre no valido.');
      return;
    }
    const target = getConnectedByName(targetName);
    if (!target) {
      toast(socket, 'warn', 'Ese jugador no esta conectado.');
      return;
    }
    if (target.id === char.id) {
      toast(socket, 'warn', 'No puedes invitarte a ti mismo.');
      return;
    }
    if (partyOfChar(target.id)) {
      toast(socket, 'error', 'Ese jugador ya esta en un grupo.');
      return;
    }
    const existingInvite = partyInvites.get(target.id);
    if (existingInvite && existingInvite.fromId === char.id) {
      toast(socket, 'info', 'Ya has invitado a ' + target.name + '.');
      return;
    }
    let party = partyOfChar(char.id);
    if (party && party.leaderId !== char.id) {
      toast(socket, 'warn', 'Solo el lider del grupo puede invitar.');
      return;
    }
    if (!party) {
      partySeq += 1;
      party = { id: 'party_' + partySeq, leaderId: char.id, memberIds: [char.id] };
      parties.set(party.id, party);
      broadcastParty(party);
    }
    partyInvites.set(target.id, { fromId: char.id, partyId: party.id, at: Date.now() });
    emitToChar(target, 'partyInvite', { fromName: char.name });
    toast(socket, 'success', 'Invitacion enviada a ' + target.name + '.');
  });

  registerSocketHandler(socket, 'partyAccept', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    const fromName = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
    const invite = partyInvites.get(char.id);
    if (!invite) {
      toast(socket, 'warn', 'No tienes invitaciones pendientes.');
      return;
    }
    const inviter = charById.get(invite.fromId);
    if (!inviter || inviter.name.toLowerCase() !== fromName.toLowerCase()) {
      toast(socket, 'warn', 'No tienes invitacion de ese jugador.');
      return;
    }
    if (!connected.has(inviter.id) || !connected.has(char.id)) {
      partyInvites.delete(char.id);
      toast(socket, 'warn', 'Ese jugador ya no esta conectado.');
      return;
    }
    const party = parties.get(invite.partyId) || partyOfChar(inviter.id);
    if (!party) {
      partyInvites.delete(char.id);
      toast(socket, 'warn', 'Ese grupo ya no existe.');
      return;
    }
    if (partyOfChar(char.id)) {
      partyInvites.delete(char.id);
      toast(socket, 'warn', 'Ya estas en un grupo.');
      return;
    }
    party.memberIds.push(char.id);
    partyInvites.delete(char.id);
    broadcastParty(party);
    toast(socket, 'success', 'Te has unido al grupo de ' + inviter.name + '.');
  });

  registerSocketHandler(socket, 'partyDecline', function (payload) {
    const char = getSocketCharacter(socket);
    if (!char) return;
    const invite = partyInvites.get(char.id);
    if (!invite) {
      toast(socket, 'info', 'No tienes invitaciones pendientes.');
      return;
    }
    const inviter = charById.get(invite.fromId);
    partyInvites.delete(char.id);
    toast(socket, 'info', 'Has rechazado la invitacion.');
    if (inviter) emitToChar(inviter, 'toast', { type: 'info', message: char.name + ' ha rechazado tu invitacion.' });
  });

  registerSocketHandler(socket, 'partyLeave', function () {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (!partyOfChar(char.id)) {
      toast(socket, 'info', 'No estas en un grupo.');
      return;
    }
    leaveParty(char);
  });

  registerSocketHandler(socket, 'respawn', function () {
    const char = getSocketCharacter(socket);
    if (!char) return;
    if (!char.dead) {
      toast(socket, 'info', 'No estas muerto.');
      return;
    }
    const lost = Math.floor(char.exp * 0.1);
    char.exp = Math.max(0, char.exp - lost);
    char.deaths += 1;
    char.dead = false;
    char.hp = char.maxHp;
    char.mp = char.maxMp;
    char.cp = char.maxCp;
    char.path = [];
    char.targetId = null;
    char.cooldowns = {};
    char.buffs = {};
    char.moving = false;
    char.attackAnim = 0;
    const start = getStartPosition(char.class);
    char.gridX = start.x;
    char.gridY = start.y;
    char.expNext = expForLevel(char.level);
    emitToChar(char, 'respawned', { char: publicChar(char) });
    emitToChar(char, 'charUpdate', { char: publicChar(char) });
    toast(socket, 'success', 'Has resucitado en el santuario de tu clase. Has perdido ' + lost + ' de experiencia.');
    scheduleSave();
  });

  registerSocketHandler(socket, 'ping', function (payload, callback) {
    if (typeof callback !== 'function') return;
    const pingTime = payload ? payload.t : null;
    // B17: solo se devuelve un timestamp numerico finito.
    callback(typeof pingTime === 'number' && Number.isFinite(pingTime) ? pingTime : null);
  });

  socket.on('disconnect', function () {
    try {
      handleDisconnect(socket);
    } catch (err) {
      console.error('[socket:disconnect] ' + (err && err.message ? err.message : 'error'));
    }
  });
});

// ---------------------------------------------------------------------------
// Arranque y cierre limpio
// ---------------------------------------------------------------------------

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[server] Senal ' + signal + ' recibida. Cerrando...');
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (persistTimer) {
    clearInterval(persistTimer);
    persistTimer = null;
  }
  saveStateNow();
  removeLockFile(); // B7: liberar la instancia unica al final del cierre limpio.
  io.close();
  httpServer.close(function () {
    console.log('[server] Servidor detenido.');
    process.exit(0);
  });
  shutdownTimer = setTimeout(function () {
    process.exit(0);
  }, 3000);
  if (shutdownTimer.unref) shutdownTimer.unref();
}

process.on('SIGINT', function () {
  shutdown('SIGINT');
});

process.on('SIGTERM', function () {
  shutdown('SIGTERM');
});

// B18: red de seguridad de ultimo recurso (loguea e intenta guardar antes de salir).
process.on('unhandledRejection', function (reason) {
  console.error('[server] unhandledRejection: ' + (reason && reason.message ? reason.message : String(reason)));
  try {
    saveStateNow();
  } catch (saveErr) {
    console.error('[server] No se pudo guardar tras unhandledRejection: ' + (saveErr && saveErr.message ? saveErr.message : 'error'));
  }
});

process.on('uncaughtException', function (err) {
  console.error('[server] uncaughtException: ' + (err && err.stack ? err.stack : String(err)));
  try {
    saveStateNow();
  } catch (saveErr) {
    console.error('[server] No se pudo guardar tras uncaughtException: ' + (saveErr && saveErr.message ? saveErr.message : 'error'));
  }
  removeLockFile(); // B7: no dejar un lock huerfano si morimos por excepcion.
  process.exit(1);
});

function printBanner() {
  console.log('============================================================');
  console.log('  AETHELGARD - LEGACY OF SHADOWS');
  console.log('  Backend v' + VERSION + ' | Node.js + Express + Socket.IO');
  console.log('============================================================');
  console.log('  URL: http://localhost:' + PORT);
  console.log('  Tick de mundo: ' + TICK_MS + ' ms');
  console.log('  Usuarios cargados: ' + state.users.length);
  console.log('  Personajes cargados: ' + state.characters.length);
  console.log('  Monstruos activos: ' + monsters.length);
  console.log('  Persistencia: ' + STATE_FILE);
  console.log('============================================================');
}

function onServerListening() {
  // B6: el puerto final puede haber cambiado por el fallback de EADDRINUSE.
  writeLockFile();
  printBanner();
}

async function bootstrap() {
  acquireInstanceLock(); // B6: instancia unica por DATA_DIR antes de leer/escribir state.json.
  await loadState();
  tickTimer = setInterval(function () {
    try {
      worldTick();
    } catch (err) {
      console.error('[tick] ' + (err && err.message ? err.message : 'error'));
    }
  }, TICK_MS);
  persistTimer = setInterval(function () {
    if (dirty) saveStateNow();
  }, 30000);
  httpServer.on('error', function (err) {
    if (err && err.code === 'EADDRINUSE' && listenAttempts < 8) {
      listenAttempts += 1;
      console.warn('[server] Puerto ' + PORT + ' ocupado, probando ' + (PORT + 1) + '...');
      PORT = PORT + 1;
      setTimeout(function () {
        try { httpServer.listen(PORT, onServerListening); } catch (e) { console.error('[server] ' + (e && e.message ? e.message : 'listen')); }
      }, 200);
      return;
    }
    console.error('[server] ' + (err && err.message ? err.message : 'error'));
    process.exit(1);
  });
  httpServer.listen(PORT, onServerListening);
}

bootstrap().catch(function (err) {
  console.error('[server] No se pudo iniciar: ' + (err && err.message ? err.message : 'error'));
  process.exit(1);
});
