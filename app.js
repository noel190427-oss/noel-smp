let socket = null;
let currentPlayers = [];
let currentBans = [];
let currentAcAlerts = [];
let selectedPlayerForAction = null;
let authToken = localStorage.getItem('mc_admin_token') || sessionStorage.getItem('mc_admin_token') || null;

// Initial Setup
document.addEventListener('DOMContentLoaded', async () => {
  if (authToken) {
    const isValid = await verifyToken(authToken);
    if (isValid) {
      showDashboard();
      return;
    }
  }
  showLogin();
});

// AUTHENTICATION & SWITCHER
function switchAuthMode(mode) {
  const isLogin = mode === 'login';
  document.getElementById('tabBtnLogin').classList.toggle('active', isLogin);
  document.getElementById('tabBtnRegister').classList.toggle('active', !isLogin);
  document.getElementById('loginForm').classList.toggle('hidden', !isLogin);
  document.getElementById('registerForm').classList.toggle('hidden', isLogin);

  document.getElementById('authTitle').textContent = isLogin ? 'Admin & Freunde Login' : 'Neues Konto registrieren';
  document.getElementById('authSubtitle').textContent = isLogin 
    ? 'Melde dich an, um den Minecraft Server zu steuern.' 
    : 'Erstelle einen Zugang für dich oder einen Freund.';

  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('regError').classList.add('hidden');
}

async function verifyToken(token) {
  try {
    const res = await fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.user) {
      document.getElementById('userEmailBadge').textContent = data.user.email || 'Admin';
      return true;
    }
  } catch (e) {}
  localStorage.removeItem('mc_admin_token');
  sessionStorage.removeItem('mc_admin_token');
  authToken = null;
  return false;
}

// 1. Handle Login
async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const rememberMe = document.getElementById('rememberMe').checked;
  const errorBox = document.getElementById('loginError');

  errorBox.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe })
    });
    const data = await res.json();

    if (data.success && data.token) {
      authToken = data.token;
      if (rememberMe) {
        localStorage.setItem('mc_admin_token', authToken);
      } else {
        sessionStorage.setItem('mc_admin_token', authToken);
      }
      document.getElementById('userEmailBadge').textContent = data.email || email;
      showDashboard();
    } else {
      errorBox.textContent = data.error || 'Login fehlgeschlagen.';
      errorBox.classList.remove('hidden');
    }
  } catch (err) {
    errorBox.textContent = 'Verbindungsfehler: ' + err.message;
    errorBox.classList.remove('hidden');
  }
}

// 2. Handle Register (for friends/admins)
async function handleRegister(event) {
  event.preventDefault();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const passwordConfirm = document.getElementById('regPasswordConfirm').value;
  const rememberMe = document.getElementById('regRememberMe').checked;
  const errorBox = document.getElementById('regError');

  errorBox.classList.add('hidden');

  if (password !== passwordConfirm) {
    errorBox.textContent = 'Die Passwörter stimmen nicht überein!';
    errorBox.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe })
    });
    const data = await res.json();

    if (data.success && data.token) {
      authToken = data.token;
      if (rememberMe) {
        localStorage.setItem('mc_admin_token', authToken);
      } else {
        sessionStorage.setItem('mc_admin_token', authToken);
      }
      document.getElementById('userEmailBadge').textContent = data.email || email;
      showDashboard();
    } else {
      errorBox.textContent = data.error || 'Registrierung fehlgeschlagen.';
      errorBox.classList.remove('hidden');
    }
  } catch (err) {
    errorBox.textContent = 'Verbindungsfehler: ' + err.message;
    errorBox.classList.remove('hidden');
  }
}

async function handleLogout() {
  if (authToken) {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
  }
  localStorage.removeItem('mc_admin_token');
  sessionStorage.removeItem('mc_admin_token');
  authToken = null;
  if (socket) {
    socket.close();
  }
  showLogin();
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('dashboardApp').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboardApp').classList.remove('hidden');
  connectWebSocket();
  fetchInitialStatus();
}

// Authenticated Fetch Helper
async function authFetch(url, options = {}) {
  const headers = options.headers || {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 || response.status === 403) {
    handleLogout();
    throw new Error('Sitzung abgelaufen. Bitte neu einloggen.');
  }
  return response;
}

