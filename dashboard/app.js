/* TALABA <3 bot dashboard — vanilla JS, no build step. */

'use strict';

const state = {
  config: null,
  saved: null,
  revision: '',
  meta: {},
  health: null,
  guild: { available: false, id: '', name: '', channels: [], categories: [], roles: [] },
  stats: null,
  active: 'overview',
  saving: false,
};

const contentEl = document.getElementById('content');
const navEl = document.getElementById('nav');
const loginEl = document.getElementById('login');
const appEl = document.getElementById('app');
const toastEl = document.getElementById('toasts');
const dirtyEl = document.getElementById('dirty-indicator');
const saveBtn = document.querySelector('.topbar [data-action="save"]');

const LOG_CATEGORIES = [
  ['roles', 'Roles'],
  ['members', 'Members'],
  ['channels', 'Channels'],
  ['messages', 'Messages'],
  ['voice', 'Voice'],
  ['threads', 'Threads'],
  ['stage', 'Stage events'],
  ['emojis', 'Emojis'],
  ['webhooks', 'Webhooks'],
  ['moderation', 'Moderation'],
  ['guild', 'Server settings'],
  ['commands', 'Slash commands'],
  ['config', 'Bot config'],
];

const BUTTON_STYLES = [
  { value: 1, label: 'Primary (blurple)' },
  { value: 2, label: 'Secondary (grey)' },
  { value: 3, label: 'Success (green)' },
  { value: 4, label: 'Danger (red)' },
];

const MATCH_TYPES = [
  { value: 'contains', label: 'Contains' },
  { value: 'exact', label: 'Exact match' },
  { value: 'startsWith', label: 'Starts with' },
  { value: 'regex', label: 'Regular expression' },
];

const RESPOND_IN = [
  { value: 'channel', label: 'In the channel' },
  { value: 'dm', label: 'Direct message' },
];

const ICONS = {
  overview:
    '<rect x="3" y="3" width="7.5" height="9.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="13.5" y="12" width="7.5" height="9" rx="2"/><rect x="3" y="16" width="7.5" height="5" rx="2"/>',
  stats: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3.2 3.2L20 6.5"/>',
  xp: '<path d="M13 2 4.6 13.4H11l-1 8.6 8.4-11.4H12z"/>',
  channels: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  greetings:
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.8-.8L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/><path d="M8.5 11.5h7M12 8v7"/>',
  autoreact:
    '<path d="M12 3.2l1.9 4.6 4.6 1.9-4.6 1.9L12 16.2l-1.9-4.6L5.5 9.7l4.6-1.9z"/><path d="M18 15.5l.9 2.1 2.1.9-2.1.9L18 21.5l-.9-2.1-2.1-.9 2.1-.9z"/>',
  autoreply:
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.8-.8L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/><path d="M8.5 11.5h7M13 8.5l3 3-3 3"/>',
  roles:
    '<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.6" cy="7.6" r="1.4"/>',
  tickets:
    '<path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z"/><path d="M13 5v14"/>',
  shield:
    '<path d="M12 3 5 6v6c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6z"/><path d="M9.2 12.2l2 2 3.6-3.9"/>',
  advanced:
    '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  users:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.6a3.4 3.4 0 0 1 0 6.8"/><path d="M18 20a5.6 5.6 0 0 0-2-4.3"/>',
  history: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/><path d="M12 7.5V12l3 2"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  bot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8.5 13h.01M15.5 13h.01M9.5 17h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
};

function icon(name) {
  const paths = ICONS[name] || ICONS.spark;
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const sections = [
  { id: 'overview', label: 'Overview', icon: 'overview', group: 'General', subtitle: 'Bot status and quick toggles', render: renderOverview },
  { id: 'stats', label: 'Data & Stats', icon: 'stats', group: 'General', subtitle: 'XP leaderboard and ticket history', render: renderStats },
  { id: 'xp', label: 'XP & Levels', icon: 'xp', group: 'Engagement', subtitle: 'Message/voice rates, cooldown and level rewards', render: renderXp },
  { id: 'channels', label: 'Channels & Logging', icon: 'channels', group: 'Engagement', subtitle: 'Announcements and server event logs', render: renderChannels },
  { id: 'greetings', label: 'Welcome & Goodbye', icon: 'greetings', group: 'Engagement', subtitle: 'Join and leave messages, cards and tests', render: renderGreetings },
  { id: 'autoreact', label: 'Auto-reactions', icon: 'autoreact', group: 'Engagement', subtitle: 'Emojis added automatically per channel', render: renderAutoReact },
  { id: 'autoreply', label: 'Auto-replies', icon: 'autoreply', group: 'Engagement', subtitle: 'Keyword-triggered replies per channel', render: renderAutoReply },
  { id: 'l7aj', label: 'L7aj Persona', icon: 'bot', group: 'Engagement', subtitle: 'A Gemini-powered character that joins conversations on its own', render: renderL7aj },
  { id: 'roles', label: 'Role Panels', icon: 'roles', group: 'Community', subtitle: 'Button panels, reaction roles and verification', render: renderRoles },
  { id: 'tickets', label: 'Tickets', icon: 'tickets', group: 'Community', subtitle: 'Panels, forms, staff roles and auto-close', render: renderTickets },
  { id: 'automod', label: 'AutoMod & AI', icon: 'shield', group: 'Protection', subtitle: 'Filters, exemptions and Gemini moderation', render: renderAutomod },
  { id: 'advanced', label: 'Advanced', icon: 'advanced', group: 'System', subtitle: 'Secrets, raw JSON and environment', render: renderAdvanced },
];

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

bindEvents();
init();

async function init() {
  let session;
  try {
    session = await api('/api/session');
  } catch (err) {
    showLogin('Could not reach the dashboard server.');
    return;
  }

  if (!session.authenticated) {
    showLogin();
    return;
  }

  await boot();
}

async function boot() {
  loginEl.classList.add('hidden');
  appEl.classList.remove('hidden');

  try {
    await loadData();
  } catch (err) {
    toast(err.message || 'Failed to load configuration.', 'error', 7000);
    return;
  }

  const hash = decodeURIComponent(window.location.hash.slice(1));
  if (sections.some((section) => section.id === hash)) state.active = hash;

  renderNav();
  renderActive(true);
  setInterval(refreshHealth, 20_000);
}

async function loadData() {
  const [config, guild, stats, health] = await Promise.all([
    api('/api/config'),
    api('/api/guild'),
    api('/api/stats'),
    api('/api/health'),
  ]);

  state.config = config.config;
  state.saved = clone(config.config);
  state.revision = config.revision;
  state.meta = config.meta;
  state.guild = guild;
  state.stats = stats;
  state.health = health;

  updateMetaUi();
  updateDirty();
}

async function loadConfigOnly() {
  const res = await api('/api/config');
  state.config = res.config;
  state.saved = clone(res.config);
  state.revision = res.revision;
  state.meta = res.meta;
  updateMetaUi();
  updateDirty();
}

async function refreshHealth() {
  const wasReady = Boolean(state.health && state.health.bot && state.health.bot.ready);
  try {
    state.health = await api('/api/health');
    updateStatus();
  } catch {
    return;
  }

  if (!wasReady && state.health.bot.ready) {
    try {
      state.guild = await api('/api/guild');
    } catch {
      /* ignore */
    }
    if (isDirty()) {
      toast('Bot connected. Reload to enable channel and role pickers.', 'info', 6000);
    } else {
      redraw();
      toast('Bot connected — channel and role pickers are ready.', 'success');
    }
  }
}

async function onLogin(event) {
  event.preventDefault();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  try {
    await api('/api/login', { method: 'POST', body: { password } });
    document.getElementById('login-password').value = '';
    await boot();
  } catch (err) {
    errorEl.textContent = err.message || 'Sign in failed.';
  }
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST', body: {} });
  } catch {
    /* ignore */
  }
  state.config = null;
  state.saved = null;
  appEl.classList.add('hidden');
  setSidebarOpen(false);
  showLogin();
}

function showLogin(message) {
  appEl.classList.add('hidden');
  loginEl.classList.remove('hidden');
  setSidebarOpen(false);
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = message || '';
  document.getElementById('login-password').focus();
}

/* ------------------------------------------------------------------ */
/* HTTP + events                                                       */
/* ------------------------------------------------------------------ */

async function api(path, options = {}) {
  const request = {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };

  if (options.body !== undefined) {
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, request);
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await response.json() : null;

  if (response.status === 401 && path !== '/api/login') {
    showLogin('Your session expired. Sign in again.');
  }

  if (!response.ok) {
    const error = new Error((data && data.error) || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function bindEvents() {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('input', onFieldChange);
  document.addEventListener('change', onFieldChange);
  document.getElementById('login-form').addEventListener('submit', onLogin);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setSidebarOpen(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (isDirty() && !state.saving) saveConfig();
    }
  });

  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id !== state.active) setActive(id, false);
  });

  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason && reason.message ? reason.message : String(reason);
    toast(`Unexpected error: ${message}`, 'error', 8000);
  });

  window.addEventListener('error', (event) => {
    if (!event.message) return;
    toast(`Unexpected error: ${event.message}`, 'error', 8000);
  });
}

function onFieldChange(event) {
  const el = event.target;
  if (!el || typeof el.dataset !== 'object') return;

  if (el.dataset.mappingKey !== undefined) {
    if (!state.config) return;
    state.config.reactionRoles.mappings[el.dataset.mappingKey] = el.value;
    updateDirty();
    return;
  }

  if (!el.dataset.path || !state.config) return;
  setPath(state.config, el.dataset.path, readValue(el));
  updateDirty();
  updatePreviews();
}

