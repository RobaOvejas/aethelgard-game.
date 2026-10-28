const { Character } = require('../models');

const unlockProfession = async (characterId, professionName, requiredLevel) => {
  const char = await Character.findById(characterId);
  if (!char) throw new Error('Personaje no encontrado');

  if (char.level < requiredLevel) {
    throw new Error(`Requiere nivel ${requiredLevel}`);
  }

  const exists = char.professions.find(p => p.name === professionName);
  if (exists) return char;

  char.professions.push({ name: professionName, level: 0 });
  return char;
};

module.exports = { unlockProfession };