// WEBSOCKET
function connectWebSocket() {
  if (!authToken) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}?token=${encodeURIComponent(authToken)}`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('[WS] Authenticated & Connected to Server Dashboard');
  };

  socket.onmessage = (event) => {
    try {
      const { type, data } = JSON.parse(event.data);
      handleWSEvent(type, data);
    } catch (e) {
      console.error('[WS] Parse error', e);
    }
  };

  socket.onclose = () => {
    if (authToken) {
      console.log('[WS] Disconnected. Reconnecting in 2s...');
      setTimeout(connectWebSocket, 2000);
    }
  };
}

async function fetchInitialStatus() {
  try {
    const res = await authFetch('/api/status');
    const data = await res.json();
    updateUIWithStatus(data);
    if (data.bans) updateBansTable(data.bans);
    if (data.antiCheatAlerts) updateAcTable(data.antiCheatAlerts);
  } catch (e) {
    console.error('Fetch status failed', e);
  }
}

function handleWSEvent(type, data) {
  switch (type) {
    case 'init':
      updateUIWithStatus(data.status);
      if (data.logs) {
        data.logs.forEach(addConsoleLog);
      }
      if (data.bans) {
        updateBansTable(data.bans);
      }
      if (data.antiCheatAlerts) {
        updateAcTable(data.antiCheatAlerts);
      }
      break;

    case 'status':
      updateUIWithStatus(data);
      break;

    case 'log':
      addConsoleLog(data);
      break;

    case 'anticheat-alert':
      currentAcAlerts.unshift(data);
      updateAcTable(currentAcAlerts);
      addConsoleLog(`⚠️ [AntiCheat Alert] ${data.username} wurde verdächtigt: ${data.check}`);
      break;

    case 'player-join':
      addConsoleLog(`✨ [System] ${data.username} (${data.type}) ist beigetreten.`);
      fetchInitialStatus();
      break;

    case 'player-leave':
      addConsoleLog(`🚪 [System] ${data.username} hat den Server verlassen.`);
      fetchInitialStatus();
      break;

    case 'update-available':
      showUpdateNotice(data);
      break;

    case 'update-progress':
      addConsoleLog(`[AutoUpdater] ${data}`);
      break;

    case 'update-success':
      addConsoleLog(`✅ [AutoUpdater] ${data}`);
      fetchInitialStatus();
      break;
  }
}

function updateUIWithStatus(statusData) {
  if (!statusData) return;

  const status = statusData.status || 'stopped';
  const badge = document.getElementById('serverStatusBadge');
  const statusText = document.getElementById('statusText');
  const emergencyBanner = document.getElementById('emergencyBanner');

  badge.className = `status-badge status-${status}`;
  statusText.textContent = 
    status === 'running' ? 'Online' : 
    status === 'starting' ? 'Startet...' : 
    status === 'updating' ? 'Aktualisiert...' : 
    status === 'emergency_stopped' ? '🚨 NOT-AUS' : 'Offline';

  // Emergency banner
  if (status === 'emergency_stopped' || statusData.emergencyLocked) {
    emergencyBanner.classList.remove('hidden');
  } else {
    emergencyBanner.classList.add('hidden');
  }

  // 24/7 Watchdog status
  const toggle247 = document.getElementById('toggle247');
  const metric247 = document.getElementById('metric247Status');
  if (toggle247) toggle247.checked = statusData.enable247 ?? true;
  if (metric247) {
    metric247.textContent = statusData.enable247 ? '24/7 Aktiv' : 'Manuell';
    metric247.className = statusData.enable247 ? 'metric-val text-success' : 'metric-val text-muted';
  }

  // Metrics
  const pCount = statusData.playerCount || 0;
  document.getElementById('metricPlayerCount').textContent = `${pCount} / ∞`;
  document.getElementById('tabPlayerBadge').textContent = pCount;

  if (statusData.players) {
    currentPlayers = statusData.players;
    renderPlayersTable(currentPlayers);
  }

  // Version Meta
  if (statusData.meta) {
    const ver = statusData.meta.minecraftVersion || '1.21.x';
    document.getElementById('paperVerLabel').textContent = `${ver} (Build #${statusData.meta.serverBuild || '2568'})`;
    document.getElementById('geyserVerLabel').textContent = `Build #${statusData.meta.geyserBuild || '1249'}`;
    document.getElementById('grimVerLabel').textContent = statusData.meta.grimAcBuild || '2.3.74 (Aktiv)';

    const toggle = document.getElementById('autoUpdateToggle');
    if (toggle) toggle.checked = statusData.meta.autoUpdateEnabled ?? true;
  }

  // Controls Disabled State
  document.getElementById('btnStart').disabled = status === 'running' || status === 'starting';
  document.getElementById('btnRestart').disabled = status !== 'running';
  document.getElementById('btnStop').disabled = status === 'stopped' || status === 'emergency_stopped';
}

