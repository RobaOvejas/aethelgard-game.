class GridSystem {
  constructor(tileSize) {
    this.tileSize = tileSize;
    this.walls = new Set();
  }

  setWall(x, y, isWall) {
    const key = `${x},${y}`;
    if (isWall) this.walls.add(key);
    else this.walls.delete(key);
  }

  isWall(x, y) {
    return this.walls.has(`${x},${y}`);
  }

  tryMove(character, dx, dy) {
    const newX = character.gridX + dx;
    const newY = character.gridY + dy;

    if (newX < 0 || newY < 0 || newX >= 200 || newY >= 200) {
      return { allowed: false, reason: 'outOfBounds' };
    }
    if (this.isWall(newX, newY)) {
      return { allowed: false, reason: 'blockedByWall' };
    }

    return { allowed: true, newX, newY };
  }
}

module.exports = GridSystem;
