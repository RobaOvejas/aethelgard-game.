// Test del mapa de mazmorra con variable de entorno
process.env.DUNGEON_WORLD = '1';

// Limpiar cache de require
Object.keys(require.cache).forEach(key => {
  if (key.includes('aethelgard-upgrade')) delete require.cache[key];
});

const worldMap = require('./world.json');
console.log('World loaded (default):', worldMap.widthInTiles, 'x', worldMap.heightInTiles, 'walls:', worldMap.walls.length);

// Ahora probar con el dungeon world
delete require.cache;
const dungeonWorld = require('./dungeon_world_100.json');
console.log('Dungeon world loaded:', dungeonWorld.widthInTiles, 'x', dungeonWorld.heightInTiles, 'walls:', dungeonWorld.walls.length);
console.log('Start positions:', dungeonWorld.startPositions.length);
console.log('Boss room:', dungeonWorld.bossRoom ? 'Yes at (' + dungeonWorld.bossRoom.x + ', ' + dungeonWorld.bossRoom.y + ')' : 'No');