function renderPlayersTable(players) {
  const tbody = document.getElementById('playerTableBody');
  if (!players || players.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">
          <div class="empty-state">
            <span class="empty-icon">🎮</span>
            <p>Aktuell sind keine Spieler online.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = players.map(p => {
    const clean = p.cleanName || p.username;
    const isBedrock = p.type === 'Bedrock';
    const avatarUrl = isBedrock 
      ? 'https://mc-heads.net/avatar/Steve/48' 
      : `https://mc-heads.net/avatar/${clean}/48`;

    return `
      <tr>
        <td>
          <img src="${avatarUrl}" alt="${p.username}" class="avatar-img" onerror="this.src='https://mc-heads.net/avatar/Steve/48'">
        </td>
        <td>
          <strong>${p.username}</strong>
        </td>
        <td>
          <span class="platform-badge ${p.isOp ? 'badge-java' : 'badge-bedrock'}" style="${p.isOp ? 'background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b;' : ''}">
            ${p.isOp ? '👑 Owner / OP' : '👤 Spieler'}
          </span>
        </td>
        <td>
          <span class="platform-badge ${isBedrock ? 'badge-bedrock' : 'badge-java'}">
            ${isBedrock ? '📱 Bedrock' : '💻 Java'}
          </span>
        </td>
        <td class="text-muted">${p.ip || '127.0.0.1'}</td>
        <td style="text-align: right; display: flex; gap: 4px; justify-content: flex-end; flex-wrap: wrap;">
          <button class="btn btn-sm ${p.isOp ? 'btn-secondary' : 'btn-warning'}" onclick="toggleOp('${p.username}', ${p.isOp})">
            ${p.isOp ? '🔻 OP weg' : '👑 OP geben'}
          </button>
          <button class="btn btn-sm btn-info" style="background: #0ea5e9; color: white;" onclick="openNametagModal('${p.username}')">🏷️ Nametag</button>
          <button class="btn btn-sm btn-primary" onclick="openGamemodeModal('${p.username}')">🎮 Modus</button>
          <button class="btn btn-sm btn-success" onclick="openCoinsModal('${p.username}')">💰 Coins</button>
          <button class="btn btn-sm btn-warning" onclick="openKickModal('${p.username}')">⚠️ Kick</button>
          <button class="btn btn-sm btn-danger" onclick="openBanModal('${p.username}')">🚫 Ban</button>
        </td>
      </tr>
    `;
  }).join('');
}

function updateBansTable(bans) {
  currentBans = bans || [];
  document.getElementById('tabBanBadge').textContent = currentBans.length;

  const tbody = document.getElementById('banTableBody');
  if (currentBans.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">
          <div class="empty-state">
            <span class="empty-icon">🛡️</span>
            <p>Keine gebannten Spieler vorhanden.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = currentBans.map(b => `
    <tr>
      <td><strong>${b.name}</strong></td>
      <td>${b.reason || 'Kein Grund angegeben'}</td>
      <td class="text-muted">${b.created || 'N/A'}</td>
      <td class="text-muted">${b.source || 'Server-Admin'}</td>
      <td style="text-align: right;">
        <button class="btn btn-sm btn-secondary" onclick="unbanPlayer('${b.name}')">Entbannen</button>
      </td>
    </tr>
  `).join('');
}

function updateAcTable(alerts) {
  currentAcAlerts = alerts || [];
  document.getElementById('tabAcBadge').textContent = currentAcAlerts.length;

  const tbody = document.getElementById('acTableBody');
  if (currentAcAlerts.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">
          <div class="empty-state">
            <span class="empty-icon">✨</span>
            <p>Keine verdächtigen Aktivitäten erkannt. Alle Spieler spielen fair!</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = currentAcAlerts.map(a => `
    <tr>
      <td class="text-muted">${a.timestamp || 'Gerade eben'}</td>
      <td><strong>${a.username}</strong></td>
      <td><span class="text-danger font-mono font-bold">${a.check}</span></td>
      <td><span class="platform-badge badge-bedrock">⚠️ Flagged</span></td>
      <td style="text-align: right;">
        <button class="btn btn-sm btn-warning" onclick="openKickModal('${a.username}')">⚠️ Kicken</button>
        <button class="btn btn-sm btn-danger" onclick="openBanModal('${a.username}')">🚫 Bannen</button>
      </td>
    </tr>
  `).join('');
}

function clearAcAlerts() {
  currentAcAlerts = [];
  updateAcTable([]);
}

function addConsoleLog(line) {
  const box = document.getElementById('consoleOutput');
  const p = document.createElement('div');
  p.textContent = line;
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

function clearConsoleLogs() {
  document.getElementById('consoleOutput').innerHTML = '';
}

// Server Lifecycle Actions
async function startServer() {
  await authFetch('/api/server/start', { method: 'POST' });
}

async function stopServer() {
  await authFetch('/api/server/stop', { method: 'POST' });
}

async function restartServer() {
  await authFetch('/api/server/restart', { method: 'POST' });
}

// RANK & OP TOGGLE
async function toggleOp(username, currentIsOp) {
  const willBeOp = !currentIsOp;
  const actionText = willBeOp ? 'zum Admin / Owner ernennen' : 'die Admin-Rechte entziehen';
  if (!confirm(`Möchtest du "${username}" wirklich ${actionText}?`)) return;

  try {
    await authFetch('/api/players/op', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, isOp: willBeOp })
    });
    fetchInitialStatus();
  } catch (e) {
    alert('Fehler beim Ändern der Rechte: ' + e.message);
  }
}

// GAMEMODE
function openGamemodeModal(username) {
  selectedPlayerForAction = username;
  document.getElementById('gmPlayerName').textContent = username;
  document.getElementById('modalGamemode').classList.remove('hidden');
}

async function confirmGamemode() {
  if (!selectedPlayerForAction) return;
  const mode = document.getElementById('gmSelect').value;
  try {
    await authFetch('/api/players/gamemode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: selectedPlayerForAction, mode })
    });
    closeModal('modalGamemode');
  } catch (e) {
    alert('Fehler beim Spielmodus: ' + e.message);
  }
}

