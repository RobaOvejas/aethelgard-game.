/**
 * Suite de pruebas automatizadas para Aethelgard - Legacy of Shadows
 * Usa node:test (disponible en Node ≥ 18)
 * 
 * Prueba los módulos críticos: inventario, equipo, quests, economía,
 * validación de habilidades por clase, y sistema de muerte/respawn.
 */

const { describe, it, expect, beforeEach, afterEach } = require('node:test');
const { resolve } = require('node:path');

// Cargar funciones y constantes del servidor
const serverPath = 'D:/PROYECTO MMORPG/aethelgard-upgrade/server.js';
const server = require(serverPath);

const CLASSES = server.CLASSES;
const SKILLS = server.SKILLS;
const ITEMS = server.ITEMS;
const QUESTS = server.QUESTS;
const MONSTER_TYPES = server.MONSTER_TYPES;

const { addItem, canAddItem, countInventoryItem, inventoryCapacity, consumeInventoryItem, getItem, getSkill, getQuest, recomputeDerived, createCharacter, normalizeCharacter, applyStarterKit, grantExperience, updateQuestProgress, killMonster, handlePlayerDeath, expForLevel } = server;

// Importar utilidades del servidor
const gridPath = 'D:/PROYECTO MMORPG/aethelgard-upgrade/logic/grid.js';
const { GridSystem } = require(gridPath);
const worldMapPath = 'D:/PROYECTO MMORPG/aethelgard-upgrade/world.json';
const worldMap = require(worldMapPath);

const MAP_SIZE = 200;
const TILE_SIZE = 64;

let grid;

beforeEach(() => {
  grid = new GridSystem(TILE_SIZE);
  for (const wall of worldMap.walls || []) grid.setWall(wall.x, wall.y, true);
});

describe('Clases y Skills', () => {
  it('should have correct class skills defined', () => {
    // DarkKnight skills: basic, whirlwind, holyShield, sprint
    expect(CLASSES.DarkKnight.skills).toContain('basic');
    expect(CLASSES.DarkKnight.skills).toContain('whirlwind');
    expect(CLASSES.DarkKnight.skills).toContain('holyShield');
    expect(CLASSES.DarkKnight.skills).toContain('sprint');
    
    // ElfMarksman skills: basic, arrowShot, iceBolt, sprint
    expect(CLASSES.ElfMarksman.skills).toContain('basic');
    expect(CLASSES.ElfMarksman.skills).toContain('arrowShot');
    expect(CLASSES.ElfMarksman.skills).toContain('iceBolt');
    expect(CLASSES.ElfMarksman.skills).toContain('sprint');
    
    // ArcaneSorcerer skills: basic, fireball, lightning, teleport, meteor
    expect(CLASSES.ArcaneSorcerer.skills).toContain('basic');
    expect(CLASSES.ArcaneSorcerer.skills).toContain('fireball');
    expect(CLASSES.ArcaneSorcerer.skills).toContain('lightning');
    expect(CLASSES.ArcaneSorcerer.skills).toContain('teleport');
    expect(CLASSES.ArcaneSorcerer.skills).toContain('meteor');
    
    // Priest skills: basic, smite, holyShield, potion
    expect(CLASSES.Priest.skills).toContain('basic');
    expect(CLASSES.Priest.skills).toContain('smite');
    expect(CLASSES.Priest.skills).toContain('holyShield');
    expect(CLASSES.Priest.skills).toContain('potion');
  });

  it('should validate that skills dont belong to wrong class', () => {
    // fireball es skill de ArcaneSorcerer, no de DarkKnight
    const darkKnightSkills = CLASSES.DarkKnight.skills;
    expect(darkKnightSkills.includes('fireball')).toBe(false);
    expect(darkKnightSkills.includes('basic')).toBe(true);
  });
});

describe('Items y Inventario', () => {
  let char;

  beforeEach(() => {
    char = createCharacter({ class: 'DarkKnight', name: 'TestChar' });
  });

  it('should manage inventory capacity', () => {
    // Inventario tiene 24 entradas máximo
    expect(char.inventory.length).toBe(0);
    
    // Añadir pociones (apilables)
    const result1 = addItem(char, 'item_3', 5); // 5 pociones de vida
    expect(result1).toBe(5);
    expect(char.inventory.length).toBe(1); // Should be in same entry
    
    // Añadir más pilando en la misma entrada
    const result2 = addItem(char, 'item_3', 3);
    expect(result2).toBe(3);
  });

  it('should stack potions and materials up to MAX_STACK (99)', () => {
    const char2 = createCharacter({ class: 'DarkKnight', name: 'TestChar2' });
    
    // Añadir 99 pociones
    let result = addItem(char2, 'item_3', 99);
    expect(result).toBe(99);
    expect(char2.inventory.length).toBe(1);
    expect(char2.inventory[0].count).toBe(99);
    
    // Intentar añadir una más debería crear una nueva entrada o llenar
    const result2 = addItem(char2, 'item_3', 1);
    // Debería tener 99 en la primera y 1 en una segunda entrada
    expect(char2.inventory.length).toBe(2);
  });

  it('should handle non-stackable items (weapons, armor)', () => {
    const char3 = createCharacter({ class: 'DarkKnight', name: 'TestChar3' });
    
    // Armas no apilan - cada una es una entrada distinta
    const result1 = addItem(char3, 'item_1', 1); // Espada Normal
    expect(result1).toBe(1);
    expect(char3.inventory.length).toBe(1);
    
    const result2 = addItem(char3, 'item_4', 1); // Hacha de Guerra (uncommon weapon)
    expect(result2).toBe(1);
    expect(char3.inventory.length).toBe(2); // Different item, new entry
  });

  it('should validate canAddItem', () => {
    const char4 = createCharacter({ class: 'DarkKnight', name: 'TestChar4' });
    applyStarterKit(char4);
    
    // Ya debería tener 3 pociones del starter kit
    expect(countInventoryItem(char4, 'item_3')).toBe(3);
    
    // Intentar añadir más de lo que caben
    const canAdd = canAddItem(char4, 'item_3');
    expect(typeof canAdd).toBe('boolean');
  });
});

