function createElement(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

function applyTone(element, tone) {
  if (!element) return;
  const valid = ['positive', 'neutral', 'caution', 'negative'];
  if (element.dataset) {
    element.dataset.tone = valid.includes(tone) ? tone : 'neutral';
  }
}

export function createResearchLabPanel(options = {}) {
  let activeSymbol = '';
  const card = createElement('section', 'pro-card pro-shell-card pro-research-card');
  const header = createElement('header', 'pro-shell-header');
  const title = createElement('h3', null, 'Research Lab');
  const badge = createElement('span', 'pro-badge subtle', 'Deep dives');
  header.append(title, badge);
  card.appendChild(header);

  const body = createElement('div', 'pro-shell-body');
  const summary = createElement('p', 'pro-research-summary muted');
  const positioning = createElement('div', 'pro-research-positioning');
  positioning.hidden = true;
  const positioningLabel = createElement('span', 'pro-research-positioning-label', 'Desk stance');
  const positioningText = createElement('strong');
  positioning.append(positioningLabel, positioningText);

  const metrics = createElement('div', 'pro-inline-metrics');
  const diligence = createElement('div', 'pro-research-diligence');
  const diligenceTitle = createElement('h4', null, 'Active diligence');
  const diligenceList = createElement('ul');
  diligence.append(diligenceTitle, diligenceList);

  const catalysts = createElement('div', 'pro-research-catalysts');
  const catalystsTitle = createElement('h4', null, 'Catalyst watch');
  const catalystsList = createElement('ul');
  catalysts.append(catalystsTitle, catalystsList);

  const loader = createElement('div', 'pro-shell-loader muted', 'Loading research insights…');
  loader.hidden = true;

  body.append(summary, positioning, metrics, diligence, catalysts, loader);
  card.appendChild(body);

  const actions = createElement('div', 'pro-shell-actions');
  const labButton = createElement('a', 'pro-button secondary', 'Open Research Lab');
  labButton.href = options.labUrl || 'valuation-lab.html';
  labButton.target = options.openInNewTab ? '_blank' : '_self';
  if (labButton.target === '_blank') labButton.rel = 'noopener';
  actions.appendChild(labButton);

  const notesButton = createElement('button', 'pro-button tertiary');
  notesButton.type = 'button';
  notesButton.textContent = 'Log follow-up';
  if (typeof options.onLogFollowUp === 'function') {
    notesButton.addEventListener('click', () => options.onLogFollowUp(activeSymbol));
  } else {
    notesButton.disabled = true;
  }
  actions.appendChild(notesButton);

  card.appendChild(actions);

  const buildMetric = (item) => {
    const metric = createElement('div', 'pro-inline-metric');
    const label = createElement('span', 'label', item.label || 'Metric');
    const value = createElement('strong', null, item.value || '—');
    if (item.delta) {
      const delta = createElement('span', 'delta', item.delta);
      metric.append(label, value, delta);
    } else {
      metric.append(label, value);
    }
    applyTone(metric, item.tone);
    return metric;
  };

  const buildDiligenceItem = (item) => {
    const li = createElement('li');
    const title = createElement('strong', null, item.title || 'Task');
    const meta = createElement('span', 'muted');
    const details = [];
    if (item.owner) details.push(item.owner);
    if (item.due) details.push(item.due);
    meta.textContent = details.join(' • ');
    li.append(title, meta);
    return li;
  };

  const buildCatalystItem = (item) => {
    const li = createElement('li');
    const badge = createElement('span', 'pro-pill', item.label || 'Upcoming');
    const text = createElement('span', null, item.detail || 'Pending update');
    li.append(badge, text);
    return li;
  };

  return {
    element: card,
    setLoading(flag) {
      loader.hidden = !flag;
      card.classList.toggle('is-loading', !!flag);
    },
    update(data) {
      const info = data || {};
      activeSymbol = info.symbol || '';
      summary.textContent = info.summary || 'Research stream unavailable.';
      summary.classList.toggle('muted', !info.summary);

      const stance = (info.positioning || '').trim();
      positioning.hidden = !stance;
      positioningText.textContent = stance;

      metrics.innerHTML = '';
      if (Array.isArray(info.quickStats) && info.quickStats.length) {
        info.quickStats.forEach((stat) => metrics.appendChild(buildMetric(stat)));
        metrics.hidden = false;
      } else {
        metrics.hidden = true;
      }

      diligenceList.innerHTML = '';
      if (Array.isArray(info.diligence) && info.diligence.length) {
        info.diligence.forEach((item) => diligenceList.appendChild(buildDiligenceItem(item)));
        diligence.hidden = false;
      } else {
        diligence.hidden = true;
      }

      catalystsList.innerHTML = '';
      if (Array.isArray(info.catalysts) && info.catalysts.length) {
        info.catalysts.forEach((item) => catalystsList.appendChild(buildCatalystItem(item)));
        catalysts.hidden = false;
      } else {
        catalysts.hidden = true;
      }

      this.setLoading(false);
    },
    setSource(meta) {
      if (!badge) return;
      if (meta?.label) {
        badge.textContent = meta.label;
      } else {
        badge.textContent = 'Deep dives';
      }
      badge.title = meta?.title || '';
    },
  };
}

export function createScreenerPreview(options = {}) {
  const card = createElement('section', 'pro-card pro-shell-card pro-screener-card');
  const header = createElement('header', 'pro-shell-header');
  const title = createElement('h3', null, 'Quant Screener');
  const badge = createElement('span', 'pro-badge subtle', 'Market radar');
  header.append(title, badge);
  card.appendChild(header);

  const body = createElement('div', 'pro-shell-body');
  const summary = createElement('p', 'pro-screener-summary muted');
  const metrics = createElement('div', 'pro-inline-metrics');
  const tableWrapper = createElement('div', 'pro-screener-table-wrapper');
  const table = createElement('table', 'pro-mini-table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Symbol', 'Upside', 'Key remark'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  tableWrapper.appendChild(table);

  const loader = createElement('div', 'pro-shell-loader muted', 'Screening universe…');
  loader.hidden = true;

  body.append(summary, metrics, tableWrapper, loader);
  card.appendChild(body);

  const actions = createElement('div', 'pro-shell-actions');
  const launch = createElement('a', 'pro-button primary', 'Run full screener');
  launch.href = options.screenerUrl || 'quant-screener.html';
  launch.target = options.openInNewTab ? '_blank' : '_self';
  if (launch.target === '_blank') launch.rel = 'noopener';
  actions.appendChild(launch);

  const exportBtn = createElement('a', 'pro-button secondary', 'Export latest batch');
  exportBtn.href = options.exportUrl || 'quant-screener.html#export';
  exportBtn.target = options.openInNewTab ? '_blank' : '_self';
  if (exportBtn.target === '_blank') exportBtn.rel = 'noopener';
  actions.appendChild(exportBtn);

  card.appendChild(actions);

  const buildMetric = (item) => {
    const metric = createElement('div', 'pro-inline-metric');
    const label = createElement('span', 'label', item.label || 'Metric');
    const value = createElement('strong', null, item.value || '—');
    metric.append(label, value);
    if (item.delta) {
      const delta = createElement('span', 'delta', item.delta);
      metric.appendChild(delta);
    }
    applyTone(metric, item.tone);
    return metric;
  };

  const buildRow = (item) => {
    const row = document.createElement('tr');
    const symbolCell = document.createElement('td');
    const link = document.createElement('a');
    link.textContent = item.symbol || '—';
    link.href = options.linkBuilder ? options.linkBuilder(item) : `quant-screener.html#${item.symbol || ''}`;
    link.target = options.openInNewTab ? '_blank' : '_self';
    if (link.target === '_blank') link.rel = 'noopener';
    symbolCell.appendChild(link);

    const upsideCell = document.createElement('td');
    upsideCell.textContent = item.upside || '—';

    const thesisCell = document.createElement('td');
    thesisCell.textContent = item.thesis || '—';

    row.append(symbolCell, upsideCell, thesisCell);
    return row;
  };

  return {
    element: card,
    setLoading(flag) {
      loader.hidden = !flag;
      card.classList.toggle('is-loading', !!flag);
    },
    update(data) {
      const info = data || {};
      summary.textContent = info.summary || 'Run a quant screen to populate candidates.';
      summary.classList.toggle('muted', !info.summary);

      metrics.innerHTML = '';
      if (Array.isArray(info.metrics) && info.metrics.length) {
        info.metrics.forEach((item) => metrics.appendChild(buildMetric(item)));
        metrics.hidden = false;
      } else {
        metrics.hidden = true;
      }

      tbody.innerHTML = '';
      if (Array.isArray(info.topIdeas) && info.topIdeas.length) {
        info.topIdeas.slice(0, 5).forEach((item) => tbody.appendChild(buildRow(item)));
        tableWrapper.hidden = false;
      } else {
        const emptyRow = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 3;
        cell.className = 'muted';
        cell.textContent = 'No screened ideas yet — trigger a batch run to populate candidates.';
        emptyRow.appendChild(cell);
        tbody.appendChild(emptyRow);
        tableWrapper.hidden = false;
      }

      this.setLoading(false);
    },
    setSource(meta) {
      if (!badge) return;
      if (meta?.label) {
        badge.textContent = meta.label;
      } else {
        badge.textContent = 'Market radar';
      }
      badge.title = meta?.title || '';
    },
  };
}