// GIVE COINS
function openCoinsModal(username) {
  selectedPlayerForAction = username;
  document.getElementById('coinsPlayerName').textContent = username;
  document.getElementById('modalCoins').classList.remove('hidden');
}

async function confirmGiveCoins() {
  if (!selectedPlayerForAction) return;
  const amount = document.getElementById('coinsAmountInput').value;
  try {
    await authFetch('/api/players/coins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: selectedPlayerForAction, amount })
    });
    closeModal('modalCoins');
    alert(`Erfolgreich ${amount} Coins an ${selectedPlayerForAction} überwiesen!`);
  } catch (e) {
    alert('Fehler beim Überweisen: ' + e.message);
  }
}

async function giveQuickCoins() {
  const player = document.getElementById('quickCoinPlayer').value.trim();
  const amount = document.getElementById('quickCoinAmount').value;
  if (!player) return alert('Bitte einen Spielernamen eingeben!');
  try {
    await authFetch('/api/players/coins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: player, amount })
    });
    alert(`Erfolgreich ${amount} Coins an ${player} überwiesen!`);
  } catch (e) {
    alert('Fehler beim Überweisen: ' + e.message);
  }
}

// EMERGENCY NOT-AUS
function openEmergencyModal() {
  document.getElementById('modalEmergency').classList.remove('hidden');
}