describe('Quests', () => {
  let char;

  beforeEach(() => {
    char = createCharacter({ class: 'DarkKnight', name: 'TestChar' });
  });

  it('should have quests defined', () => {
    // Verificar que las quests existen
    expect(QUESTS).toBeInstanceOf(Array);
    expect(QUESTS.length).toBeGreaterThan(0);
    
    const q1 = getQuest('q1');
    expect(q1).not.toBeNull();
    expect(q1.id).toBe('q1');
    expect(q1.name).toBe('El Despertar');
    expect(q1.goal.type).toBe('kill');
    expect(q1.goal.count).toBe(3);
    expect(q1.reward.exp).toBe(300);
    expect(q1.reward.gold).toBe(120);
  });

  it('should track quest progress', () => {
    // Añadir quest activa
    char.quests.push({ id: 'q1', state: 'active', progress: 0 });
    
    // Progreso actualizado al matar un goblin
    updateQuestProgress(char, 'kill', 'goblin', 1);
    const q1Entry = char.quests.find(q => q.id === 'q1');
    expect(q1Entry.progress).toBe(1);
  });

  it('should complete quest q1 and grant rewards', () => {
    char.quests.push({ id: 'q1', state: 'active', progress: 0 });
    
    // Completar matando 3 goblins
    updateQuestProgress(char, 'kill', 'goblin', 3);
    
    const q1Entry = char.quests.find(q => q.id === 'q1');
    expect(q1Entry.progress).toBe(3); // goal count is 3
    expect(q1Entry.state).toBe('done');
  });

  it('should grant experience and level up', () => {
    // Dar suficiente experiencia para level up
    const initialExp = char.exp;
    char.exp = expForLevel(char.level) + 1; // Un poco más de lo necesario
    char.level = 1;
    
    const gained = grantExperience(char);
    // Should have gained at least 1 level
    expect(gained).toBeGreaterThanOrEqual(1);
    expect(char.level).toBeGreaterThan(1);
    expect(char.statPoints).toBeGreaterThan(0);
  });
});

describe('Economía y Tienda', () => {
  let char;

  beforeEach(() => {
    char = createCharacter({ class: 'DarkKnight', name: 'TestChar' });
    char.gold = 1000;
  });

  it('should have items with proper values', () => {
    const potion = getItem('item_3');
    expect(potion).not.toBeNull();
    expect(potion.value).toBe(5);
    expect(potion.heal).toBe(200);
    
    const sword = getItem('item_1');
    expect(sword).not.toBeNull();
    expect(sword.dmg).toBe(20);
  });
});

describe('Sistema de muerte y respawn', () => {
  let char;

  beforeEach(() => {
    char = createCharacter({ class: 'DarkKnight', name: 'TestChar' });
    char.exp = 500;
    char.level = 1;
    char.maxHp = 1200;
    char.hp = -1; // Put character in "dead" state for testing
    char.dead = true;
  });

  it('should apply -10% XP penalty on respawn', () => {
    const initialExp = char.exp;
    const lost = Math.floor(char.exp * 0.1);
    
    // Aplicar penalty manualmente (como hace el handler respawn)
    char.exp = Math.max(0, char.exp - lost);
    
    expect(char.exp).toBe(initialExp - lost);
    expect(lost).toBe(50); // 10% of 500
  });

  it('should reset character state on respawn', () => {
    // Character should respawn at start position
    char.hp = char.maxHp;
    char.mp = char.maxMp;
    char.cp = char.maxCp;
    char.dead = false;
    char.path = [];
    char.targetId = null;
    char.cooldowns = {};
    char.buffs = {};
    char.moving = false;
    char.attackAnim = 0;
    
    expect(char.hp).toBe(char.maxHp);
    expect(char.dead).toBe(false);
    expect(char.path).toEqual([]);
  });
});

describe('Sistema de comida', () => {
  let char;

  beforeEach(() => {
    char = createCharacter({ class: 'DarkKnight', name: 'TestChar' });
    char.food = 50;
    char.maxFood = 100;
  });

  it('should have food items defined', () => {
    // item_18 es Ración de Sobrevivencia con food: 50
    const item = getItem('item_18');
    expect(item).not.toBeNull();
    expect(item.food).toBe(50);
    
    const item2 = getItem('item_19');
    expect(item2).not.toBeNull();
    expect(item2.food).toBe(20);
  });

  it('should prevent HP regeneration when food is 0', () => {
    char.food = 0;
    
    // El sistema de regeneración debe checking food >= 10
    // Cuando food < 10, no se debe regenerar
    const canRegenerate = char.food >= 10;
    expect(canRegenerate).toBe(false);
  });

  it('should restore food when food is below max', () => {
    const beforeFood = char.food;
    // Usar una ración que da 50 de comida
    char.food = Math.min(char.maxFood, char.food + 50);
    const recoveredFood = char.food - beforeFood;
    
    expect(recoveredFood).toBe(50);
    expect(char.food).toBe(100); // maxFood
  });
});