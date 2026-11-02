// Test script para el sistema de crafting
const fs = require('fs');
const path = require('path');

// Ruta absoluta al server.js
const serverPath = 'D:/PROYECTO MMORPG/aethelgard-upgrade/server.js';
const serverContent = fs.readFileSync(serverPath, 'utf8');

// Verificar que RECIPES existe
if (serverContent.includes('const RECIPES')) {
  console.log('✅ System RECIPES defined in server.js');
} else {
  console.log('❌ System RECIPES NOT found in server.js');
}

// Verificar que hay handlers de craft
if (serverContent.includes("registerSocketHandler(socket, 'craft'")) {
  console.log('✅ Craft socket handler registered');
} else {
  console.log('❌ Craft socket handler NOT registered');
}

// Verificar recetas específicas
const recipesToCheck = ['copper_nugget_to_lamina', 'copper_lamina_to_rod', 'wood_to_planks', 'cloth_to_bandage'];
recipesToCheck.forEach(recipeId => {
  if (serverContent.includes(recipeId)) {
    console.log(`✅ Recipe '${recipeId}' found`);
  } else {
    console.log(`❌ Recipe '${recipeId}' NOT found`);
  }
});

// Verificar items 20-37
const itemRange = serverContent.match(/item_(\d+):/g);
if (itemRange) {
  const itemsInRange = itemRange.filter(i => {
    const num = parseInt(i.match(/item_(\d+)/)[1]);
    return num >= 20 && num <= 37;
  });
  console.log(`✅ Items 20-37 found: ${itemsInRange.length} items`);
} else {
  console.log('❌ Items pattern not found');
}

console.log('\n--- Test de recetas ---');
// Verificar estructura de recetas
const recipeMatch = serverContent.match(/const RECIPES = \{([\s\S]*)\};/);
if (recipeMatch) {
  const recipeSection = recipeMatch[1];
  const recipeIds = recipeSection.match(/(\w+):/g) || [];
  console.log(`Recetas encontradas: ${recipeIds.length}`);
  console.log('Ejemplos:', recipeIds.slice(0, 4).map(r => r.replace(':', '')));
}

console.log('\n--- Test completado ---');