const socket = io();

// Elementos DOM
const authScreen = document.getElementById('auth-screen');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');
const btnToggle = document.getElementById('btn-toggle');
const btnSubmit = document.getElementById('btn-submit');
const classGroup = document.getElementById('class-select-group');
const uiHud = document.getElementById('ui-hud');
const chatLog = document.getElementById('chat-log');
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let isRegistering = false;
let myCharacter = null;
let worldPlayers = [];
const TILE_SIZE = 64;

// Ajustar tamaño del Canvas a la ventana
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Cambiar entre Login y Registro
btnToggle.addEventListener('click', () => {
  isRegistering = !isRegistering;
  if (isRegistering) {
    btnSubmit.innerText = 'Registrarse y Jugar';
    btnToggle.innerText = '¿Ya tienes cuenta? Inicia sesión';
    classGroup.classList.remove('hidden');
  } else {
    btnSubmit.innerText = 'Ingresar';
    btnToggle.innerText = '¿No tienes cuenta? Regístrate aquí';
    classGroup.classList.add('hidden');
  }
});

// Manejo del Formulario
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.innerText = '';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const selectedClass = document.getElementById('character-class').value;

  const endpoint = isRegistering ? '/api/register' : '/api/login';
  const bodyData = isRegistering 
    ? { username, password, class: selectedClass }
    : { username, password };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });

    const data = await res.json();
    if (!res.ok) {
      authError.innerText = data.message || 'Error en la petición';
      return;
    }

    // Conectar por WebSocket
    socket.emit('join', { username, class: selectedClass }, (response) => {
      if (response.success) {
        myCharacter = response.char;
        authScreen.classList.add('hidden');
        uiHud.classList.remove('hidden');
        chatLog.classList.remove('hidden');
        
        document.getElementById('hud-name').innerText = myCharacter.name;
        document.getElementById('hud-class').innerText = `(${myCharacter.class})`;
        
        logMessage(`Bienvenido a Aethelgard, ${myCharacter.name}! Usa W, A, S, D para moverte.`);
        requestAnimationFrame(gameLoop);
      } else {
        authError.innerText = response.message;
      }
    });

  } catch (err) {
    authError.innerText = 'Error de conexión con el servidor.';
  }
});

// Controles de movimiento
document.addEventListener('keydown', (e) => {
  if (!myCharacter) return;
  const key = e.key.toLowerCase();
  if (key === 'w' || key === 'arrowup') socket.emit('move', { dx: 0, dy: -1 });
  if (key === 's' || key === 'arrowdown') socket.emit('move', { dx: 0, dy: 1 });
  if (key === 'a' || key === 'arrowleft') socket.emit('move', { dx: -1, dy: 0 });
  if (key === 'd' || key === 'arrowright') socket.emit('move', { dx: 1, dy: 0 });
});

// Eventos de Socket
socket.on('updateWorld', (players) => {
  worldPlayers = players;
  const me = players.find(p => p.id === myCharacter._id || p.name === myCharacter.name);
  if (me) {
    myCharacter.gridX = me.gridX;
    myCharacter.gridY = me.gridY;
  }
});

socket.on('combatResult', (data) => {
  logMessage(`⚔️ Daño: ${data.damage} de ${data.attackerId}`);
});

function logMessage(msg) {
  const div = document.createElement('div');
  div.innerText = msg;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// Renderizado Loop (Game Engine 2D)
function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (myCharacter) {
    // Camara centrada en el jugador
    const offsetX = canvas.width / 2 - (myCharacter.gridX * TILE_SIZE + TILE_SIZE / 2);
    const offsetY = canvas.height / 2 - (myCharacter.gridY * TILE_SIZE + TILE_SIZE / 2);

    // Dibujar Rejilla / Suelo
    ctx.strokeStyle = '#1e1e28';
    ctx.lineWidth = 1;
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const posX = x * TILE_SIZE + offsetX;
        const posY = y * TILE_SIZE + offsetY;
        ctx.strokeRect(posX, posY, TILE_SIZE, TILE_SIZE);
      }
    }

    // Dibujar Jugadores
    worldPlayers.forEach(p => {
      const posX = p.gridX * TILE_SIZE + offsetX;
      const posY = p.gridY * TILE_SIZE + offsetY;

      // Cuerpo del Personaje
      ctx.fillStyle = p.name === myCharacter.name ? '#f0a500' : '#457b9d';
      ctx.beginPath();
      ctx.arc(posX + TILE_SIZE / 2, posY + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.stroke();

      // Nombre y Nivel
      ctx.fillStyle = '#fff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`${p.name} (Lvl ${p.level || 1})`, posX + TILE_SIZE / 2, posY - 8);
    });
  }

  requestAnimationFrame(gameLoop);
}