const STATUS_LABELS = {
  idle: 'Idle',
  loading: 'Refreshing…',
  ok: 'Healthy',
  warning: 'Attention',
  error: 'Issue',
};

const LEVEL_VARIANTS = {
  info: 'info',
  warning: 'warning',
  error: 'error',
};

const MAX_LOG_ITEMS = 20;

function createElement(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

function formatClock(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

export function createDeskMonitor({ channels = [] } = {}) {
  const card = createElement('section', 'pro-card pro-shell-card pro-monitor-card');
  const header = createElement('header', 'pro-shell-header');
  const title = createElement('h3', null, 'Desk Monitor');
  const badge = createElement('span', 'pro-badge subtle', 'Health');
  header.append(title, badge);
  card.appendChild(header);

  const body = createElement('div', 'pro-shell-body pro-monitor-body');
  card.appendChild(body);

  const channelList = createElement('ul', 'pro-monitor-status-list');
  body.appendChild(channelList);

  const eventsHeading = createElement('h4', 'pro-monitor-subheading', 'Recent events');
  body.appendChild(eventsHeading);

  const logList = createElement('ul', 'pro-monitor-log');
  const emptyLog = createElement('li', 'pro-monitor-log-empty muted', 'No events yet.');
  logList.appendChild(emptyLog);
  body.appendChild(logList);

  const channelMap = new Map();

  const ensureChannel = (key, label) => {
    if (!key) return null;
    if (channelMap.has(key)) {
      const existing = channelMap.get(key);
      if (label && label !== existing.label) {
        existing.label = label;
        existing.labelEl.textContent = label;
      }
      return existing;
    }

    const item = createElement('li', 'pro-monitor-channel');
    item.dataset.state = 'idle';

    const headerRow = createElement('div', 'channel-header');
    const labelEl = createElement('span', 'channel-label', label || key);
    const statusEl = createElement('span', 'channel-status', STATUS_LABELS.idle);
    headerRow.append(labelEl, statusEl);

    const metaRow = createElement('div', 'channel-meta');
    const timeEl = document.createElement('time');
    timeEl.textContent = '—';
    const durationEl = createElement('span', 'channel-duration muted');
    durationEl.hidden = true;
    metaRow.append(timeEl, durationEl);

    const messageEl = createElement('p', 'channel-message muted', 'Awaiting first run.');

    item.append(headerRow, metaRow, messageEl);
    channelList.appendChild(item);

    const entry = { key, label: label || key, node: item, labelEl, statusEl, timeEl, durationEl, messageEl };
    channelMap.set(key, entry);
    return entry;
  };

  const setChannelState = (key, { status = 'idle', message = '', timestamp = Date.now(), duration }) => {
    const entry = ensureChannel(key);
    if (!entry) return;
    const stateKey = STATUS_LABELS[status] ? status : 'idle';
    entry.node.dataset.state = stateKey;
    entry.statusEl.textContent = STATUS_LABELS[stateKey];

    if (timestamp) {
      entry.timeEl.textContent = formatClock(timestamp);
      entry.timeEl.dateTime = new Date(timestamp).toISOString();
    } else {
      entry.timeEl.textContent = '—';
      entry.timeEl.removeAttribute('dateTime');
    }

    if (duration !== undefined) {
      const text = formatDuration(duration);
      if (text) {
        entry.durationEl.textContent = text;
        entry.durationEl.hidden = false;
      } else {
        entry.durationEl.hidden = true;
        entry.durationEl.textContent = '';
      }
    } else {
      entry.durationEl.hidden = true;
      entry.durationEl.textContent = '';
    }

    if (message) {
      entry.messageEl.textContent = message;
      entry.messageEl.classList.remove('muted');
    } else {
      entry.messageEl.textContent = '—';
      entry.messageEl.classList.add('muted');
    }
  };

  const log = (level = 'info', message, detail) => {
    if (!message) return;
    const variant = LEVEL_VARIANTS[level] ? level : 'info';
    const item = createElement('li');
    item.dataset.level = variant;
    const now = Date.now();
    const time = document.createElement('time');
    time.textContent = formatClock(now);
    time.dateTime = new Date(now).toISOString();
    const text = createElement('span', 'log-message', message);
    item.append(time, text);
    if (detail) {
      const detailEl = createElement('span', 'log-detail muted', detail);
      item.appendChild(detailEl);
    }
    if (emptyLog.isConnected) {
      logList.removeChild(emptyLog);
    }
    logList.prepend(item);
    while (logList.children.length > MAX_LOG_ITEMS) {
      logList.removeChild(logList.lastElementChild);
    }
  };

  const beginChannel = (key, label, { silent = false } = {}) => {
    const entry = ensureChannel(key, label);
    if (!entry) {
      return {
        success() {},
        warning() {},
        error() {},
      };
    }
    const start = Date.now();
    setChannelState(key, { status: 'loading', message: 'Refreshing…', timestamp: start });
    if (!silent) {
      log('info', `${entry.label} refresh started`);
    }

    return {
      success(details = {}) {
        const end = Date.now();
        const duration = end - start;
        const message = details.message || `Updated at ${formatClock(end)}`;
        setChannelState(key, { status: 'ok', message, timestamp: end, duration });
        if (!silent) {
          const durationLabel = formatDuration(duration);
          const info = details.logMessage || `${entry.label} updated`;
          const extra = details.detail || durationLabel;
          log('info', info, extra);
        }
      },
      warning(details = {}) {
        const end = Date.now();
        const duration = end - start;
        const message = details.message || `Needs attention — ${formatClock(end)}`;
        setChannelState(key, { status: 'warning', message, timestamp: end, duration });
        const info = details.logMessage || `${entry.label} warning`;
        const extra = details.detail || formatDuration(duration);
        log('warning', info, extra);
      },
      error(error, details = {}) {
        const end = Date.now();
        const duration = end - start;
        const message = details.message || error?.message || 'Failed to refresh';
        setChannelState(key, { status: 'error', message, timestamp: end, duration });
        const logMessage = details.logMessage || `${entry.label} failed`;
        const extra = details.detail || error?.message || formatDuration(duration);
        log('error', logMessage, extra);
      },
    };
  };

  channels.forEach((channel) => {
    if (channel?.key) {
      ensureChannel(channel.key, channel.label);
    }
  });

  const setNetworkState = (state, detail = '') => {
    const status = state === 'online' ? 'ok' : state === 'degraded' ? 'warning' : 'error';
    const message =
      state === 'online'
        ? detail || 'Connectivity restored'
        : state === 'degraded'
        ? detail || 'Connectivity degraded'
        : detail || 'Offline';
    setChannelState('connectivity', { status, message, timestamp: Date.now() });
    if (state === 'online') {
      log('info', 'Connectivity online', detail);
    } else if (state === 'degraded') {
      log('warning', 'Connectivity degraded', detail);
    } else {
      log('warning', 'Connectivity offline', detail);
    }
  };

  const registerChannel = (key, label) => {
    ensureChannel(key, label);
  };

  const setSymbol = (symbol) => {
    if (!symbol) return;
    log('info', `Active symbol changed`, symbol);
  };

  return {
    element: card,
    beginChannel,
    log,
    setNetworkState,
    registerChannel,
    setSymbol,
    setChannelState,
  };
}