async function confirmEmergencyKill() {
  const reason = document.getElementById('emergencyReasonInput').value;
  try {
    await authFetch('/api/server/emergency-kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    closeModal('modalEmergency');
    fetchInitialStatus();
  } catch (e) {
    alert('Fehler beim Auslösen des Not-Aus: ' + e.message);
  }
}

async function toggle247Mode(enabled) {
  await authFetch('/api/server/247-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
}

function openKickModal(username) {
  selectedPlayerForAction = username;
  document.getElementById('kickPlayerName').textContent = username;
  document.getElementById('modalKick').classList.remove('hidden');
}

function openBanModal(username) {
  selectedPlayerForAction = username;
  document.getElementById('banPlayerName').textContent = username;
  document.getElementById('modalBan').classList.remove('hidden');
}

function openCustomBanModal() {
  const name = prompt('Welchen Spielernamen möchtest du bannen?');
  if (name) {
    openBanModal(name.trim());
  }
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  selectedPlayerForAction = null;
}

async function confirmKick() {
  if (!selectedPlayerForAction) return;
  const reason = document.getElementById('kickReasonInput').value;
  try {
    await authFetch('/api/players/kick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: selectedPlayerForAction, reason })
    });
    closeModal('modalKick');
  } catch (e) {
    alert('Fehler beim Kicken: ' + e.message);
  }
}

async function confirmBan() {
  if (!selectedPlayerForAction) return;
  const reason = document.getElementById('banReasonInput').value;
  try {
    await authFetch('/api/players/ban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: selectedPlayerForAction, reason })
    });
    closeModal('modalBan');
    fetchInitialStatus();
  } catch (e) {
    alert('Fehler beim Bannen: ' + e.message);
  }
}

async function unbanPlayer(username) {
  if (!confirm(`Möchtest du ${username} wirklich entbannen?`)) return;
  try {
    await authFetch('/api/players/unban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    fetchInitialStatus();
  } catch (e) {
    alert('Fehler beim Entbannen: ' + e.message);
  }
}

async function sendCommand() {
  const input = document.getElementById('cmdInput');
  const cmd = input.value.trim();
  if (!cmd) return;
  input.value = '';
  await authFetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: cmd })
  });
}

async function sendBroadcast() {
  const input = document.getElementById('quickMsgInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  await authFetch('/api/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg })
  });
}

async function checkForUpdates() {
  addConsoleLog('🔍 Prüfe auf Updates...');
  const res = await authFetch('/api/update/check', { method: 'POST' });
  const data = await res.json();
  if (data.check && data.check.hasAnyUpdate) {
    showUpdateNotice(data.check);
    alert('Ein neues Update ist verfügbar!');
  } else {
    alert('Alles auf dem neuesten Stand!');
  }
}

async function applyUpdate(force = false) {
  if (!confirm('Soll das Update jetzt durchgeführt werden? (Der Server wird bei Bedarf kurz neu gestartet)')) return;
  addConsoleLog('⚡ Starte Update-Installation...');
  await authFetch('/api/update/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force })
  });
}

async function toggleAutoUpdate(enabled) {
  await authFetch('/api/update/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoUpdateEnabled: enabled })
  });
}

function showUpdateNotice(check) {
  const box = document.getElementById('updateNoticeBox');
  if (box) {
    box.classList.remove('hidden');
    document.getElementById('updateNoticeDesc').textContent = 
      `Neues Update für Minecraft/Plugins erkannt! Klicke auf 'Jetzt aktualisieren'.`;
  }
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

  event.currentTarget.classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');
}

// --- NAMETAG & PRÄFIX MANAGEMENT ---
let selectedNametagPlayer = '';

function openNametagModal(username) {
  selectedNametagPlayer = username;
  document.getElementById('modalNametagPlayer').textContent = username;
  document.getElementById('modalTagInput').value = '&8[&6&l👑 OWNER&8] &e';
  updateTagPreview('modalTagInput', 'modalTagPreview');
  openModal('modalNametag');
}

function setPresetTag(inputId, tag) {
  const input = document.getElementById(inputId);
  if (input) {
    input.value = tag;
    const previewId = inputId === 'modalTagInput' ? 'modalTagPreview' : 'quickTagPreview';
    updateTagPreview(inputId, previewId);
  }
}

