require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const { User, Character, NPC } = require('./models');
const Grid = require('./logic/grid');
const Combat = require('./logic/combat');

const worldGrid = new Grid(64);
const worldMap = require('./world.json');
worldMap.walls.forEach(w => worldGrid.setWall(w.x, w.y, true));

// ==========================================
// SISTEMA DE MONSTRUOS Y BOSSES (PvE)
// ==========================================
let monsters = [
  // Goblins
  { id: 'm1', name: 'Goblin Salvaje', type: 'goblin', gridX: 5, gridY: 5, hp: 120, maxHp: 120, dmg: 15, aggroRange: 5, spawnX: 5, spawnY: 5, diedAt: 0 },
  { id: 'm2', name: 'Goblin Salvaje', type: 'goblin', gridX: 8, gridY: 3, hp: 120, maxHp: 120, dmg: 15, aggroRange: 5, spawnX: 8, spawnY: 3, diedAt: 0 },
  // Esqueletos
  { id: 'm3', name: 'Guerrero Esqueleto', type: 'skeleton', gridX: 12, gridY: 12, hp: 250, maxHp: 250, dmg: 30, aggroRange: 6, spawnX: 12, spawnY: 12, diedAt: 0 },
  { id: 'm4', name: 'Guerrero Esqueleto', type: 'skeleton', gridX: 15, gridY: 10, hp: 250, maxHp: 250, dmg: 30, aggroRange: 6, spawnX: 15, spawnY: 10, diedAt: 0 },
  // BOSS
  { id: 'm_boss', name: 'LORD KUNDUN (BOSS)', type: 'boss', gridX: 18, gridY: 18, hp: 1500, maxHp: 1500, dmg: 70, aggroRange: 8, spawnX: 18, spawnY: 18, diedAt: 0 }
];

// Bucle de Inteligencia Artificial del Servidor (Cada 800ms)
setInterval(async () => {
  const allChars = await Character.find();
  const now = Date.now();

  monsters.forEach(m => {
    // Respawn después de 12 segundos si murió
    if (m.hp <= 0) {
      if (now - m.diedAt > 12000) {
        m.hp = m.maxHp;
        m.gridX = m.spawnX;
        m.gridY = m.spawnY;
      }
      return;
    }

    // Buscar jugador más cercano dentro del rango de aggro
    let target = null;
    let minDistance = 999;

    allChars.forEach(c => {
      if (c.hp > 0) {
        const dist = Math.hypot(c.gridX - m.gridX, c.gridY - m.gridY);
        if (dist <= m.aggroRange && dist < minDistance) {
          minDistance = dist;
          target = c;
        }
      }
    });

    if (target) {
      // Si está adyacente (a 1 casilla), ATACA
      if (minDistance <= 1.5) {
        target.hp = Math.max(0, target.hp - m.dmg);
        io.emit('combatResult', {
          attackerName: m.name,
          targetId: target.id,
          targetName: target.name,
          damage: m.dmg,
          targetHp: target.hp
        });
      } else {
        // PERSEGUIR al jugador
        const dx = Math.sign(target.gridX - m.gridX);
        const dy = Math.sign(target.gridY - m.gridY);
        
        if (dx !== 0 && !worldGrid.isWall(m.gridX + dx, m.gridY)) {
          m.gridX += dx;
        } else if (dy !== 0 && !worldGrid.isWall(m.gridX, m.gridY + dy)) {
          m.gridY += dy;
        }
      }
    } else {
      // Movimiento aleatorio de patrulla
      if (Math.random() < 0.25) {
        const rDx = Math.floor(Math.random() * 3) - 1;
        const rDy = Math.floor(Math.random() * 3) - 1;
        if (!worldGrid.isWall(m.gridX + rDx, m.gridY + rDy)) {
          m.gridX = Math.max(0, Math.min(30, m.gridX + rDx));
          m.gridY = Math.max(0, Math.min(30, m.gridY + rDy));
        }
      }
    }
  });

  // Emitir estado actualizado del mundo (Jugadores + Monstruos)
  io.emit('updateWorld', {
    players: allChars.map(c => ({
      id: c.id, name: c.name, class: c.class, gridX: c.gridX, gridY: c.gridY, hp: c.hp, maxHp: 1000, mp: c.mp, level: c.level
    })),
    monsters: monsters.filter(m => m.hp > 0)
  });
}, 800);

// ==========================================
// ENDPOINTS REST & SOCKETS
// ==========================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ message: 'Credenciales incorrectas' });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ message: 'Credenciales incorrectas' });
  res.json({ userId: user.id });
});

app.post('/api/register', async (req, res) => {
  const { username, password, class: cls } = req.body;
  const existing = await User.findOne({ username });
  if (existing) return res.status(400).json({ message: 'El usuario ya existe' });

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);
  const user = await User.create({ username, passwordHash: hash });

  const startPos = worldMap.startPositions.find(p => p.class === cls) || { x: 2, y: 2 };
  const character = await Character.create({
    userId: user.id, name: username, class: cls, gridX: startPos.x, gridY: startPos.y,
    stats: { str: 20, dex: 20, intel: 20, vit: 20 }
  });

  res.status(201).json({ userId: user.id, characterId: character.id });
});

const charSockets = new Map();

io.on('connection', (socket) => {
  socket.on('join', async (payload, callback) => {
    const { username } = payload;
    const user = await User.findOne({ username });
    if (!user) return callback({ success: false, message: 'Usuario no encontrado' });
    const char = await Character.findOne({ userId: user.id });
    if (!char) return callback({ success: false, message: 'Personaje no encontrado' });

    charSockets.set(char.id, socket);
    socket.data.characterId = char.id;
    callback({ success: true, char });
  });

  socket.on('move', async (payload) => {
    const { dx, dy } = payload;
    const char = await Character.findById(socket.data.characterId);
    if (!char || char.hp <= 0) return;

    const result = worldGrid.tryMove(char, dx, dy);
    if (result.allowed) {
      char.gridX = result.newX;
      char.gridY = result.newY;
    }
  });

  // Ataque del Jugador a Monstruo o Jugador
  socket.on('attack', async (payload) => {
    const { targetId, skillType } = payload;
    const attacker = await Character.findById(socket.data.characterId);
    if (!attacker || attacker.hp <= 0) return;

    // Buscar si el objetivo es un Monstruo
    const monsterTarget = monsters.find(m => m.id === targetId && m.hp > 0);
    if (monsterTarget) {
      const dmg = Math.floor(Math.random() * 40) + 30;
      monsterTarget.hp = Math.max(0, monsterTarget.hp - dmg);

      if (monsterTarget.hp <= 0) {
        monsterTarget.diedAt = Date.now();
        attacker.exp += 150; // Recompensa de experiencia
      }

      io.emit('combatResult', {
        attackerName: attacker.name,
        targetId: monsterTarget.id,
        targetName: monsterTarget.name,
        damage: dmg,
        skillType: skillType || 'physical',
        targetHp: monsterTarget.hp
      });
    }
  });

  socket.on('disconnect', () => {
    charSockets.delete(socket.data.characterId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`Servidor de Aethelgard Activo en http://localhost:${PORT}`);
  console.log(`================================================`);
});