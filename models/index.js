// Base de datos en memoria (Arreglos JavaScript)
const db = {
  users: [],
  characters: [],
  items: [
    { id: 'item_1', name: 'Espada Normal', type: 'weapon', dmg: 20, value: 10 },
    { id: 'item_2', name: 'Armadura Normal', type: 'armor', def: 10, value: 15 },
    { id: 'item_3', name: 'Poción de Vida', type: 'potion', heal: 100, value: 5 }
  ],
  npcs: [
    {
      id: 'npc_1',
      name: 'Elder Sage',
      sprite: 'sage.png',
      pos: { x: 10, y: 10 },
      dialog: {
        greeting: '¡Saludos, viajero! El mundo te espera.',
        questOffer: '¿Buscas la Espada Aeth? Encuéntrala en el Abismo.',
        profession: 'Las profesiones desbloquean habilidades épicas a nivel 40.'
      }
    }
  ],
  clans: []
};

// Utilidad para generar IDs únicos sencillos
const generateId = () => Math.random().toString(36).substring(2, 9);

// Métodos helper que imitan operaciones de DB
const User = {
  findOne: async (query) => db.users.find(u => u.username === query.username || u.id === query.id),
  create: async (data) => {
    const newUser = { id: generateId(), ...data };
    db.users.push(newUser);
    return newUser;
  }
};

const Character = {
  findOne: async (query) => {
    if (query.userId) return db.characters.find(c => c.userId === query.userId);
    if (query.name) return db.characters.find(c => c.name === query.name);
    return null;
  },
  findById: async (id) => db.characters.find(c => c.id === id),
  find: async () => db.characters,
  create: async (data) => {
    const newChar = {
      id: generateId(),
      level: 1,
      hp: 1000,
      mp: 300,
      exp: 0,
      blood: 0,
      deaths: 0,
      items: [],
      professions: [],
      clanId: null,
      ...data
    };
    db.characters.push(newChar);
    return newChar;
  }
};

const Item = {
  find: async () => db.items,
  findById: async (id) => db.items.find(i => i.id === id)
};

const NPC = {
  findById: async (id) => db.npcs.find(n => n.id === id)
};

module.exports = { User, Character, Item, NPC, db };