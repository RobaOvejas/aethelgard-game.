const computeDamage = (attacker, target, spellId) => {
  const base = Math.floor(Math.random() * 30) + 10;
  const statBonus = attacker.stats.intel || 0;
  const weaponBonus = attacker.items.find(i => i.slot === 'weapon')?.enchant || 0;
  const result = base + statBonus + weaponBonus;

  let reduction = 0;
  if (spellId === 'fireball') reduction = target.stats.vit || 0;
  else if (spellId === 'icebolt') reduction = target.stats.dex || 0;
  else if (spellId === 'lightning') reduction = target.stats.intel || 0;

  const final = Math.max(1, result - reduction);
  return { damage: final, critical: result > 80, resisted: final < 5 };
};

module.exports = { computeDamage };