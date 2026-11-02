'use strict';

// Semilla de Aethelgard - Legacy of Shadows.
// Crea data/state.json con dos usuarios demo. No usa mongoose ni mongo.
// Idempotente por diseno: si data/state.json ya existe, no lo sobrescribe.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const CLASS_TEMPLATES = {
  DarkKnight: {
    hp: 1200,
    mp: 220,
    cp: 320,
    stats: { str: 18, dex: 10, int: 5, vit: 16, wit: 8, men: 8 },
    start: { x: 0, y: 0 }
  },
  ArcaneSorcerer: {
    hp: 800,
    mp: 500,
    cp: 250,
    stats: { str: 6, dex: 8, int: 22, vit: 10, wit: 18, men: 12 },
    start: { x: 2, y: 0 }
  }
};

function expForLevel(level) {
  return Math.round(100 * Math.pow(level, 1.55));
}

function derive(stats, equipment) {
  let weaponDamage = 0;
  let armorDefense = 0;
  if (equipment.weapon === 'item_1') weaponDamage += 20;
  if (equipment.armor === 'item_2') armorDefense += 10;
  return {
    dmg: Math.round(weaponDamage + stats.str * 0.6 + stats.dex * 0.25),
    def: Math.round(armorDefense + stats.vit * 0.5 + stats.str * 0.2)
  };
}

function buildCharacter(id, userId, username, className) {
  const template = CLASS_TEMPLATES[className];
  const stats = {
    str: template.stats.str,
    dex: template.stats.dex,
    int: template.stats.int,
    vit: template.stats.vit,
    wit: template.stats.wit,
    men: template.stats.men
  };
  const equipment = { weapon: 'item_1', armor: null, helm: null, boots: null, ring: null };
  const derived = derive(stats, equipment);
  return {
    id: id,
    userId: userId,
    name: username,
    class: className,
    level: 1,
    exp: 0,
    expNext: expForLevel(1),
    hp: template.hp,
    maxHp: template.hp,
    mp: template.mp,
    maxMp: template.mp,
    cp: template.cp,
    maxCp: template.cp,
    food: 100,
    maxFood: 100,
    gold: 50,
    gridX: template.start.x,
    gridY: template.start.y,
    baseStats: {
      str: stats.str,
      dex: stats.dex,
      int: stats.int,
      vit: stats.vit,
      wit: stats.wit,
      men: stats.men
    },
    stats: stats,
    dmg: derived.dmg,
    def: derived.def,
    inventory: [{ itemId: 'item_3', count: 3 }],
    equipment: equipment,
    quests: [],
    kills: 0,
    deaths: 0
  };
}

async function run() {
  if (fs.existsSync(STATE_FILE)) {
    console.log('[seed] Ya existe ' + STATE_FILE + '. No se sobrescribe; borralo manualmente si quieres regenerarlo.');
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const demoHash = await bcrypt.hash('demo1234', 10);
  const kundunHash = await bcrypt.hash('kundun1234', 10);
  const users = [
    { id: 'user_demo', username: 'demo', passwordHash: demoHash, characterId: 'char_demo', createdAt: Date.now() },
    { id: 'user_kundun', username: 'kundun', passwordHash: kundunHash, characterId: 'char_kundun', createdAt: Date.now() }
  ];
  const characters = [
    buildCharacter('char_demo', 'user_demo', 'demo', 'DarkKnight'),
    buildCharacter('char_kundun', 'user_kundun', 'kundun', 'ArcaneSorcerer')
  ];
  const payload = {
    version: 2,
    savedAt: Date.now(),
    users: users,
    characters: characters
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  console.log('[seed] Creado ' + STATE_FILE);
  console.log('[seed] Usuarios demo: demo / demo1234 y kundun / kundun1234');
  console.log('[seed] Personajes creados: ' + characters.length);
}

run().catch(function (err) {
  console.error('[seed] Error: ' + (err && err.message ? err.message : 'error'));
  process.exit(1);
});
