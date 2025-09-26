const SOURCE_VARIANTS = {
  live: { label: 'Live Feed', variant: 'live' },
  'eod-fallback': { label: 'Fallback Feed', variant: 'fallback' },
  mock: { label: 'Sample Data', variant: 'mock' },
};

function describeSource(meta = {}) {
  const key = meta.source && SOURCE_VARIANTS[meta.source] ? meta.source : 'live';
  const { label, variant } = SOURCE_VARIANTS[key] || SOURCE_VARIANTS.live;
  const extras = [];
  if (meta.mockSource) {
    extras.push(`origin: ${meta.mockSource}`);
  }
  if (meta.reason) {
    extras.push(`reason: ${meta.reason}`);
  }
  if (meta.kind) {
    extras.push(`kind: ${meta.kind}`);
  }
  return {
    label,
    variant,
    title: [`Source: ${label}`, ...extras].join('\n'),
  };
}

function formatRelativeTime(input) {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

function createElement(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

function createFeedCard({ title, subtitle, emptyMessage }) {
  const card = createElement('section', 'pro-card pro-feed-card');
  const header = createElement('header', 'pro-feed-header');
  const headingWrap = createElement('div', 'pro-feed-heading');
  const heading = createElement('h3');
  heading.textContent = title;
  headingWrap.appendChild(heading);

  if (subtitle) {
    if (typeof subtitle === 'string') {
      const sub = createElement('p', 'muted', subtitle);
      headingWrap.appendChild(sub);
    } else {
      subtitle.classList.add('muted');
      headingWrap.appendChild(subtitle);
    }
  }

  const badge = createElement('span', 'pro-badge');
  const sourceInfo = describeSource();
  badge.dataset.variant = sourceInfo.variant;
  badge.textContent = sourceInfo.label;
  badge.title = sourceInfo.title;

  const headerMeta = createElement('div', 'pro-feed-header-meta');
  headerMeta.appendChild(badge);

  header.append(headingWrap, headerMeta);
  card.appendChild(header);

  const notice = createElement('div', 'pro-feed-notice muted');
  notice.hidden = true;
  card.appendChild(notice);

  const body = createElement('div', 'pro-feed-body');
  const loader = createElement('div', 'pro-feed-loader', 'Fetching latest…');
  const empty = createElement('div', 'pro-feed-empty', emptyMessage || 'No records available.');
  empty.hidden = true;
  const list = createElement('div', 'pro-feed-scroll');
  list.setAttribute('role', 'list');

  body.append(loader, empty, list);
  card.appendChild(body);

  const setNotice = (message, variant = 'muted') => {
    if (!message) {
      notice.hidden = true;
      notice.textContent = '';
      notice.dataset.variant = '';
      return;
    }
    notice.hidden = false;
    notice.textContent = message;
    notice.dataset.variant = variant === 'muted' ? '' : variant;
  };

  const setSource = (meta = {}) => {
    const info = describeSource(meta);
    badge.dataset.variant = info.variant;
    badge.textContent = info.label;
    badge.title = info.title;
  };

  const setLoading = (flag) => {
    if (flag) {
      loader.hidden = false;
      card.classList.add('is-loading');
    } else {
      loader.hidden = true;
      card.classList.remove('is-loading');
    }
  };

  const setItems = (nodes) => {
    list.innerHTML = '';
    if (Array.isArray(nodes) && nodes.length) {
      nodes.forEach((node) => {
        if (node) {
          node.setAttribute('role', 'listitem');
          list.appendChild(node);
        }
      });
      empty.hidden = true;
    } else {
      empty.hidden = false;
    }
    loader.hidden = true;
  };

  return {
    element: card,
    setItems,
    setNotice,
    setSource,
    setLoading,
  };
}

function buildNewsItem(item, { onOpen } = {}) {
  const entry = createElement('article', 'pro-feed-item');

  const link = createElement('a', 'pro-feed-headline');
  link.textContent = item.headline || 'Untitled headline';
  if (item.url) {
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    if (typeof onOpen === 'function') {
      link.addEventListener('click', () => onOpen(item));
    }
  } else {
    link.href = '#';
    link.classList.add('is-disabled');
    link.addEventListener('click', (event) => event.preventDefault());
  }
  entry.appendChild(link);

  const meta = createElement('div', 'pro-feed-meta');
  const source = createElement('span');
  source.textContent = item.source || 'Tiingo';
  const time = createElement('time');
  time.textContent = formatRelativeTime(item.publishedAt);
  if (item.publishedAt) {
    time.dateTime = item.publishedAt;
  }
  meta.append(source, createElement('span', null, '•'), time);
  entry.appendChild(meta);

  if (item.summary) {
    const summary = createElement('p', 'pro-feed-summary');
    summary.textContent = item.summary;
    entry.appendChild(summary);
  }

  return entry;
}

function buildFilingItem(item, { onOpen, onPreview } = {}) {
  const entry = createElement('article', 'pro-feed-item');

  const header = createElement('div', 'pro-feed-filing-header');
  const type = createElement('span', 'pro-pill');
  type.textContent = item.documentType || 'Filing';
  header.appendChild(type);

  const link = createElement('a', 'pro-feed-headline');
  link.textContent = item.headline || item.documentType || 'Regulatory filing';
  if (item.url) {
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    if (typeof onOpen === 'function') {
      link.addEventListener('click', () => onOpen(item));
    }
  } else {
    link.href = '#';
    link.classList.add('is-disabled');
    link.addEventListener('click', (event) => event.preventDefault());
  }
  header.appendChild(link);
  entry.appendChild(header);

  const meta = createElement('div', 'pro-feed-meta');
  const source = createElement('span');
  source.textContent = item.source || 'SEC';
  const time = createElement('time');
  time.textContent = formatRelativeTime(item.publishedAt);
  if (item.publishedAt) {
    time.dateTime = item.publishedAt;
  }
  meta.append(source, createElement('span', null, '•'), time);
  entry.appendChild(meta);

  if (item.summary) {
    const summary = createElement('p', 'pro-feed-summary');
    summary.textContent = item.summary;
    entry.appendChild(summary);
  }

  if (item.url && typeof onPreview === 'function') {
    const actionRow = createElement('div', 'pro-feed-actions');
    const previewButton = createElement('button', 'pro-button tertiary', 'Preview filing');
    previewButton.type = 'button';
    previewButton.addEventListener('click', (event) => {
      event.preventDefault();
      onPreview(item);
    });
    actionRow.appendChild(previewButton);
    entry.appendChild(actionRow);
  }

  if (typeof onPreview === 'function') {
    entry.addEventListener('dblclick', () => onPreview(item));
  }

  return entry;
}

export function createNewsFeed(options = {}) {
  const subtitle = createElement('p');
  subtitle.innerHTML = 'Latest headlines for <span data-active-symbol></span>.';
  const feed = createFeedCard({ title: 'News Feed', subtitle, emptyMessage: 'No headlines published yet.' });

  return {
    element: feed.element,
    setLoading: feed.setLoading,
    update(data = {}) {
      const items = Array.isArray(data.rows) ? data.rows : [];
      const nodes = items.map((item) => buildNewsItem(item, options));
      feed.setItems(nodes);
      feed.setSource(data.meta || {});
      feed.setNotice(data.warning || '', data.warning ? 'warning' : 'muted');
    },
  };
}

export function createFilingsFeed(options = {}) {
  const subtitle = createElement('p');
  subtitle.innerHTML = 'Recent SEC activity for <span data-active-symbol></span>.';
  const feed = createFeedCard({ title: 'SEC Filings', subtitle, emptyMessage: 'No filings available.' });
  const nodeMap = new Map();

  return {
    element: feed.element,
    setLoading: feed.setLoading,
    update(data = {}) {
      const items = Array.isArray(data.rows) ? data.rows : [];
      nodeMap.clear();
      const nodes = items.map((item) => {
        const node = buildFilingItem(item, options);
        const id = item?.id || item?.url || (item?.documentType ? `${item.documentType}-${item?.publishedAt || ''}` : item?.publishedAt || '');
        if (id) {
          node.dataset.filingId = id;
          nodeMap.set(id, node);
        }
        return node;
      });
      feed.setItems(nodes);
      feed.setSource(data.meta || {});
      feed.setNotice(data.warning || '', data.warning ? 'warning' : 'muted');
    },
    setActive(id) {
      const activeId = id || '';
      nodeMap.forEach((node, key) => {
        if (!node) return;
        if (key === activeId) {
          node.classList.add('is-active');
        } else {
          node.classList.remove('is-active');
        }
      });
    },
  };
}

export function createMarketRadarShell(options = {}) {
  const card = createElement('section', 'pro-card pro-shell-card');
  const header = createElement('header', 'pro-shell-header');
  const title = createElement('h3', null, 'Market Radar');
  const badge = createElement('span', 'pro-badge subtle', 'Quant Screener');
  header.append(title, badge);
  card.appendChild(header);

  const body = createElement('div', 'pro-shell-body');
  const paragraph = createElement(
    'p',
    'muted',
    'Monitor breadth, liquidity pockets, and volatility regimes. The Market Radar will host the forthcoming quant screener heatmap.',
  );
  body.appendChild(paragraph);

  const actions = createElement('div', 'pro-shell-actions');
  const screenerButton = createElement('a', 'pro-button primary', 'Launch Screener');
  screenerButton.href = options.screenerUrl || 'quant-screener.html';
  screenerButton.target = options.openInNewTab ? '_blank' : '_self';
  screenerButton.rel = 'noopener';
  actions.appendChild(screenerButton);

  if (options.additionalLinks?.length) {
    options.additionalLinks.forEach((link) => {
      const btn = createElement('a', 'pro-button secondary', link.label || 'Open');
      btn.href = link.href || '#';
      btn.target = link.target || (options.openInNewTab ? '_blank' : '_self');
      if (btn.target === '_blank') {
        btn.rel = 'noopener';
      }
      actions.appendChild(btn);
    });
  } else {
    const analystLink = createElement('a', 'pro-button secondary', 'AI Analyst');
    analystLink.href = options.analystUrl || 'ai-analyst.html';
    analystLink.target = options.openInNewTab ? '_blank' : '_self';
    analystLink.rel = 'noopener';
    actions.appendChild(analystLink);
  }

  body.appendChild(actions);
  card.appendChild(body);

  return { element: card };
}

export function createDocumentViewer(options = {}) {
  const card = createElement('section', 'pro-card pro-document-review');
  const header = createElement('header', 'pro-shell-header');
  const title = createElement('h3', null, 'Document Review');
  const badge = createElement('span', 'pro-badge subtle', 'Inline preview');
  header.append(title, badge);
  card.appendChild(header);

  const info = createElement('div', 'pro-document-meta muted');
  const name = createElement('strong');
  info.appendChild(name);
  const details = createElement('span');
  info.appendChild(details);
  info.hidden = true;
  card.appendChild(info);

  const frame = document.createElement('iframe');
  frame.className = 'pro-document-frame';
  frame.title = 'SEC filing preview';
  frame.loading = 'lazy';
  frame.hidden = true;
  card.appendChild(frame);

  const placeholder = createElement(
    'div',
    'pro-document-placeholder',
    'Select a filing to preview it directly within the workspace. Supports most SEC PDF and HTML documents.',
  );
  card.appendChild(placeholder);

  const footer = createElement('div', 'pro-shell-actions');
  const openButton = createElement('a', 'pro-button secondary', 'Open in new tab');
  openButton.target = '_blank';
  openButton.rel = 'noopener';
  openButton.hidden = true;
  footer.appendChild(openButton);
  card.appendChild(footer);

  const setDocument = (doc) => {
    if (!doc || !doc.url) {
      placeholder.hidden = false;
      frame.hidden = true;
      info.hidden = true;
      openButton.hidden = true;
      frame.src = 'about:blank';
      return;
    }

    placeholder.hidden = true;
    frame.hidden = false;
    info.hidden = false;
    openButton.hidden = false;

    const typeLabel = (doc.documentType || '').trim();
    const headline = (doc.headline || '').trim();
    name.textContent = typeLabel && headline ? `${typeLabel} · ${headline}` : typeLabel || headline || 'Selected filing';

    const metaParts = [];
    if (doc.source) metaParts.push(doc.source);
    if (doc.publishedAt) {
      const filedDate = new Date(doc.publishedAt);
      if (!Number.isNaN(filedDate.getTime())) {
        metaParts.push(`Filed ${filedDate.toLocaleString()}`);
      }
    }
    details.textContent = metaParts.join(' • ');
    openButton.href = doc.url;
    frame.src = doc.url;
  };

  return {
    element: card,
    setDocument,
    clear: () => setDocument(null),
  };
}