function insertColorCode(inputId, code) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const val = input.value;
  input.value = val.substring(0, start) + code + val.substring(end);
  input.focus();
  input.setSelectionRange(start + code.length, start + code.length);
  const previewId = inputId === 'modalTagInput' ? 'modalTagPreview' : 'quickTagPreview';
  updateTagPreview(inputId, previewId);
}

function parseMinecraftColors(text) {
  if (!text) return '<span>Spieler</span>';
  const colorMap = {
    '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa',
    '4': '#aa0000', '5': '#aa00aa', '6': '#ffaa00', '7': '#aaaaaa',
    '8': '#555555', '9': '#5555ff', 'a': '#55ff55', 'b': '#55ffff',
    'c': '#ff5555', 'd': '#ff55ff', 'e': '#ffff55', 'f': '#ffffff'
  };

  let html = '';
  let currentColor = '#ffffff';
  let isBold = false;
  let isItalic = false;

  for (let i = 0; i < text.length; i++) {
    if ((text[i] === '&' || text[i] === '§') && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      if (colorMap[code]) {
        currentColor = colorMap[code];
        isBold = false;
        isItalic = false;
      } else if (code === 'l') {
        isBold = true;
      } else if (code === 'o') {
        isItalic = true;
      } else if (code === 'r') {
        currentColor = '#ffffff';
        isBold = false;
        isItalic = false;
      }
      i++;
      continue;
    }
    const style = `color: ${currentColor}; font-weight: ${isBold ? 'bold' : 'normal'}; font-style: ${isItalic ? 'italic' : 'normal'};`;
    html += `<span style="${style}">${text[i]}</span>`;
  }
  return html + `<span style="color: #ffffff;"> Spieler</span>`;
}

function updateTagPreview(inputId, previewId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (input && preview) {
    preview.innerHTML = parseMinecraftColors(input.value || '&8[&7SPIELER&8] &7');
  }
}

async function confirmModalTag() {
  const tag = document.getElementById('modalTagInput').value.trim();
  if (!selectedNametagPlayer) return;
  try {
    const res = await authFetch('/api/players/nametag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: selectedNametagPlayer, nametag: tag })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('modalNametag');
      addConsoleLog(`🏷️ Nametag für "${selectedNametagPlayer}" erfolgreich gesetzt.`);
      alert(`Nametag für "${selectedNametagPlayer}" wurde im Spiel angewendet!`);
    } else {
      alert('Fehler: ' + data.error);
    }
  } catch (e) {
    alert('Fehler: ' + e.message);
  }
}

async function confirmResetModalTag() {
  if (!selectedNametagPlayer) return;
  try {
    await authFetch('/api/players/nametag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: selectedNametagPlayer, nametag: '' })
    });
    closeModal('modalNametag');
    addConsoleLog(`🏷️ Nametag für "${selectedNametagPlayer}" zurückgesetzt.`);
    alert(`Nametag für "${selectedNametagPlayer}" zurückgesetzt.`);
  } catch (e) {
    alert('Fehler: ' + e.message);
  }
}

async function applyQuickNametag() {
  const player = document.getElementById('quickTagPlayer').value.trim();
  const tag = document.getElementById('quickTagInput').value.trim();
  if (!player) {
    alert('Bitte gib einen Spielernamen ein.');
    return;
  }
  try {
    const res = await authFetch('/api/players/nametag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: player, nametag: tag })
    });
    const data = await res.json();
    if (data.success) {
      addConsoleLog(`🏷️ Nametag für "${player}" angewendet: ${tag}`);
      alert(`Nametag für "${player}" erfolgreich im Spiel gesetzt!`);
    } else {
      alert('Fehler: ' + data.error);
    }
  } catch (e) {
    alert('Fehler: ' + e.message);
  }
}

async function resetQuickNametag() {
  const player = document.getElementById('quickTagPlayer').value.trim();
  if (!player) {
    alert('Bitte gib einen Spielernamen ein.');
    return;
  }
  try {
    await authFetch('/api/players/nametag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: player, nametag: '' })
    });
    addConsoleLog(`🏷️ Nametag für "${player}" zurückgesetzt.`);
    alert(`Nametag für "${player}" zurückgesetzt.`);
  } catch (e) {
    alert('Fehler: ' + e.message);
  }
}