async function onDocumentClick(event) {
  const navButton = event.target.closest('[data-nav]');
  if (navButton) {
    setActive(navButton.dataset.nav, true);
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;

  const action = button.dataset.action;
  try {
    switch (action) {
      case 'save':
        await saveConfig();
        return;
      case 'reload':
        await reloadAll();
        return;
      case 'toggle-sidebar':
        setSidebarOpen(!document.body.classList.contains('nav-open'));
        return;
      case 'close-sidebar':
        setSidebarOpen(false);
        return;
      case 'logout':
        await logout();
        return;
      case 'list-add':
        addListItem(button);
        return;
      case 'list-remove':
        removeListItem(button);
        return;
      case 'add-level-role':
        addLevelRole();
        return;
      case 'remove-level-role':
        delete state.config.levelRoles[button.dataset.level];
        redraw();
        return;
      case 'add-mapping':
        addMapping();
        return;
      case 'remove-mapping':
        delete state.config.reactionRoles.mappings[button.dataset.key];
        redraw();
        return;
      case 'add-role-panel':
        addRolePanel();
        return;
      case 'remove-role-panel':
        removeRolePanel(button.dataset.panelId);
        return;
      case 'add-panel-button':
        addPanelButton(button.dataset.panelId);
        return;
      case 'remove-panel-button':
        removePanelButton(button.dataset.panelId, Number(button.dataset.buttonIndex));
        return;
      case 'publish-role-panel':
        await publishPanel('role', button.dataset.panelId);
        return;
      case 'add-ticket-panel':
        addTicketPanel();
        return;
      case 'remove-ticket-panel':
        removeTicketPanel(button.dataset.panelId);
        return;
      case 'add-form-field':
        addFormField(button.dataset.panelId);
        return;
      case 'remove-form-field':
        removeFormField(button.dataset.panelId, Number(button.dataset.fieldIndex));
        return;
      case 'publish-ticket-panel':
        await publishPanel('ticket', button.dataset.panelId);
        return;
      case 'publish-live-leaderboard':
        await runAction('/api/actions/publish-live-leaderboard', {}, 'Leaderboard refreshed.');
        return;
      case 'add-auto-react':
        addAutoReact();
        return;
      case 'remove-auto-react':
        state.config.autoReactions.splice(Number(button.dataset.index), 1);
        redraw();
        return;
      case 'add-auto-reply':
        addAutoReply();
        return;
      case 'remove-auto-reply':
        removeAutoReply(Number(button.dataset.index));
        return;
      case 'test-welcome':
        await runAction('/api/actions/test-welcome', {}, 'Test welcome sent.');
        return;
      case 'test-goodbye':
        await runAction('/api/actions/test-goodbye', {}, 'Test goodbye sent.');
        return;
      case 'ai-test':
        await runAiTest();
        return;
      case 'l7aj-test':
        await runL7ajTest();
        return;
      case 'clear-l7aj-memory':
        if (window.confirm('Delete every note L7aj has saved for this server? This cannot be undone.')) {
          await runAction('/api/actions/clear-l7aj-memory', {}, 'L7aj memory cleared.');
        }
        return;
      case 'raw-apply':
        applyRawJson();
        return;
      case 'raw-reset':
        state.config = clone(state.saved);
        redraw();
        toast('Reverted to the last saved configuration.', 'info');
        return;
      case 'reload-disk':
        await reloadFromDisk();
        return;
      case 'save-secrets':
        await saveSecrets();
        return;
      case 'refresh-stats':
        state.stats = await api('/api/stats');
        state.health = await api('/api/health');
        updateStatus();
        redraw();
        toast('Stats refreshed.', 'info');
        return;
      default:
        return;
    }
  } catch (err) {
    toast(err.message || 'Action failed.', 'error', 7000);
  }
}

/* ------------------------------------------------------------------ */
/* Save / reload                                                       */
/* ------------------------------------------------------------------ */

function isDirty() {
  return Boolean(state.config && state.saved && JSON.stringify(state.config) !== JSON.stringify(state.saved));
}

function updateDirty() {
  const dirty = isDirty();
  if (saveBtn) saveBtn.disabled = !dirty || state.saving;
  dirtyEl.classList.toggle('hidden', !dirty);
}

async function saveConfig(silent = false) {
  if (state.saving || !state.config) return false;
  state.saving = true;
  updateDirty();

  try {
    const res = await api('/api/config', {
      method: 'PUT',
      body: { config: state.config, revision: state.revision },
    });

    state.config = res.config;
    state.saved = clone(res.config);
    state.revision = res.revision;
    state.meta = res.meta;
    updateMetaUi();
    if (!silent) toast('Configuration saved — changes are live.', 'success');
    redraw();
    return true;
  } catch (err) {
    if (err.status === 409 && err.data && err.data.config) {
      state.config = err.data.config;
      state.saved = clone(err.data.config);
      state.revision = err.data.revision;
      state.meta = err.data.meta || state.meta;
      updateMetaUi();
      redraw();
      toast('Config changed elsewhere (slash command?). Loaded the latest version — re-apply your edits.', 'error', 8000);
    } else {
      toast(err.message || 'Could not save the configuration.', 'error', 8000);
    }
    return false;
  } finally {
    state.saving = false;
    updateDirty();
  }
}

async function reloadAll() {
  if (isDirty() && !window.confirm('Discard unsaved changes and reload config.json?')) return;
  await loadData();
  redraw();
  toast('Reloaded from config.json.', 'info');
}

async function reloadFromDisk() {
  if (isDirty() && !window.confirm('Discard unsaved changes and reload the file from disk?')) return;
  const res = await api('/api/actions/reload-config', { method: 'POST', body: {} });
  state.config = res.config;
  state.saved = clone(res.config);
  state.revision = res.revision;
  state.meta = res.meta;
  updateMetaUi();
  redraw();
  toast('Reloaded config.json from disk.', 'success');
}

async function saveAndRun(action) {
  const saved = await saveConfig(true);
  if (!saved) return;
  await action();
}

async function runAction(path, body, successMessage) {
  await saveAndRun(async () => {
    const result = await api(path, { method: 'POST', body });
    toast(result && result.created ? 'Posted to Discord.' : successMessage, 'success');
    await loadConfigOnly();
    redraw();
  });
}

async function publishPanel(kind, panelId) {
  if (!panelId) return;
  await saveAndRun(async () => {
    const path = kind === 'role' ? '/api/actions/publish-role-panel' : '/api/actions/publish-ticket-panel';
    const result = await api(path, { method: 'POST', body: { panelId } });
    await loadConfigOnly();
    redraw();
    toast(result.created ? 'Panel posted to Discord.' : 'Panel message updated.', 'success');
  });
}

/* ------------------------------------------------------------------ */
/* Structural edits                                                    */
/* ------------------------------------------------------------------ */

function addListItem(button) {
  const path = button.dataset.path;
  const picker = contentEl.querySelector(`[data-add-list="${path}"]`);
  const value = picker ? picker.value : '';
  if (!value) {
    toast('Pick a value first.', 'error');
    return;
  }
  const list = getPath(state.config, path) || [];
  if (!list.includes(value)) list.push(value);
  setPath(state.config, path, list);
  redraw();
}

function removeListItem(button) {
  const path = button.dataset.path;
  const index = Number(button.dataset.index);
  const list = getPath(state.config, path) || [];
  if (index >= 0 && index < list.length) list.splice(index, 1);
  redraw();
}

function addLevelRole() {
  const level = document.getElementById('new-level-role-level').value.trim();
  const roleId = document.getElementById('new-level-role-role').value;
  if (!/^\d+$/.test(level)) {
    toast('Enter the level as a whole number.', 'error');
    return;
  }
  if (!roleId) {
    toast('Pick a role for the reward.', 'error');
    return;
  }
  state.config.levelRoles[String(Number.parseInt(level, 10))] = roleId;
  redraw();
}

function addMapping() {
  const emoji = document.getElementById('new-mapping-emoji').value.trim();
  const roleId = document.getElementById('new-mapping-role').value;
  if (!emoji) {
    toast('Enter an emoji (unicode or <:name:id>).', 'error');
    return;
  }
  if (!roleId) {
    toast('Pick a role.', 'error');
    return;
  }
  state.config.reactionRoles.mappings[emoji] = roleId;
  redraw();
}

function nextId(prefix, list) {
  let n = list.length + 1;
  const used = new Set(list.map((entry) => entry.id));
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

function addRolePanel() {
  const panels = state.config.roles.panels;
  panels.push({
    id: nextId('p', panels),
    name: `Panel ${panels.length + 1}`,
    messageId: '',
    channelId: '',
    title: '🎭 Self-Assign Roles',
    description: 'Click a button to get the role.',
    buttons: [],
    overrideRoles: false,
  });
  redraw();
}

function removeRolePanel(panelId) {
  if (!window.confirm('Remove this panel from the config? The Discord message itself is not deleted.')) return;
  state.config.roles.panels = state.config.roles.panels.filter((panel) => panel.id !== panelId);
  redraw();
}

function addPanelButton(panelId) {
  const panel = state.config.roles.panels.find((entry) => entry.id === panelId);
  if (!panel) return;
  const picker = document.getElementById(`new-button-role-${panelId}`);
  const roleId = picker ? picker.value : '';
  if (!roleId) {
    toast('Pick a role first.', 'error');
    return;
  }
  if (panel.buttons.some((button) => button.roleId === roleId)) {
    toast('That role is already on this panel.', 'error');
    return;
  }
  if (panel.buttons.length >= 25) {
    toast('Discord allows at most 25 buttons per panel.', 'error');
    return;
  }
  const role = state.guild.roles.find((entry) => entry.id === roleId);
  panel.buttons.push({
    roleId,
    label: role ? role.name.slice(0, 80) : 'Role',
    emoji: '',
    style: 2,
  });
  redraw();
}

function removePanelButton(panelId, index) {
  const panel = state.config.roles.panels.find((entry) => entry.id === panelId);
  if (!panel) return;
  panel.buttons.splice(index, 1);
  redraw();
}

function addTicketPanel() {
  const panels = state.config.tickets.panels;
  panels.push({
    id: nextId('t', panels),
    name: `Ticket panel ${panels.length + 1}`,
    channelId: '',
    messageId: '',
    title: '🎫 Support',
    description: 'Click the button below to open a support ticket.',
    buttonLabel: 'Open Ticket',
    buttonEmoji: '🎫',
    buttonStyle: 1,
    categoryId: state.config.tickets.categoryId || '',
    staffRoles: [],
    pingRoles: [],
    formFields: [],
    welcomeMessage: '👋 Hello {user}! A staff member will be with you shortly.',
    pingOnCreate: true,
    autoCloseHours: 0,
    transcriptsEnabled: true,
    transcriptChannelId: '',
  });
  redraw();
}

function removeTicketPanel(panelId) {
  if (!window.confirm('Remove this ticket panel from the config? The Discord message itself is not deleted.')) return;
  state.config.tickets.panels = state.config.tickets.panels.filter((panel) => panel.id !== panelId);
  redraw();
}

function addFormField(panelId) {
  const panel = state.config.tickets.panels.find((entry) => entry.id === panelId);
  if (!panel) return;
  let n = panel.formFields.length + 1;
  const used = new Set(panel.formFields.map((field) => field.id));
  while (used.has(`field_${n}`)) n += 1;
  panel.formFields.push({
    id: `field_${n}`,
    label: `Question ${n}`,
    placeholder: '',
    type: 'short',
    required: true,
  });
  redraw();
}

function removeFormField(panelId, index) {
  const panel = state.config.tickets.panels.find((entry) => entry.id === panelId);
  if (!panel) return;
  panel.formFields.splice(index, 1);
  redraw();
}

function addAutoReact() {
  const channelId = document.getElementById('new-autoreact-channel').value;
  const emojis = splitCsv(document.getElementById('new-autoreact-emojis').value);
  if (!channelId) {
    toast('Pick a channel.', 'error');
    return;
  }
  if (emojis.length === 0) {
    toast('Add at least one emoji.', 'error');
    return;
  }
  state.config.autoReactions = state.config.autoReactions.filter((entry) => entry.channelId !== channelId);
  state.config.autoReactions.push({ channelId, emojis });
  redraw();
}

function addAutoReply() {
  if (!state.config.autoReplies || typeof state.config.autoReplies !== 'object') {
    state.config.autoReplies = { enabled: false, rules: [] };
  }
  if (!Array.isArray(state.config.autoReplies.rules)) state.config.autoReplies.rules = [];

  const rules = state.config.autoReplies.rules;
  rules.push({
    id: nextId('r', rules),
    name: `Rule ${rules.length + 1}`,
    enabled: true,
    channelIds: [],
    bypassRoleIds: [],
    matchType: 'contains',
    triggers: [],
    reply: '',
    respondIn: 'channel',
    pingAuthor: false,
    deleteTrigger: false,
    caseSensitive: false,
    cooldownSeconds: 30,
  });
  redraw();
}

function removeAutoReply(index) {
  const rules = state.config.autoReplies && state.config.autoReplies.rules;
  if (!Array.isArray(rules) || index < 0 || index >= rules.length) return;
  if (!window.confirm('Remove this auto-reply rule?')) return;
  rules.splice(index, 1);
  redraw();
}

async function runAiTest() {
  const text = document.getElementById('ai-test-text').value.trim();
  if (!text) {
    toast('Paste a message to classify first.', 'error');
    return;
  }

  try {
    await saveAndRun(async () => {
      const resultEl = document.getElementById('ai-result');
      resultEl.textContent = 'Classifying…';
      const result = await api('/api/ai/test', { method: 'POST', body: { text } });
      const verdict = result.verdict;
      if (!verdict) {
        resultEl.textContent = 'No verdict returned (fail open — the message would be allowed).';
        return;
      }
      resultEl.textContent =
        `Flagged: ${verdict.flagged ? 'YES' : 'no'}\n` +
        `Category: ${verdict.category}\n` +
        `Confidence: ${Math.round(verdict.confidence * 100)}%\n` +
        `Reason: ${verdict.reason}\n\n` +
        'Dry run — no message was deleted.';
    });
  } catch (err) {
    const resultEl = document.getElementById('ai-result');
    if (resultEl) resultEl.textContent = err.message || 'AI test failed.';
    throw err;
  }
}

async function runL7ajTest() {
  const input = document.getElementById('l7aj-test-text');
  const text = input ? input.value.trim() : '';
  if (!text) {
    toast('Write the message L7aj should react to first.', 'error');
    return;
  }

  const resultEl = document.getElementById('l7aj-result');
  try {
    await saveAndRun(async () => {
      if (resultEl) resultEl.textContent = 'Thinking…';
      const result = await api('/api/ai/persona-test', { method: 'POST', body: { text } });
      if (resultEl) {
        const tools = result.toolCalls && result.toolCalls.length ? result.toolCalls.join(', ') : 'none';
        const sticker = result.stickerId ? ` [sticker ${result.stickerId}]` : '';
        const mode = result.action === 'reply' ? (result.replyToTrigger ? ' (reply)' : ' (bare message)') : '';
        resultEl.textContent =
          `Action: ${result.action === 'reply' ? 'REPLY' : 'SILENT'}\n` +
          `Model: ${result.model}\n` +
          `Tools: ${tools}\n\n` +
          (result.action === 'reply'
            ? `${result.message || '(sticker only)'}${sticker}${mode}`
            : 'L7aj would stay quiet.') +
          '\n\nDry run — nothing was posted.';
      }
    });
  } catch (err) {
    if (resultEl) resultEl.textContent = err.message || 'Persona test failed.';
    throw err;
  }
}

function applyRawJson() {
  const textarea = document.getElementById('raw-json');
  try {
    const parsed = JSON.parse(textarea.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Top-level JSON must be an object.');
    }
    state.config = parsed;
    redraw();
    toast('JSON applied to the form. Click "Save changes" to write it.', 'info', 6000);
  } catch (err) {
    toast(`Invalid JSON: ${err.message}`, 'error', 8000);
  }
}

async function saveSecrets() {
  const token = document.getElementById('secret-token').value.trim();
  const geminiApiKey = document.getElementById('secret-gemini').value.trim();
  if (!token && !geminiApiKey) {
    toast('Enter a new token or Gemini API key first.', 'error');
    return;
  }
  if (isDirty() && !window.confirm('Save secrets and discard the unsaved changes on this page?')) {
    return;
  }

  const result = await api('/api/secrets', { method: 'POST', body: { token, geminiApiKey } });
  document.getElementById('secret-token').value = '';
  document.getElementById('secret-gemini').value = '';
  await loadConfigOnly();
  redraw();
  toast(result.note || 'Secrets saved.', 'success', 7000);
}

/* ------------------------------------------------------------------ */
/* Render helpers                                                      */
/* ------------------------------------------------------------------ */

function esc(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPath(object, path) {
  return path.split('.').reduce((current, key) => (current == null ? undefined : current[key]), object);
}

function setPath(object, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  let current = object;
  for (const part of parts) {
    if (current[part] == null || typeof current[part] !== 'object') {
      current[part] = /^\d+$/.test(part) ? [] : {};
    }
    current = current[part];
  }
  current[last] = value;
}

function readValue(el) {
  const type = el.dataset.type || 'string';
  if (type === 'bool') return Boolean(el.checked);
  if (type === 'number') {
    const value = Number(el.value);
    return Number.isFinite(value) ? value : 0;
  }
  if (type === 'number-optional') {
    if (el.value === '') return undefined;
    const value = Number(el.value);
    return Number.isFinite(value) ? value : undefined;
  }
  if (type === 'csv') return splitCsv(el.value);
  return el.value;
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function renderTemplate(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

function updatePreviews() {
  if (!state.config) return;
  const values = {
    user: '@member',
    username: 'member',
    server: (state.health && state.health.guild.name) || 'TALABA <3',
    memberCount: (state.stats && state.stats.xp.totalMembers) || 42,
    level: 12,
    role: '@Level 12',
    xp: 320,
    xpneeded: 480,
    panel: 'Support',
  };

  const set = (id, template) => {
    const node = document.getElementById(id);
    if (node) node.textContent = renderTemplate(template, values);
  };

  set('preview-levelup', state.config.channels.levelUpMessage);
  set('preview-welcome', state.config.welcome.message);
  set('preview-welcome-image', state.config.welcome.welcomeImageMessage);
  set('preview-goodbye', state.config.goodbye.message);
}

function card(title, body, options = {}) {
  return `<section class="card ${options.className || ''}">
    <header class="card-head">
      <div>
        <h2>${esc(title)}</h2>
        ${options.subtitle ? `<p class="muted">${esc(options.subtitle)}</p>` : ''}
      </div>
      ${options.actions ? `<div class="card-actions">${options.actions}</div>` : ''}
    </header>
    <div class="card-body">${body}</div>
  </section>`;
}

function field(label, control, hint = '') {
  return `<div class="field">
    <label>${esc(label)}</label>
    ${control}
    ${hint ? `<span class="hint">${hint}</span>` : ''}
  </div>`;
}

function grid(fields, cols = 2) {
  return `<div class="grid cols-${cols}">${fields.filter(Boolean).join('')}</div>`;
}

function textInput(path, value, options = {}) {
  const attrs = [
    'class="input"',
    `data-path="${esc(path)}"`,
    'data-type="string"',
    `value="${esc(value == null ? '' : value)}"`,
  ];
  if (options.placeholder) attrs.push(`placeholder="${esc(options.placeholder)}"`);
  if (options.maxlength) attrs.push(`maxlength="${options.maxlength}"`);
  if (options.list) attrs.push(`list="${esc(options.list)}"`);
  if (options.readonly) attrs.push('readonly');
  return `<input ${attrs.join(' ')}>`;
}

function numberInput(path, value, options = {}) {
  const attrs = [
    'class="input"',
    `data-path="${esc(path)}"`,
    `data-type="${options.optional ? 'number-optional' : 'number'}"`,
    `value="${value == null ? '' : esc(value)}"`,
    `min="${options.min == null ? 0 : options.min}"`,
    `max="${options.max == null ? 99999 : options.max}"`,
    `step="${options.step == null ? 1 : options.step}"`,
  ];
  if (options.placeholder) attrs.push(`placeholder="${esc(options.placeholder)}"`);
  return `<input type="number" ${attrs.join(' ')}>`;
}

function textarea(path, value, options = {}) {
  const attrs = [
    'class="input"',
    `data-path="${esc(path)}"`,
    'data-type="string"',
  ];
  if (options.id) attrs.push(`id="${esc(options.id)}"`);
  if (options.placeholder) attrs.push(`placeholder="${esc(options.placeholder)}"`);
  const rows = options.rows || 3;
  return `<textarea ${attrs.join(' ')} rows="${rows}">${esc(value == null ? '' : value)}</textarea>`;
}

function toggle(path, checked, label, hint = '') {
  return `<label class="toggle-row">
    <span class="toggle-text"><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</span>
    <input type="checkbox" data-path="${esc(path)}" data-type="bool" ${checked ? 'checked' : ''}>
    <span class="toggle"></span>
  </label>`;
}

function optionsSelect(options, settings = {}) {
  const items = options.slice();
  const value = settings.value == null ? '' : settings.value;
  if (value !== '' && !items.some((option) => String(option.value) === String(value))) {
    items.unshift({ value, label: `⚠ Unknown: ${value}` });
  }
  const attrs = ['class="input"'];
  if (settings.id) attrs.push(`id="${esc(settings.id)}"`);
  return `<select ${attrs.join(' ')}>${items
    .map(
      (option) =>
        `<option value="${esc(option.value)}" ${String(option.value) === String(value) ? 'selected' : ''}>${esc(option.label)}</option>`,
    )
    .join('')}</select>`;
}

function select(path, value, options, settings = {}) {
  const items = options.slice();
  const current = value == null ? '' : value;
  if (current !== '' && !items.some((option) => String(option.value) === String(current))) {
    items.unshift({ value: current, label: `⚠ Unknown: ${current}` });
  }
  return `<select class="input" data-path="${esc(path)}" data-type="${settings.type || 'string'}">${items
    .map(
      (option) =>
        `<option value="${esc(option.value)}" ${String(option.value) === String(current) ? 'selected' : ''}>${esc(option.label)}</option>`,
    )
    .join('')}</select>`;
}

function channelOptions(allowEmpty = true, emptyLabel = '— none —') {
  const options = state.guild.channels.map((channel) => ({
    value: channel.id,
    label: `#${channel.name}${channel.parentName ? ` · ${channel.parentName}` : ''}`,
  }));
  if (allowEmpty) options.unshift({ value: '', label: emptyLabel });
  return options;
}

function categoryOptions(allowEmpty = true, emptyLabel = '— none —') {
  const options = state.guild.categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));
  if (allowEmpty) options.unshift({ value: '', label: emptyLabel });
  return options;
}

function roleOptions(allowEmpty = true, emptyLabel = '— none —') {
  const options = state.guild.roles.map((role) => ({
    value: role.id,
    label: `@${role.name}${role.managed ? ' · managed' : !role.assignable ? ' · above bot' : ''}`,
  }));
  if (allowEmpty) options.unshift({ value: '', label: emptyLabel });
  return options;
}

function channelSelect(path, value, settings = {}) {
  if (!state.guild.available) return textInput(path, value, { placeholder: 'Discord channel ID' });
  return select(path, value, channelOptions(settings.allowEmpty !== false, settings.emptyLabel), settings);
}

function categorySelect(path, value, settings = {}) {
  if (!state.guild.available) return textInput(path, value, { placeholder: 'Discord category ID' });
  return select(path, value, categoryOptions(settings.allowEmpty !== false, settings.emptyLabel), settings);
}

function roleSelect(path, value, settings = {}) {
  if (!state.guild.available) return textInput(path, value, { placeholder: 'Discord role ID' });
  return select(path, value, roleOptions(settings.allowEmpty !== false, settings.emptyLabel), settings);
}

function channelLabel(id) {
  const channel = state.guild.channels.find((entry) => entry.id === id);
  return channel ? `#${channel.name}` : `⚠ ${id}`;
}

function roleLabel(id) {
  const role = state.guild.roles.find((entry) => entry.id === id);
  return role ? `@${role.name}` : `⚠ ${id}`;
}

function chipList(path, ids, kind) {
  const values = Array.isArray(ids) ? ids : [];
  if (!state.guild.available) {
    return textInput(path, values.join(', '), {
      placeholder: 'Comma-separated IDs',
    }).replace('data-type="string"', 'data-type="csv"');
  }

  const label = kind === 'role' ? roleLabel : channelLabel;
  const chips = values.length
    ? values
        .map(
          (id, index) =>
            `<span class="chip"><span>${esc(label(id))}</span><button type="button" class="chip-x" data-action="list-remove" data-path="${esc(path)}" data-index="${index}" aria-label="Remove">×</button></span>`,
        )
        .join('')
    : '<span class="muted tiny">None configured</span>';

  const options = kind === 'role' ? roleOptions(true, '— add a role —') : channelOptions(true, '— add a channel —');
  return `<div class="chips">${chips}</div>
    <div class="row">
      ${optionsSelect(options, { id: '' }).replace('<select class="input"', `<select class="input" data-add-list="${esc(path)}"`)}
      <button type="button" class="btn small" data-action="list-add" data-path="${esc(path)}">Add</button>
    </div>`;
}

function statCard(label, value, sub, iconName = '', tone = 'violet') {
  return `<div class="stat tone-${tone}">
    <div class="stat-top">
      <span class="stat-label">${esc(label)}</span>
      ${iconName ? `<span class="stat-icon">${icon(iconName)}</span>` : ''}
    </div>
    <div class="stat-value">${esc(value)}</div>
    <div class="stat-sub">${esc(sub)}</div>
  </div>`;
}

function formatUptime(seconds) {
  if (seconds == null || seconds < 0) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function emptyRow(cols, text) {
  return `<tr><td colspan="${cols}" class="muted">${esc(text)}</td></tr>`;
}

function discordMessageLink(channelId, messageId) {
  const guildId = (state.health && state.health.guild.id) || state.guild.id;
  if (!guildId || !channelId || !messageId) return '';
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function messageNote(channelId, messageId, hint) {
  if (!messageId) {
    return `<div class="section-note">${icon('info')}<span>${esc(hint)}</span></div>`;
  }
  const link = discordMessageLink(channelId, messageId);
  return `<div class="section-note">${icon('link')}<span>Message ID <code>${esc(messageId)}</code>${
    link ? ` · <a href="${esc(link)}" target="_blank" rel="noreferrer">open in Discord</a>` : ''
  }</span></div>`;
}

/* ------------------------------------------------------------------ */
/* Render: overview                                                    */
/* ------------------------------------------------------------------ */

function renderOverview() {
  const cfg = state.config;
  const health = state.health || { bot: {}, guild: {} };
  const stats = state.stats;
  const bot = health.bot || {};
  const guild = health.guild || {};

  const botAvatar = bot.avatar
    ? `<img src="${esc(bot.avatar)}" alt="" loading="lazy">`
    : `<span>${esc((bot.tag || 'T').slice(0, 1).toUpperCase())}</span>`;
  const guildIcon = guild.icon ? `<img class="hero-guild-icon" src="${esc(guild.icon)}" alt="" loading="lazy">` : '';

  const hero = `<section class="hero">
    <div class="hero-identity">
      <span class="hero-avatar ${bot.ready ? 'is-online' : ''}">${botAvatar}</span>
      <div class="hero-text">
        <span class="eyebrow">${bot.ready ? 'Bot connected' : 'Not connected'}</span>
        <h2>${esc(bot.tag || 'TALABA <3')}</h2>
        <div class="hero-tags">
          <span class="pill ${bot.ready ? 'ok' : 'bad'}"><span class="dot"></span>${bot.ready ? 'Online' : 'Offline'}</span>
          ${
            guild.name
              ? `<span class="pill">${guildIcon}<span>${esc(guild.name)}</span></span>`
              : '<span class="pill warn">No server connected</span>'
          }
        </div>
      </div>
    </div>
    <div class="hero-metrics">
      <div class="hero-metric"><span>Ping</span><strong>${bot.ping != null && bot.ping >= 0 ? `${esc(bot.ping)} ms` : '—'}</strong></div>
      <div class="hero-metric"><span>Uptime</span><strong>${esc(formatUptime(bot.uptimeSeconds))}</strong></div>
      <div class="hero-metric"><span>Members</span><strong>${guild.memberCount ? esc(guild.memberCount) : '—'}</strong></div>
      <div class="hero-metric"><span>Open tickets</span><strong>${stats ? esc(stats.tickets.open) : '—'}</strong></div>
    </div>
  </section>`;

  const automodTone = cfg.automod.aiModeration.enabled
    ? 'violet'
    : cfg.automod.blockUrls || cfg.automod.blockGifs || cfg.automod.blockCaps
      ? 'amber'
      : 'pink';
  const automodValue = cfg.automod.aiModeration.enabled
    ? 'AI active'
    : cfg.automod.blockUrls || cfg.automod.blockGifs || cfg.automod.blockCaps
      ? 'Filters'
      : 'Off';
  const automodSub = cfg.automod.aiModeration.enabled
    ? 'Gemini moderation active'
    : cfg.automod.blockUrls || cfg.automod.blockGifs || cfg.automod.blockCaps
      ? 'Regex filters only'
      : 'No moderation enabled';

  const statusCards = `<div class="stats">
    ${statCard('Tracked members', stats ? stats.xp.ranked : '—', 'members with XP', 'users', 'blue')}
    ${statCard('Open tickets', stats ? stats.tickets.open : '—', 'open or claimed', 'tickets', 'violet')}
    ${statCard('All-time tickets', stats ? stats.tickets.total : '—', 'since the bot started', 'history', 'green')}
    ${statCard('AutoMod', automodValue, automodSub, 'shield', automodTone)}
  </div>`;

  const quickToggles = [
    toggle('welcome.enabled', cfg.welcome.enabled, 'Welcome messages', 'Greet members when they join'),
    toggle('goodbye.enabled', cfg.goodbye.enabled, 'Goodbye messages', 'Announce members who leave'),
    toggle('autoReplies.enabled', (cfg.autoReplies || {}).enabled, 'Auto-replies', 'Reply to keyword triggers automatically'),
    toggle('l7aj.enabled', (cfg.l7aj || {}).enabled, 'L7aj persona', 'Let the community character join conversations'),
    toggle('logging.enabled', cfg.logging.enabled, 'Server logging', 'Send server events to the log channel'),
    toggle('automod.blockUrls', cfg.automod.blockUrls, 'Block URLs', 'Delete messages containing links'),
    toggle('automod.blockGifs', cfg.automod.blockGifs, 'Block GIFs', 'Delete GIF uploads and links'),
    toggle('automod.blockCaps', cfg.automod.blockCaps, 'Block CAPS', 'Delete shouty messages'),
    toggle('automod.aiModeration.enabled', cfg.automod.aiModeration.enabled, 'AI moderation', 'Gemini classification for Darija/Arabizi'),
  ].join('');

  const envInfo = [
    field('Guild ID', textInput('guildId', cfg.guildId, { placeholder: 'Server ID' }), 'Slash commands are registered here on restart.'),
    field('Client ID', textInput('clientId', cfg.clientId, { placeholder: 'Application ID' }), 'Used for command registration on restart.'),
    field(
      'Config file',
      `<div class="input" style="display:flex;align-items:center">${esc(state.meta.configPath || 'config.json')}</div>`,
    ),
    field(
      'Bot token',
      `<div class="row"><span class="pill ${state.meta.tokenConfigured ? 'ok' : 'bad'}">${
        state.meta.tokenConfigured ? 'Configured' : 'Missing'
      }</span><span class="muted tiny">from ${esc(state.meta.tokenSource || 'missing')}</span></div>`,
      'The token is never displayed by the dashboard.',
    ),
    field(
      'Gemini API key',
      `<div class="row"><span class="pill ${state.meta.geminiKeyConfigured ? 'ok' : 'bad'}">${
        state.meta.geminiKeyConfigured ? 'Configured' : 'Missing'
      }</span><span class="muted tiny">from ${esc(state.meta.geminiKeySource || 'missing')}</span></div>`,
      'Used only when AI moderation is enabled.',
    ),
  ].join('');

  return `${hero}
    ${statusCards}
    ${card('Quick toggles', quickToggles, {
      subtitle: 'Flip a switch, then press “Save changes” — no restart needed.',
    })}
    ${card('Live editing', `<div class="section-note">${icon('spark')}<span>
      <strong>Changes apply instantly.</strong> The dashboard runs inside the bot process, so saving writes
      <code>${esc(state.meta.configPath || 'config.json')}</code> and updates the running config at the same time.
      Slash commands write to the same file; if one runs while you edit, the dashboard asks you to reload instead of overwriting it.
    </span></div>
    <div class="section-note">${icon('shield')}<span>
      The bot token and Gemini API key are redacted in the API. Binds to
      <code>${esc((health.dashboard && health.dashboard.host) || '127.0.0.1')}:${esc((health.dashboard && health.dashboard.port) || 3000)}</code>
      ${health.dashboard && health.dashboard.passwordRequired ? 'and requires a password.' : 'with no password (local access only).'}
    </span></div>`, { subtitle: 'How saving works' })}
    ${card('Environment', grid([envInfo], 2), { subtitle: 'Read-only status, plus the guild ID used for commands' })}`;
}

/* ------------------------------------------------------------------ */
/* Render: XP                                                          */
/* ------------------------------------------------------------------ */

function renderXp() {
  const xp = state.config.xp;
  const live = state.config.liveLeaderboard || {};
  const levelRows = Object.entries(state.config.levelRoles).sort((a, b) => Number(a[0]) - Number(b[0]));

  const rows = levelRows.length
    ? levelRows
        .map(
          ([level, roleId]) => `<tr>
            <td><strong>${esc(level)}</strong></td>
            <td>${roleSelect(`levelRoles.${level}`, roleId, { allowEmpty: false })}</td>
            <td style="text-align:right"><button class="btn small danger" data-action="remove-level-role" data-level="${esc(level)}">Remove</button></td>
          </tr>`,
        )
        .join('')
    : emptyRow(3, 'No level rewards yet. Add one below.');

  const addLevel = `<div class="row">
    <input class="input" id="new-level-role-level" type="number" min="1" max="500" placeholder="Level" style="max-width:120px">
    ${state.guild.available ? optionsSelect(roleOptions(true, '— pick a reward role —'), { id: 'new-level-role-role' }) : '<input class="input" id="new-level-role-role" placeholder="Role ID">'}
    <button class="btn small" data-action="add-level-role">Add reward</button>
  </div>`;

  return `<p class="intro">MEE6-compatible XP. Members earn XP per message with a cooldown, and per minute in voice.
    Level rewards are granted automatically; lower reward tiers are removed when a higher one is reached.</p>

    ${card('Message XP', grid([
      field('Minimum XP per message', numberInput('xp.perMessageMin', xp.perMessageMin, { min: 0, max: 10000 })),
      field('Maximum XP per message', numberInput('xp.perMessageMax', xp.perMessageMax, { min: 0, max: 10000 })),
      field('Cooldown (seconds)', numberInput('xp.cooldownSeconds', xp.cooldownSeconds, { min: 0, max: 86400 }), 'One XP grant per member per cooldown.'),
      toggle('xp.ignoreBots', xp.ignoreBots, 'Bots earn no XP', 'Recommended: bots should not rank against members.'),
    ], 2))}

    ${card('Voice XP', grid([
      field('Minimum XP per voice minute', numberInput('xp.perVoiceMinuteMin', xp.perVoiceMinuteMin, { min: 0, max: 10000 })),
      field('Maximum XP per voice minute', numberInput('xp.perVoiceMinuteMax', xp.perVoiceMinuteMax, { min: 0, max: 10000 })),
    ], 2), { subtitle: 'Awarded every minute to members connected to a voice channel' })}

    ${card('XP channels', `${grid([
      field('Only earn XP in', channelSelect('xp.xpChannel', xp.xpChannel, { emptyLabel: '— all channels —' }), 'Leave empty to allow every channel.'),
    ], 1)}
      <div class="field">
        <span class="field-label">Channels with no XP</span>
        ${chipList('xp.noXpChannels', xp.noXpChannels, 'channel')}
        <span class="hint">Messages in these channels never award XP.</span>
      </div>`, { subtitle: 'Restrict where members can earn XP' })}

    ${card('Level rewards', `<div class="table-wrap"><table>
        <thead><tr><th>Level</th><th>Role granted</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${addLevel}`, { subtitle: 'Role milestones' })}

    ${card('Self-updating leaderboard', `${toggle(
      'liveLeaderboard.enabled',
      live.enabled,
      'Enable the persistent leaderboard',
      'One message in one channel, refreshed on a timer.',
    )}
      ${grid(
        [
          field('Channel', channelSelect('liveLeaderboard.channelId', live.channelId)),
          field(
            'Refresh interval (minutes)',
            numberInput('liveLeaderboard.intervalMinutes', live.intervalMinutes, { min: 1, max: 1440 }),
          ),
          field(
            'Members shown',
            numberInput('liveLeaderboard.rows', live.rows, { min: 3, max: 25 }),
            'Top 3 always get the podium image; the rest are grouped into rank zones.',
          ),
          field('Title', textInput('liveLeaderboard.title', live.title, { placeholder: '🏆 Server leaderboard' }), 'Leave empty to use the server name.'),
        ],
        2,
      )}
      <div class="btn-row"><button class="btn small" data-action="publish-live-leaderboard">Publish / refresh now</button><span class="muted tiny">Saves first, then posts or updates the single leaderboard message.</span></div>
      <span class="hint">This is separate from <code>/leaderboard</code>, which still renders on demand.</span>`,
      { subtitle: 'One message that updates itself' })}`;
}

/* ------------------------------------------------------------------ */
/* Render: channels & logging                                          */
/* ------------------------------------------------------------------ */

function renderChannels() {
  const cfg = state.config;
  const categoryToggles = LOG_CATEGORIES.map(([key, label]) =>
    toggle(`logging.categories.${key}`, cfg.logging.categories[key], label),
  ).join('');

  return `<p class="intro">Where the bot announces level-ups and writes server logs.</p>

    ${card('Level-up announcements', `${grid([
      field('Level-up channel', channelSelect('channels.levelUp', cfg.channels.levelUp, { emptyLabel: '— current channel —' })),
    ], 1)}
      ${field('Message template', textarea('channels.levelUpMessage', cfg.channels.levelUpMessage, { rows: 2 }), 'Placeholders: {user} {username} {level} {server} {role} {xp} {xpneeded}')}
      <div class="preview-label">Preview</div>
      <div class="preview" id="preview-levelup"></div>`)}

    ${card('Log channels', grid([
      field('Event log channel', channelSelect('channels.logs', cfg.channels.logs), 'Used by every server-event logger.'),
      field('Override channel', channelSelect('logging.channelId', cfg.logging.channelId), 'When set, takes priority over the event log channel.'),
    ], 2), { subtitle: 'Both point at a text channel the bot can post in' })}

    ${card('Server event logging', `${toggle('logging.enabled', cfg.logging.enabled, 'Enable server logging', 'Master switch for all categories below.')}
      <div class="grid cols-3">${categoryToggles}</div>`, { subtitle: 'Choose which events reach the log channel' })}`;
}

/* ------------------------------------------------------------------ */
/* Render: greetings                                                   */
/* ------------------------------------------------------------------ */

function renderGreetings() {
  const cfg = state.config;
  return `<p class="intro">Welcome and goodbye messages support placeholders: {user} (mention), {username}, {server} and {memberCount}.</p>

    ${card('Welcome', `${toggle('welcome.enabled', cfg.welcome.enabled, 'Enable welcome messages', 'Sent when a member joins the server.')}
      ${grid([
        field('Channel', channelSelect('welcome.channelId', cfg.welcome.channelId)),
        field('Background image', textInput('welcome.backgroundImage', cfg.welcome.backgroundImage, { placeholder: 'assets/bg.jpg' }), 'Path relative to the project root.'),
      ], 2)}
      ${field('Discord message', textarea('welcome.message', cfg.welcome.message, { rows: 2 }))}
      ${field('Welcome card text', textarea('welcome.welcomeImageMessage', cfg.welcome.welcomeImageMessage, { rows: 2 }), 'Text rendered inside the PNG card.')}
      <div class="grid cols-2">
        <div><div class="preview-label">Discord preview</div><div class="preview" id="preview-welcome"></div></div>
        <div><div class="preview-label">Card preview</div><div class="preview" id="preview-welcome-image"></div></div>
      </div>
      <div class="btn-row"><button class="btn small" data-action="test-welcome">Send test welcome</button><span class="muted tiny">Saves first, then posts in the configured channel.</span></div>`,
      { subtitle: 'Join message and PNG welcome card' })}

    ${card('Goodbye', `${toggle('goodbye.enabled', cfg.goodbye.enabled, 'Enable goodbye messages', 'Sent when a member leaves the server.')}
      ${grid([field('Channel', channelSelect('goodbye.channelId', cfg.goodbye.channelId))], 1)}
      ${field('Message', textarea('goodbye.message', cfg.goodbye.message, { rows: 2 }))}
      <div class="preview-label">Preview</div>
      <div class="preview" id="preview-goodbye"></div>
      <div class="btn-row"><button class="btn small" data-action="test-goodbye">Send test goodbye</button><span class="muted tiny">Saves first, then posts in the configured channel.</span></div>`,
      { subtitle: 'Leave message' })}`;
}

/* ------------------------------------------------------------------ */
/* Render: automod                                                     */
/* ------------------------------------------------------------------ */

function renderAutomod() {
  const cfg = state.config;
  const auto = cfg.automod;
  const ai = auto.aiModeration;

  const aiCategories = `<input class="input" data-path="automod.aiModeration.categories" data-type="csv" value="${esc(
    (ai.categories || []).join(', '),
  )}">`;

  return `<p class="intro">Regex filters catch links, GIFs and shouting. AI moderation is a Gemini Live classifier tuned for
    Moroccan Darija, Arabizi and French code-switching. AI checks still run for roles that bypass the regex filters.</p>

    ${card('Message filters', `<div class="grid cols-2">
        ${toggle('automod.blockUrls', auto.blockUrls, 'Block URLs', 'Deletes messages containing a link.')}
        ${toggle('automod.blockGifs', auto.blockGifs, 'Block GIFs', 'GIF uploads and GIF links.')}
        ${toggle('automod.blockCaps', auto.blockCaps, 'Block CAPS', 'Excessive capital letters.')}
      </div>
      ${grid([
        field('CAPS minimum length', numberInput('automod.capsMinLength', auto.capsMinLength, { min: 1, max: 500 })),
        field('CAPS maximum percent', numberInput('automod.capsMaxPercent', auto.capsMaxPercent, { min: 1, max: 100 })),
      ], 2)}
      ${grid([
        field('Mod-logs channel', channelSelect('automod.modLogsChannelId', auto.modLogsChannelId), 'Automod actions and AI flags are reported here.'),
      ], 1)}
      <div class="field">
        <span class="field-label">Alert roles</span>
        ${chipList('automod.alertRoleIds', auto.alertRoleIds, 'role')}
        <span class="hint">Pinged in mod-logs when AI moderation flags a message. Empty = ticket staff roles.</span>
      </div>`, { subtitle: 'Basic content filters' })}

    ${card('Exemptions', `${grid([
      field('GIF whitelist roles', chipList('automod.gifWhitelistRoles', auto.gifWhitelistRoles, 'role'), 'These roles may post GIF links.'),
      field('Bypass roles', chipList('automod.bypassRoles', auto.bypassRoles, 'role'), 'Skips regex filters (AI still applies).'),
      field('Ignored channels', chipList('automod.ignoredChannels', auto.ignoredChannels, 'channel'), 'Automod is disabled in these channels.'),
      field('Attachment-only channels', chipList('automod.attachmentOnlyChannels', auto.attachmentOnlyChannels, 'channel'), 'Messages without an attachment are removed.'),
    ], 1)}`)}

    ${card('AI moderation (Gemini Live)', `${toggle('automod.aiModeration.enabled', ai.enabled, 'Enable AI moderation', 'Fails open: if the model is unreachable, messages are allowed.')}
      ${grid([
        field('Model', textInput('automod.aiModeration.model', ai.model, { placeholder: 'gemini-3.8-live', list: 'ai-models' }), 'Use gemini-3.8-live for latency, or the extended-thinking model for harder cases.'),
        field('Thinking level', select('automod.aiModeration.thinkingLevel', ai.thinkingLevel, [
          { value: 'minimal', label: 'minimal' },
          { value: 'low', label: 'low' },
          { value: 'medium', label: 'medium' },
          { value: 'high', label: 'high' },
        ]), 'Ignored for gemini-3.8-live.'),
        field('Minimum message length', numberInput('automod.aiModeration.minLength', ai.minLength, { min: 0, max: 2000 })),
        field('Confidence threshold', numberInput('automod.aiModeration.confidenceThreshold', ai.confidenceThreshold, { min: 0, max: 1, step: 0.05 }), '0-1. Higher = fewer false positives.'),
      ], 2)}
      <datalist id="ai-models">
        <option value="gemini-3.8-live"></option>
        <option value="gemini-3.8-live-extended-thinking"></option>
      </datalist>
      ${field('Flag categories', aiCategories, 'Comma-separated, e.g. insult, hate, harassment, threat, spam, sexual')}
      ${field('System prompt', `<textarea class="input" data-path="automod.aiModeration.systemPrompt" data-type="string" rows="11">${esc(
        ai.systemPrompt,
      )}</textarea>`, 'Plain-English policy. The model must reply with JSON; the bot parses the verdict.')}
      <div class="section-note">${icon('info')}<span>
        <strong>Dry run.</strong> Saves the current settings, classifies the text below and shows the verdict without deleting anything.
      </span></div>
      <div class="field">
        <label>Test text</label>
        <textarea class="input" id="ai-test-text" rows="3" placeholder="e.g. nta 7mar, sir t9awed"></textarea>
      </div>
      <div class="btn-row"><button class="btn small" data-action="ai-test">Classify text</button></div>
      <div class="preview" id="ai-result">Verdict will appear here.</div>`,
      { subtitle: 'LLM-based moderation for Darija and Arabizi' })}`;
}

/* ------------------------------------------------------------------ */
/* Render: roles                                                       */
/* ------------------------------------------------------------------ */

function renderRoles() {
  const cfg = state.config;
  const mappings = Object.entries(cfg.reactionRoles.mappings || {});

  const mappingRows = mappings.length
    ? mappings
        .map(
          ([emoji, roleId]) => `<tr>
            <td><code>${esc(emoji)}</code></td>
            <td>${
              state.guild.available
                ? optionsSelect(roleOptions(false), { value: roleId }).replace(
                    '<select class="input"',
                    `<select class="input" data-mapping-key="${esc(emoji)}"`,
                  )
                : `<input class="input" data-mapping-key="${esc(emoji)}" value="${esc(roleId)}">`
            }</td>
            <td style="text-align:right"><button class="btn small danger" data-action="remove-mapping" data-key="${esc(emoji)}">Remove</button></td>
          </tr>`,
        )
        .join('')
    : emptyRow(3, 'No reaction-role mappings yet.');

  const reactionCard = card('Reaction roles', `${grid([
    field('Channel', channelSelect('reactionRoles.channelId', cfg.reactionRoles.channelId)),
    field('Message ID', textInput('reactionRoles.messageId', cfg.reactionRoles.messageId, { placeholder: 'Right-click → Copy Message ID' })),
  ], 2)}
    <div class="table-wrap"><table>
      <thead><tr><th>Emoji</th><th>Role</th><th></th></tr></thead>
      <tbody>${mappingRows}</tbody>
    </table></div>
    <div class="row">
      <input class="input" id="new-mapping-emoji" placeholder="Emoji (e.g. 👍 or <:name:id>)" style="max-width:260px">
      ${state.guild.available ? optionsSelect(roleOptions(true, '— pick a role —'), { id: 'new-mapping-role' }) : '<input class="input" id="new-mapping-role" placeholder="Role ID">'}
      <button class="btn small" data-action="add-mapping">Add mapping</button>
    </div>
    <div class="section-note">${icon('info')}<span>Reaction roles work on the saved message. Create the message with <code>/reactionroles setup</code>.</span></div>`,
    { subtitle: 'React to a message to grant a role' });

  const panelCards = cfg.roles.panels.length
    ? cfg.roles.panels.map((panel, index) => rolePanelCard(panel, index)).join('')
    : '<div class="empty">No button panels yet. Click “New panel” to add one.</div>';

  const verification = card('Verification', `${grid([
    field('Channel', channelSelect('verification.channelId', cfg.verification.channelId)),
    field('Message ID', textInput('verification.messageId', cfg.verification.messageId, { placeholder: 'Right-click → Copy Message ID' })),
    field('Role granted', roleSelect('verification.roleId', cfg.verification.roleId)),
    toggle('verification.showUnverify', cfg.verification.showUnverify, 'Show unverify button', 'Allow members to remove verification'),
  ], 2)}
    ${field('Embed title', textInput('verification.title', cfg.verification.title))}
    ${field('Embed description', textarea('verification.description', cfg.verification.description, { rows: 2 }))}
    ${messageNote(cfg.verification.channelId, cfg.verification.messageId, 'Post the verification message with /verify setup; this page edits the saved settings.')}`,
    { subtitle: 'Single button that grants the verified role' });

  return `<p class="intro">Button panels toggle roles for members. Edits here update the saved config — press “Update message” on a panel
    to push the new title, description and buttons to the Discord message.</p>
    ${reactionCard}
    ${card('Button role panels', `<div class="btn-row" style="margin-bottom:4px"><button class="btn small" data-action="add-role-panel">New panel</button></div>${panelCards}`, {
      subtitle: 'Self-assign roles, grouped by panel',
    })}
    ${verification}`;
}

function rolePanelCard(panel, index) {
  const buttonRows = panel.buttons.length
    ? panel.buttons
        .map(
          (button, buttonIndex) => `<tr>
            <td>${roleSelect(`roles.panels.${index}.buttons.${buttonIndex}.roleId`, button.roleId, { allowEmpty: false })}</td>
            <td>${textInput(`roles.panels.${index}.buttons.${buttonIndex}.label`, button.label, { maxlength: 80 })}</td>
            <td style="max-width:90px">${textInput(`roles.panels.${index}.buttons.${buttonIndex}.emoji`, button.emoji, { placeholder: '🎮' })}</td>
            <td style="min-width:150px">${select(`roles.panels.${index}.buttons.${buttonIndex}.style`, button.style, BUTTON_STYLES, { type: 'number' })}</td>
            <td style="text-align:right"><button class="btn small danger" data-action="remove-panel-button" data-panel-id="${esc(panel.id)}" data-button-index="${buttonIndex}">Remove</button></td>
          </tr>`,
        )
        .join('')
    : emptyRow(5, 'No buttons yet. Add a role below.');

  return `<div class="panel-card">
    <div class="panel-card-head">
      <div class="panel-card-title">
        <span class="pill accent">${esc(panel.id)}</span>
        ${textInput(`roles.panels.${index}.name`, panel.name, { placeholder: 'Panel name' })}
      </div>
      <div class="card-actions">
        <button class="btn small" data-action="publish-role-panel" data-panel-id="${esc(panel.id)}">${panel.messageId ? 'Update message' : 'Post to Discord'}</button>
        <button class="btn small danger" data-action="remove-role-panel" data-panel-id="${esc(panel.id)}">Delete</button>
      </div>
    </div>
    <div class="panel-card-body">
      ${grid([
        field('Channel', channelSelect(`roles.panels.${index}.channelId`, panel.channelId)),
        field('Embed title', textInput(`roles.panels.${index}.title`, panel.title)),
      ], 2)}
      ${field('Embed description', textarea(`roles.panels.${index}.description`, panel.description, { rows: 2 }))}
      ${toggle(`roles.panels.${index}.overrideRoles`, panel.overrideRoles, 'Only one role from this panel', 'Clicking a button removes the other roles from this panel (useful for colour roles).')}
      <div class="table-wrap"><table>
        <thead><tr><th>Role</th><th>Label</th><th>Emoji</th><th>Style</th><th></th></tr></thead>
        <tbody>${buttonRows}</tbody>
      </table></div>
      <div class="row">
        ${state.guild.available ? optionsSelect(roleOptions(true, '— add a role button —'), { id: `new-button-role-${panel.id}` }) : `<input class="input" id="new-button-role-${esc(panel.id)}" placeholder="Role ID">`}
        <button class="btn small" data-action="add-panel-button" data-panel-id="${esc(panel.id)}">Add button</button>
      </div>
      ${messageNote(panel.channelId, panel.messageId, 'This panel has not been posted yet. Pick a channel, save, then press “Post to Discord”.')}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Render: tickets                                                     */
/* ------------------------------------------------------------------ */

function renderTickets() {
  const cfg = state.config;
  const panels = cfg.tickets.panels.length
    ? cfg.tickets.panels.map((panel, index) => ticketPanelCard(panel, index)).join('')
    : '<div class="empty">No ticket panels yet. Click “New panel” to add one.</div>';

  return `<p class="intro">Members open a private channel by clicking a panel button. Staff roles can see tickets; ping roles are mentioned
    when one is created. Changes to form fields apply the next time a member opens a ticket.</p>

    ${card('Ticket system', `${grid([
      field('Ticket category', categorySelect('tickets.categoryId', cfg.tickets.categoryId), 'New ticket channels are created here.'),
      field('Log channel', channelSelect('tickets.logChannelId', cfg.tickets.logChannelId), 'Ticket events: open, claim, close, transcripts.'),
    ], 2)}
      <div class="field">
        <span class="field-label">Default staff roles</span>
        ${chipList('tickets.defaultStaffRoles', cfg.tickets.defaultStaffRoles, 'role')}
        <span class="hint">Used by panels that do not set their own staff roles.</span>
      </div>
      <div class="field">
        <span class="field-label">Default ping roles</span>
        ${chipList('tickets.defaultPingRoles', cfg.tickets.defaultPingRoles, 'role')}
      </div>`, { subtitle: 'Shared settings for every panel' })}

    ${card('Panels', `<div class="btn-row" style="margin-bottom:4px"><button class="btn small" data-action="add-ticket-panel">New panel</button></div>${panels}`, {
      subtitle: 'Each panel has its own channel, category, form and staff roles',
    })}`;
}

function ticketPanelCard(panel, index) {
  const fieldRows = panel.formFields.length
    ? panel.formFields
        .map(
          (formField, fieldIndex) => `<tr>
            <td>${textInput(`tickets.panels.${index}.formFields.${fieldIndex}.label`, formField.label, { maxlength: 45 })}</td>
            <td>${textInput(`tickets.panels.${index}.formFields.${fieldIndex}.placeholder`, formField.placeholder || '')}</td>
            <td>${select(`tickets.panels.${index}.formFields.${fieldIndex}.type`, formField.type, [
              { value: 'short', label: 'Short text' },
              { value: 'paragraph', label: 'Paragraph' },
            ])}</td>
            <td>${toggle(`tickets.panels.${index}.formFields.${fieldIndex}.required`, formField.required, 'Required')}</td>
            <td>${numberInput(`tickets.panels.${index}.formFields.${fieldIndex}.minLength`, formField.minLength, { optional: true, min: 0, max: 4000 })}</td>
            <td>${numberInput(`tickets.panels.${index}.formFields.${fieldIndex}.maxLength`, formField.maxLength, { optional: true, min: 1, max: 4000 })}</td>
            <td style="text-align:right"><button class="btn small danger" data-action="remove-form-field" data-panel-id="${esc(panel.id)}" data-field-index="${fieldIndex}">Remove</button></td>
          </tr>`,
        )
        .join('')
    : emptyRow(7, 'No form fields — the button opens a ticket immediately.');

  return `<div class="panel-card">
    <div class="panel-card-head">
      <div class="panel-card-title">
        <span class="pill accent">${esc(panel.id)}</span>
        ${textInput(`tickets.panels.${index}.name`, panel.name, { placeholder: 'Panel name' })}
      </div>
      <div class="card-actions">
        <button class="btn small" data-action="publish-ticket-panel" data-panel-id="${esc(panel.id)}">${panel.messageId ? 'Update message' : 'Post to Discord'}</button>
        <button class="btn small danger" data-action="remove-ticket-panel" data-panel-id="${esc(panel.id)}">Delete</button>
      </div>
    </div>
    <div class="panel-card-body">
      ${grid([
        field('Panel channel', channelSelect(`tickets.panels.${index}.channelId`, panel.channelId)),
        field('Ticket category', categorySelect(`tickets.panels.${index}.categoryId`, panel.categoryId)),
        field('Transcript channel', channelSelect(`tickets.panels.${index}.transcriptChannelId`, panel.transcriptChannelId), 'Falls back to the ticket log channel.'),
      ], 3)}
      ${grid([
        field('Embed title', textInput(`tickets.panels.${index}.title`, panel.title)),
        field('Button label', textInput(`tickets.panels.${index}.buttonLabel`, panel.buttonLabel, { maxlength: 80 })),
        field('Button emoji', textInput(`tickets.panels.${index}.buttonEmoji`, panel.buttonEmoji, { placeholder: '🎫' })),
        field('Button style', select(`tickets.panels.${index}.buttonStyle`, panel.buttonStyle, BUTTON_STYLES, { type: 'number' })),
      ], 2)}
      ${field('Embed description', textarea(`tickets.panels.${index}.description`, panel.description, { rows: 2 }))}
      ${field('Welcome message', textarea(`tickets.panels.${index}.welcomeMessage`, panel.welcomeMessage, { rows: 2 }), 'Placeholders: {user} and {panel}.')}
      <div class="grid cols-2">
        ${toggle(`tickets.panels.${index}.pingOnCreate`, panel.pingOnCreate, 'Ping staff when a ticket opens')}
        ${toggle(`tickets.panels.${index}.transcriptsEnabled`, panel.transcriptsEnabled, 'Save a transcript when closed')}
      </div>
      ${grid([field('Auto-close after (hours)', numberInput(`tickets.panels.${index}.autoCloseHours`, panel.autoCloseHours, { min: 0, max: 8760 }), '0 disables auto-close. Idle tickets only.')], 1)}
      <div class="field">
        <span class="field-label">Staff roles</span>
        ${chipList(`tickets.panels.${index}.staffRoles`, panel.staffRoles, 'role')}
      </div>
      <div class="field">
        <span class="field-label">Ping roles</span>
        ${chipList(`tickets.panels.${index}.pingRoles`, panel.pingRoles, 'role')}
      </div>
      <div class="field">
        <span class="field-label">Form fields</span>
        <div class="table-wrap"><table>
          <thead><tr><th>Label</th><th>Placeholder</th><th>Type</th><th>Required</th><th>Min</th><th>Max</th><th></th></tr></thead>
          <tbody>${fieldRows}</tbody>
        </table></div>
        <div class="btn-row"><button class="btn small" data-action="add-form-field" data-panel-id="${esc(panel.id)}">Add form field</button></div>
      </div>
      ${messageNote(panel.channelId, panel.messageId, 'This panel has not been posted yet. Pick a channel and category, save, then press “Post to Discord”.')}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Render: auto-reactions                                              */
/* ------------------------------------------------------------------ */

function renderAutoReact() {
  const entries = state.config.autoReactions || [];
  const rows = entries.length
    ? entries
        .map(
          (entry, index) => `<tr>
            <td>${channelSelect(`autoReactions.${index}.channelId`, entry.channelId, { allowEmpty: false })}</td>
            <td><input class="input" data-path="autoReactions.${index}.emojis" data-type="csv" value="${esc((entry.emojis || []).join(', '))}" placeholder="👍, ❤️, 🎉"></td>
            <td style="text-align:right"><button class="btn small danger" data-action="remove-auto-react" data-index="${index}">Remove</button></td>
          </tr>`,
        )
        .join('')
    : emptyRow(3, 'No auto-reaction channels yet.');

  return `<p class="intro">The bot reacts to every message in the listed channels with the chosen emojis — useful for starboards,
    suggestion channels or quick voting.</p>
    ${card('Auto-reaction channels', `<div class="table-wrap"><table>
        <thead><tr><th>Channel</th><th>Emojis (comma-separated)</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="row">
        ${state.guild.available ? optionsSelect(channelOptions(true, '— pick a channel —'), { id: 'new-autoreact-channel' }) : '<input class="input" id="new-autoreact-channel" placeholder="Channel ID">'}
        <input class="input" id="new-autoreact-emojis" placeholder="Emojis (e.g. 👍, 🔥)" style="max-width:280px">
        <button class="btn small" data-action="add-auto-react">Add channel</button>
      </div>`, { subtitle: 'React automatically to new messages' })}`;
}

/* ------------------------------------------------------------------ */
/* Render: auto-replies                                                */
/* ------------------------------------------------------------------ */

function renderAutoReply() {
  const cfg = state.config.autoReplies || { enabled: false, rules: [] };
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const cards = rules.length
    ? rules.map((rule, index) => autoReplyCard(rule, index)).join('')
    : '<div class="empty">No auto-reply rules yet. Click “New rule” to add one.</div>';

  return `<p class="intro">Reply automatically when a message matches one of your trigger phrases. Rules are checked in order and the
    first match replies once per message — bots are ignored, so a reply can never trigger another reply.</p>

    ${card('Auto-reply engine', `${toggle('autoReplies.enabled', cfg.enabled, 'Enable auto-replies', 'While this is off, no rule runs.')}
      <div class="btn-row"><button class="btn small" data-action="add-auto-reply">New rule</button></div>`, {
        subtitle: 'Keyword-triggered replies',
      })}

    ${cards}`;
}

function autoReplyCard(rule, index) {
  const base = `autoReplies.rules.${index}`;

  return `<div class="panel-card">
    <div class="panel-card-head">
      <div class="panel-card-title">
        <span class="pill accent">${esc(rule.id)}</span>
        ${textInput(`${base}.name`, rule.name, { placeholder: 'Rule name' })}
      </div>
      <div class="card-actions">
        <button class="btn small danger" data-action="remove-auto-reply" data-index="${index}">Delete</button>
      </div>
    </div>
    <div class="panel-card-body">
      ${toggle(`${base}.enabled`, rule.enabled, 'Rule enabled')}
      ${grid([
        field('Match type', select(`${base}.matchType`, rule.matchType, MATCH_TYPES), 'Regex rules use JavaScript syntax.'),
        field('Reply in', select(`${base}.respondIn`, rule.respondIn, RESPOND_IN), 'DM replies are skipped when a member blocks DMs.'),
        field('Cooldown (seconds)', numberInput(`${base}.cooldownSeconds`, rule.cooldownSeconds, { min: 0, max: 86400 }), 'Per member, per rule. 0 = reply to every match.'),
      ], 3)}
      ${field(
        'Triggers',
        `<input class="input" data-path="${esc(base)}.triggers" data-type="csv" value="${esc((rule.triggers || []).join(', '))}" placeholder="hello, salam, hi">`,
        'Comma-separated. Any trigger fires the rule.',
      )}
      ${field(
        'Reply',
        textarea(`${base}.reply`, rule.reply, { rows: 3, placeholder: 'Salam {username}! 👋' }),
        'Placeholders: {user} (mention), {username}, {server}, {channel}, {message}, {trigger}',
      )}
      <div class="grid cols-2">
        ${toggle(`${base}.caseSensitive`, rule.caseSensitive, 'Case sensitive')}
        ${toggle(`${base}.pingAuthor`, rule.pingAuthor, 'Allow the reply to ping the author')}
        ${toggle(`${base}.deleteTrigger`, rule.deleteTrigger, 'Delete the triggering message', 'Needs Manage Messages.')}
      </div>
      <div class="field">
        <span class="field-label">Channels</span>
        ${chipList(`${base}.channelIds`, rule.channelIds || [], 'channel')}
        <span class="hint">Empty = every channel the bot can read. Threads must be added by their own id.</span>
      </div>
      <div class="field">
        <span class="field-label">Bypass roles</span>
        ${chipList(`${base}.bypassRoleIds`, rule.bypassRoleIds || [], 'role')}
        <span class="hint">Members with any of these roles never trigger this rule.</span>
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Render: L7aj persona                                                */
/* ------------------------------------------------------------------ */

function renderL7aj() {
  const cfg = state.config.l7aj || {};
  const notes = state.meta.l7ajMemoryNotes;
  const keyReady = Boolean(state.meta.geminiKeyConfigured);

  const modelField = `${textInput('l7aj.model', cfg.model, {
    placeholder: 'gemini-3.8-live',
    list: 'l7aj-models',
  })}
  <datalist id="l7aj-models">
    <option value="gemini-3.8-live"></option>
    <option value="gemini-3.8-live-extended-thinking"></option>
  </datalist>`;

  return `<p class="intro">L7aj is a second Gemini Live client with its own personality. It reads the channels you pick,
    keeps a short conversation history, and decides on its own whether to reply or stay silent. Silence is the default:
    it only speaks when a normal member of the community would. It chooses per message whether to send a native reply
    or a bare message, can mention members it actually knows, and can use server emojis and stickers.</p>

    ${card('Persona engine', `${toggle('l7aj.enabled', cfg.enabled, 'Enable L7aj', 'While this is off, no channel is streamed to the model.')}
      ${grid([
        field('Display name', textInput('l7aj.displayName', cfg.displayName, { placeholder: 'L7aj', maxlength: 32 })),
        field('Model', modelField, 'gemini-3.8-live is the low-latency model. The extended-thinking variant needs a thinking level.'),
        field('Thinking level', select('l7aj.thinkingLevel', cfg.thinkingLevel, [
          { value: 'minimal', label: 'minimal' },
          { value: 'low', label: 'low' },
          { value: 'medium', label: 'medium' },
          { value: 'high', label: 'high' },
        ]), 'Ignored for gemini-3.8-live.'),
        field('Temperature', numberInput('l7aj.temperature', cfg.temperature, { min: 0, max: 2, step: 0.1 }), '1 is the default; lower is more predictable.'),
        field('Response timeout (ms)', numberInput('l7aj.requestTimeoutMs', cfg.requestTimeoutMs, { min: 5000, max: 60000, step: 1000 }), 'A timeout means silence, never a late reply.'),
      ], 2)}
      <div class="section-note">${icon('info')}<span>
        ${keyReady
          ? 'Uses the same Gemini API key as AI moderation.'
          : '<strong>No Gemini API key configured.</strong> Add one under Advanced → Secrets before enabling L7aj.'}
      </span></div>`, { subtitle: 'Model and response budget' })}

    ${card('Where it listens', `<div class="field">
        <label>Channels</label>
        ${chipList('l7aj.channelIds', cfg.channelIds || [], 'channel')}
        <span class="hint">L7aj reads every message in these channels and can answer in them. Empty = it listens nowhere.</span>
      </div>
      ${grid([
        field('History size', numberInput('l7aj.historySize', cfg.historySize, { min: 1, max: 100 }), 'How many earlier messages are sent as context.'),
        field('Batch window (ms)', numberInput('l7aj.batchWindowMs', cfg.batchWindowMs, { min: 250, max: 30000, step: 250 }), 'Messages arriving in this window become one decision.'),
      ], 2)}`, { subtitle: 'Channels and conversation context' })}

    ${card('Pacing and style', `${grid([
        field('Reply cooldown (seconds)', numberInput('l7aj.replyCooldownSeconds', cfg.replyCooldownSeconds, { min: 0, max: 86400 }), 'Minimum gap between two replies. 0 = no cooldown.'),
        field('Decision cooldown (seconds)', numberInput('l7aj.decisionCooldownSeconds', cfg.decisionCooldownSeconds, { min: 0, max: 3600 }), 'Minimum gap between model evaluations. Higher is cheaper and calmer.'),
        field('Max replies per hour', numberInput('l7aj.maxRepliesPerHour', cfg.maxRepliesPerHour, { min: 0, max: 1000 }), '0 = unlimited. A safety net, not a target.'),
        field('Max message length', numberInput('l7aj.maxMessageLength', cfg.maxMessageLength, { min: 1, max: 2000 }), 'Characters. Shorter messages feel more human.'),
        field('Minecraft server address', textInput('l7aj.minecraftServerAddress', cfg.minecraftServerAddress, { placeholder: 'play.example.com:25565' }), 'Optional. Enables the live status tool.'),
      ], 2)}
      <div class="grid cols-2">
        ${toggle('l7aj.showTyping', cfg.showTyping, 'Show the typing indicator', 'Appears while it decides, including when it ends up staying silent.')}
        ${toggle('l7aj.toolsEnabled', cfg.toolsEnabled, 'Enable information tools', 'History, member info, XP, leaderboard, server/voice info, time, reactions, emojis and stickers.')}
        ${toggle('l7aj.memoryEnabled', cfg.memoryEnabled, 'Enable memory', 'Let L7aj save and recall durable notes about members.')}
      </div>`, { subtitle: 'Cooldowns, length and capabilities' })}

    ${card('Character prompt', `${field(
      'System prompt',
      textarea('l7aj.systemPrompt', cfg.systemPrompt, { rows: 18 }),
      'The full L7aj character prompt. Empty uses the built-in L7aj prompt. The runtime contract (decision tools, formatting, privacy) is appended automatically.',
    )}`, { subtitle: 'Who L7aj is' })}

    ${card('Test the persona', `<div class="section-note">${icon('spark')}<span>
        <strong>Dry run.</strong> Saves the current settings, sends one message to the model with the last few channel messages as context,
        and shows the decision. Nothing is posted to Discord.
      </span></div>
      <div class="field">
        <label>Message to react to</label>
        <textarea class="input" id="l7aj-test-text" rows="3" placeholder="e.g. wa l7aj chno kat dir f had l3am"></textarea>
      </div>
      <div class="btn-row"><button class="btn small" data-action="l7aj-test">Ask L7aj</button></div>
      <div class="preview" id="l7aj-result">Decision will appear here.</div>`,
      { subtitle: 'See what it would do before enabling it' })}

    ${card('Memory', `<p class="muted">L7aj can save short factual notes about members and the server across restarts.
        Notes are stored in <code>data/l7aj-memory.json</code> and are never shown in Discord.</p>
      <div class="row">
        <span class="pill">${notes == null ? '—' : esc(notes)} saved note${notes === 1 ? '' : 's'}</span>
        <button class="btn small danger" data-action="clear-l7aj-memory" ${notes ? '' : 'disabled'}>Clear memory</button>
      </div>`, { subtitle: 'Durable notes' })}`;
}

/* ------------------------------------------------------------------ */
/* Render: stats                                                       */
/* ------------------------------------------------------------------ */

function renderStats() {
  const stats = state.stats;
  if (!stats) {
    return `<div class="empty">Stats are loading…</div>`;
  }

  const leaderboard = stats.xp.leaderboard.length
    ? stats.xp.leaderboard
        .map((row, index) => {
          const name = row.displayName || row.username;
          const secondary = row.username && row.username !== name ? `@${row.username}` : row.user_id;
          const avatar = row.avatarUrl
            ? `<img class="avatar" src="${esc(row.avatarUrl)}" alt="" width="32" height="32" loading="lazy">`
            : `<span class="avatar avatar-fallback" aria-hidden="true">${esc((name || '?').slice(0, 1).toUpperCase())}</span>`;
          return `<tr>
            <td>${index + 1}</td>
            <td><div class="member">${avatar}<div class="member-text">
              <span class="member-name">${esc(name || 'Unknown user')}</span>
              <span class="tiny muted">${esc(secondary)}</span>
            </div></div></td>
            <td>${esc(row.level)}</td>
            <td>${esc(row.xp)}</td>
            <td>${esc(row.voice_minutes)} min</td>
          </tr>`;
        })
        .join('')
    : emptyRow(5, 'No XP recorded yet.');

  const tickets = stats.tickets.recent.length
    ? stats.tickets.recent
        .map((ticket) => {
          const pillClass =
            ticket.status === 'open' ? 'accent' : ticket.status === 'claimed' ? 'warn' : 'ok';
          return `<tr>
            <td><code>${esc(ticket.id)}</code></td>
            <td><span class="pill ${pillClass}">${esc(ticket.status)}</span></td>
            <td>${esc(ticket.creatorName || ticket.creatorId)}</td>
            <td>${esc(ticket.panelId)}</td>
            <td>${esc(new Date(ticket.createdAt).toLocaleString())}</td>
          </tr>`;
        })
        .join('')
    : emptyRow(5, 'No tickets recorded yet.');

  return `<div class="btn-row" style="margin-bottom:14px">
      <button class="btn small" data-action="refresh-stats">Refresh</button>
      <span class="muted tiny">Read from data/talaba.json — not editable here.</span>
    </div>
    <div class="stats">
      ${statCard('Ranked members', stats.xp.ranked, 'have earned XP', 'users', 'blue')}
      ${statCard('All-time members', stats.xp.totalMembers, 'joins tracked by the bot', 'history', 'violet')}
      ${statCard('Open tickets', stats.tickets.open, 'open or claimed', 'tickets', 'amber')}
      ${statCard('Total tickets', stats.tickets.total, 'all time', 'spark', 'green')}
    </div>
    ${card('XP leaderboard', `<div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Member</th><th>Level</th><th>XP</th><th>Voice</th></tr></thead>
        <tbody>${leaderboard}</tbody>
      </table></div>`, { subtitle: 'Top 10 by total XP' })}
    ${card('Recent tickets', `<div class="table-wrap"><table>
        <thead><tr><th>ID</th><th>Status</th><th>Opened by</th><th>Panel</th><th>Created</th></tr></thead>
        <tbody>${tickets}</tbody>
      </table></div>`, { subtitle: 'The 15 most recent tickets' })}`;
}

/* ------------------------------------------------------------------ */
/* Render: advanced                                                    */
/* ------------------------------------------------------------------ */

function renderAdvanced() {
  const meta = state.meta || {};
  const tokenPill = `<span class="pill ${meta.tokenConfigured ? 'ok' : 'bad'}">${meta.tokenConfigured ? 'Configured' : 'Missing'}</span>`;
  const keyPill = `<span class="pill ${meta.geminiKeyConfigured ? 'ok' : 'bad'}">${meta.geminiKeyConfigured ? 'Configured' : 'Missing'}</span>`;
  const raw = JSON.stringify(state.config, null, 2);

  return `<p class="intro">The raw editor writes the same object the bot uses. Secrets are omitted from this view; saving preserves the
    existing token and Gemini key.</p>

    ${card('Secrets', `${grid([
      field(
        'Bot token',
        `<div class="row">${tokenPill}<span class="muted tiny">${esc(meta.tokenSource || 'missing')}</span></div>
         <input class="input" id="secret-token" type="password" autocomplete="off" placeholder="Paste a new bot token to replace the saved one">`,
        '<code>BOT_TOKEN</code> in .env overrides the file. A token change needs a bot restart.',
      ),
      field(
        'Gemini API key',
        `<div class="row">${keyPill}<span class="muted tiny">${esc(meta.geminiKeySource || 'missing')}</span></div>
         <input class="input" id="secret-gemini" type="password" autocomplete="off" placeholder="Paste a new Gemini API key">`,
        '<code>GEMINI_API_KEY</code> in .env overrides the file. AI moderation picks up a new key automatically.',
      ),
    ], 2)}
      <div class="btn-row"><button class="btn small" data-action="save-secrets">Save secrets</button>
        <span class="muted tiny">Leave a field blank to keep the current value.</span></div>`, {
      subtitle: 'Write-only secret fields',
    })}

    ${card('Raw configuration JSON', `${field(
      'config.json',
      `<textarea class="input tall" id="raw-json" spellcheck="false">${esc(raw)}</textarea>`,
      'Apply to form loads the JSON into the dashboard without saving. Then press “Save changes”.',
    )}
      <div class="btn-row">
        <button class="btn small" data-action="raw-apply">Apply to form</button>
        <button class="btn small ghost" data-action="raw-reset">Reset to saved</button>
        <button class="btn small ghost" data-action="reload-disk">Reload file from disk</button>
        <button class="btn small primary" data-action="save">Save changes</button>
      </div>`, { subtitle: 'Everything at once, for advanced edits' })}

    ${card('Environment', `<div class="table-wrap"><table>
        <tbody>
          <tr><th>Config file</th><td><code>${esc(meta.configPath || 'config.json')}</code></td></tr>
          <tr><th>Token source</th><td>${esc(meta.tokenSource || 'missing')}</td></tr>
          <tr><th>Gemini key source</th><td>${esc(meta.geminiKeySource || 'missing')}</td></tr>
          <tr><th>Revision</th><td><code>${esc(state.revision)}</code></td></tr>
          <tr><th>Dashboard</th><td><code>${esc((state.health && state.health.dashboard && state.health.dashboard.host) || '127.0.0.1')}:${esc((state.health && state.health.dashboard && state.health.dashboard.port) || 3000)}</code></td></tr>
        </tbody>
      </table></div>`, { subtitle: 'Where values come from' })}`;
}

/* ------------------------------------------------------------------ */
/* Nav + status + toasts                                               */
/* ------------------------------------------------------------------ */

function renderNav() {
  const groups = [];
  for (const section of sections) {
    let group = groups.find((entry) => entry.name === section.group);
    if (!group) {
      group = { name: section.group, items: [] };
      groups.push(group);
    }
    group.items.push(section);
  }

  navEl.innerHTML = groups
    .map(
      (group) => `<div class="nav-group">
        <span class="nav-group-label">${esc(group.name)}</span>
        ${group.items
          .map((section) => {
            const active = section.id === state.active;
            return `<button class="nav-item ${active ? 'active' : ''}" data-nav="${section.id}" title="${esc(section.label)}"${
              active ? ' aria-current="page"' : ''
            }>
              <span class="nav-icon">${icon(section.icon)}</span>
              <span class="nav-label">${esc(section.label)}</span>
            </button>`;
          })
          .join('')}
      </div>`,
    )
    .join('');
}

function setSidebarOpen(open) {
  document.body.classList.toggle('nav-open', open);
  const button = document.querySelector('.menu-btn');
  if (button) button.setAttribute('aria-expanded', String(open));
}

function renderActive(resetScroll = false) {
  const section = sections.find((entry) => entry.id === state.active) || sections[0];
  if (!state.config) return;

  document.getElementById('section-title').textContent = section.label;
  document.getElementById('section-subtitle').textContent = section.subtitle || '';
  document.title = `${section.label} · TALABA <3`;

  const scrollY = window.scrollY;
  contentEl.innerHTML = section.render();
  contentEl.classList.remove('swap');
  void contentEl.offsetWidth;
  contentEl.classList.add('swap');
  updatePreviews();
  updateDirty();

  if (resetScroll) {
    window.scrollTo({ top: 0 });
  } else {
    window.scrollTo(0, scrollY);
  }
}

function redraw() {
  renderNav();
  renderActive();
}

function setActive(id, updateHash) {
  if (!sections.some((section) => section.id === id)) return;
  state.active = id;
  if (updateHash && window.location.hash !== `#${id}`) {
    history.replaceState(null, '', `#${id}`);
  }
  setSidebarOpen(false);
  renderNav();
  renderActive(true);
}

function updateMetaUi() {
  const pathEl = document.getElementById('config-path');
  const meta = state.meta || {};
  pathEl.textContent = `${meta.configPath || 'config.json'} · token: ${meta.tokenSource || 'missing'}`;
  updateStatus();
}

function updateStatus() {
  const statusEl = document.getElementById('bot-status');
  const health = state.health;
  if (!statusEl || !health) return;

  const ready = Boolean(health.bot && health.bot.ready);
  statusEl.classList.toggle('online', ready);
  statusEl.classList.toggle('offline', !ready);
  const text = statusEl.querySelector('.status-text');
  if (text) {
    const guild = health.guild && health.guild.name ? ` · ${health.guild.name}` : '';
    text.textContent = ready ? `Online${guild}` : 'Bot offline';
  }

  const topbarStatus = document.getElementById('topbar-status');
  if (topbarStatus) {
    topbarStatus.classList.toggle('ok', ready);
    topbarStatus.classList.toggle('bad', !ready);
    const label = topbarStatus.querySelector('.status-label');
    if (label) label.textContent = ready ? 'Bot online' : 'Bot offline';
  }

  const avatar = document.getElementById('brand-avatar');
  const letter = document.getElementById('brand-letter');
  const avatarUrl = health.bot && health.bot.avatar;
  if (avatar && letter) {
    if (avatarUrl) {
      avatar.src = avatarUrl;
      avatar.classList.remove('hidden');
      letter.classList.add('hidden');
    } else {
      avatar.classList.add('hidden');
      letter.classList.remove('hidden');
    }
  }
}

function toast(message, type = 'info', timeout = 4500) {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  toastEl.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(4px)';
    node.style.transition = 'opacity .2s, transform .2s';
    setTimeout(() => node.remove(), 220);
  }, timeout);
}
