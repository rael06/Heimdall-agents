const token = new URLSearchParams(location.search).get('token') ?? '';

const el = (id) => document.getElementById(id);
const rowsBody = el('rows');

/**
 * Writes text only when it actually changed.
 *
 * Three of these elements are live regions now, and a live region is announced
 * whenever its content is *written*, not whenever it differs. The list restates
 * itself every thirty seconds on the full scan, so writing unconditionally
 * would have a screen reader read the counter aloud on a timer — which is how
 * an announcement channel gets switched off for good.
 */
function setText(node, text) {
  if (node.textContent !== text) {
    node.textContent = text;
  }
}

/**
 * Says something that is worth interrupting for and has nowhere on screen to
 * live: the stream dropping, a handover that led nowhere. The visible copy goes
 * to #service-state, which is not a live region on purpose.
 */
function announce(text) {
  const announcer = el('announcer');
  // Cleared first, so the same message twice in a row is still the second time.
  announcer.textContent = '';
  announcer.textContent = text;
}

/** Display priority, matching the service. */
const STATUSES = ['running', 'failed', 'idle', 'unknown'];
const PROVIDERS = ['claude', 'codex'];
/** A shape per status, so colour is never the only carrier. */
const GLYPH = {
  running: '●',
  failed: '■',
  idle: '▲',
  unknown: '◇',
};

const state = {
  sessions: new Map(),
  marks: { watched: [], favorites: [], unacknowledged: [] },
  service: null,
  /** id -> matched fields, or null when no search is active. */
  matched: null,
  selected: null,
  pendingOrder: null,
};

const filters = {
  q: '',
  scope: 'both',
  sort: 'created-desc',
  match: 'all',
  statuses: new Set(),
  providers: new Set(),
  workspaces: new Set(),
  from: '',
  to: '',
  watchedOnly: false,
  favoritesOnly: false,
};

// ---------------------------------------------------------------- settings

const SCAN_FIELDS = {
  'set-max': 'maxSessions',
  'set-history': 'historyDays',
  'set-stale': 'staleAfterMinutes',
  'set-subagents': 'includeSubagents',
  'set-autowatch': 'autoWatch',
  'set-handoff': 'handoffDelaySeconds',
};

function fillSettings(view) {
  el('set-claude-home').value = view.providers.claudeHome;
  el('set-codex-home').value = view.providers.codexHome;
  el('set-claude-home').placeholder = view.effective.claudeHome;
  el('set-codex-home').placeholder = view.effective.codexHome;
  for (const [id, key] of Object.entries(SCAN_FIELDS)) {
    const input = el(id);
    if (input.type === 'checkbox') input.checked = Boolean(view.scan[key]);
    else input.value = String(view.scan[key]);
  }
  // Language and dates belong to the view, not to the service: they are stored
  // here like the theme, and take effect without a restart.
  el('set-language').value = localStorage.getItem('language') ?? 'auto';
  el('set-date-locale').value = localStorage.getItem('dateLocale') ?? 'auto';

  // A bare service has no window to start at login and no tray to show, so the
  // section is not offered rather than offered and ignored.
  const host = el('host-settings');
  host.hidden = !view.host;
  if (view.host) {
    el('set-login').checked = view.host.startsWithLogin;
    el('set-tray').checked = view.host.trayVisible;
  }
  el('settings-note').textContent = '';
}

async function openSettings() {
  try {
    fillSettings(await api('/api/settings'));
    el('settings').showModal();
  } catch (error) {
    el('service-state').textContent = t('settings.unavailable', { error: error.message });
  }
}

async function saveSettings() {
  const scan = {};
  for (const [id, key] of Object.entries(SCAN_FIELDS)) {
    const input = el(id);
    scan[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
  }
  const body = {
    providers: {
      claudeHome: el('set-claude-home').value.trim(),
      codexHome: el('set-codex-home').value.trim(),
    },
    scan,
    host: el('host-settings').hidden
      ? undefined
      : { startsWithLogin: el('set-login').checked, trayVisible: el('set-tray').checked },
  };
  const result = await post('/api/settings', body);
  fillSettings(result.saved);

  if (!result.restartRequired) {
    el('settings-note').textContent = t('settings.saved');
    return;
  }
  // The providers are built once, with these values. Nothing short of building
  // them again can adopt a new one, so the restart is the setting taking hold
  // rather than a suggestion.
  el('settings-note').textContent = t('settings.savedRestarting');
  await post('/api/restart').catch(() => undefined);
}

async function detectProviders() {
  const button = el('detect');
  button.disabled = true;
  el('detect-result').textContent = t('settings.detectLooking');
  try {
    const { providers } = await api('/api/settings/detect');
    const lines = [];
    for (const found of providers) {
      if (found.best) {
        el(found.provider === 'claude' ? 'set-claude-home' : 'set-codex-home').value = found.best;
        const winner = found.candidates.find((c) => c.path === found.best);
        lines.push(t('settings.detectFound', { provider: found.provider, count: winner.transcripts }));
      } else {
        // Saying nothing was found is more useful than filling a field with a
        // directory that happens to exist and holds no transcript.
        lines.push(t('settings.detectNothing', { provider: found.provider }));
      }
    }
    el('detect-result').textContent = lines.join(' · ');
  } catch (error) {
    el('detect-result').textContent = t('settings.failed', { error: error.message });
  } finally {
    button.disabled = false;
  }
}

// ------------------------------------------------------------------- theme

const THEMES = ['auto', 'light', 'dark'];

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const toRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

const parseRgb = (value) => (value.match(/\d+/g) ?? ['255', '255', '255']).slice(0, 3).map(Number);

/** The background actually painted, which resolves whatever light-dark() chose. */
function backgroundRgb() {
  return parseRgb(getComputedStyle(document.body).backgroundColor);
}

/**
 * The accent as painted. A custom property reads back as its unresolved token,
 * `light-dark(…, …)`, so it is asked of an element that has actually applied it.
 */
function paintedAccent() {
  const probe = document.createElement('span');
  probe.style.cssText = 'color: var(--accent); position: absolute; visibility: hidden';
  document.body.append(probe);
  const painted = parseRgb(getComputedStyle(probe).color);
  probe.remove();
  return toHex(painted);
}

/**
 * A readable version of the chosen colour.
 *
 * The frame only has to be seen, so it wears the colour as picked. The accent is
 * read as text — a link, a pressed chip — and a colour chosen at random is
 * about as likely to be illegible as not. So it is walked towards white or
 * black, whichever the background is not, until it clears 4.5:1.
 */
function readable(hex, background) {
  const target = luminance(background) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  let colour = toRgb(hex);
  for (let step = 0; step < 40 && contrast(colour, background) < 4.5; step += 1) {
    colour = colour.map((value, index) => value + (target[index] - value) * 0.08);
  }
  return toHex(colour);
}

function applyAppearance() {
  const theme = localStorage.getItem('theme') ?? 'auto';
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
  el('theme').textContent = `${t('bar.theme')}: ${theme}`;
  el('theme').title = t('bar.themeTitle');

  const primary = localStorage.getItem('primary');
  if (primary) {
    root.style.setProperty('--primary', primary);
    // Read after the theme is applied: the background it must stand out from
    // has just changed.
    root.style.setProperty('--accent', readable(primary, backgroundRgb()));
    el('primary').value = primary;
  } else {
    root.style.removeProperty('--primary');
    root.style.removeProperty('--accent');
    // The swatch shows what is in force, so opening it starts from the theme's
    // own accent rather than from black.
    el('primary').value = paintedAccent();
  }
}

// ---------------------------------------------------------------- transport

async function api(path, options) {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`${path}${separator}token=${encodeURIComponent(token)}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`${response.status} on ${path}`);
  }
  return response.json();
}

const post = (path, body) =>
  api(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

// ------------------------------------------------------------------ format

/** The language in force, resolved once per render pass. */
function language() {
  return resolveLanguage(localStorage.getItem('language') ?? 'auto', navigator.languages);
}

function t(key, values) {
  return translate(language(), key, values);
}

/**
 * The locale dates are written in. `auto` follows the language; `iso` keeps the
 * sortable form, which is the only one that cannot be misread — 01/08 is the
 * first of August or the eighth of January depending on where you are, and a
 * list of dates is exactly where that matters.
 */
function dateLocale() {
  const stored = localStorage.getItem('dateLocale') ?? 'auto';
  if (stored === 'iso') return 'iso';
  if (stored !== 'auto') return stored;
  return language() === 'fr' ? 'fr-FR' : 'iso';
}

function at(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '?';
  }
  const locale = dateLocale();
  if (locale === 'iso') {
    const pad = (value) => String(value).padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Walks the marked elements and writes the current language into them. Called
 * again on every change, so switching costs no reload.
 */
function applyLanguage() {
  const lang = language();
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = translate(lang, node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.title = translate(lang, node.dataset.i18nTitle);
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = translate(lang, node.dataset.i18nPlaceholder);
  }
  for (const node of document.querySelectorAll('[data-i18n-aria-label]')) {
    node.setAttribute('aria-label', translate(lang, node.dataset.i18nAriaLabel));
  }
  // The two that name themselves rather than carrying a fixed key.
  const system = resolveLanguage('auto', navigator.languages);
  el('set-language').options[0].textContent = translate(lang, 'settings.languageAuto', {
    name: system === 'fr' ? 'Français' : 'English',
  });
  el('set-date-locale').options[0].textContent = translate(lang, 'settings.dateFollows');
  el('set-date-locale').options[1].textContent = translate(lang, 'settings.dateIso');
}

function day(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const folder = (cwd) => (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : '-');

function minutesSince(iso) {
  const started = Date.parse(iso);
  if (Number.isNaN(started)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - started) / 60000));
}

// ------------------------------------------------------------- URL as state

const SORT_KEYS = ['status', 'created', 'updated', 'provider', 'workspace', 'title'];
/** The direction a column takes on its first click, which is the useful one. */
const FIRST_DIRECTION = {
  status: 'asc',
  created: 'desc',
  updated: 'desc',
  provider: 'asc',
  workspace: 'asc',
  title: 'asc',
};

/** Accepts the names earlier versions wrote, so an old bookmark still sorts. */
function normalizeSort(value) {
  if (!value) return 'created-desc';
  if (value === 'status' || value === 'title') return `${value}-asc`;
  const at = value.lastIndexOf('-');
  const key = value.slice(0, at);
  const direction = value.slice(at + 1);
  return SORT_KEYS.includes(key) && (direction === 'asc' || direction === 'desc')
    ? value
    : 'created-desc';
}

function readUrl() {
  const query = new URLSearchParams(location.search);
  const set = (name) => new Set((query.get(name) ?? '').split(',').filter(Boolean));
  filters.q = query.get('q') ?? '';
  filters.scope = query.get('scope') ?? 'both';
  filters.sort = normalizeSort(query.get('sort'));
  filters.match = query.get('match') === 'any' ? 'any' : 'all';
  filters.statuses = set('status');
  filters.providers = set('provider');
  filters.workspaces = set('ws');
  filters.from = query.get('from') ?? '';
  filters.to = query.get('to') ?? '';
  filters.watchedOnly = query.get('watched') === '1';
  filters.favoritesOnly = query.get('starred') === '1';
}

/**
 * Filters, sort and search live in the URL, so a view is reloadable and can be
 * kept as a bookmark — "what is waiting on webshop" as a favourite.
 */
function writeUrl() {
  const query = new URLSearchParams();
  const put = (name, value) => value && query.set(name, value);
  put('q', filters.q);
  if (filters.scope !== 'both') query.set('scope', filters.scope);
  if (filters.sort !== 'created-desc') query.set('sort', filters.sort);
  if (filters.match !== 'all') query.set('match', filters.match);
  put('status', [...filters.statuses].join(','));
  put('provider', [...filters.providers].join(','));
  put('ws', [...filters.workspaces].join(','));
  put('from', filters.from);
  put('to', filters.to);
  if (filters.watchedOnly) query.set('watched', '1');
  if (filters.favoritesOnly) query.set('starred', '1');
  // The token stays in the URL: without it a reload cannot talk to the service.
  query.set('token', token);
  history.replaceState(null, '', `${location.pathname}?${query}`);
}

// ------------------------------------------------------------- selection

function passes(session) {
  const marks = state.marks;
  // A search is answered by the service, which reads the transcripts. It always
  // narrows, whatever the match mode: widening it would return sessions that do
  // not contain what you typed.
  if (state.matched && !state.matched[session.id]) return false;

  // One entry per filter actually switched on. An inactive filter is absent
  // rather than "true", which is what lets "any" mean "one of the things I
  // asked for" instead of "everything".
  const verdicts = [];
  if (filters.watchedOnly) verdicts.push(marks.watched.includes(session.id));
  if (filters.favoritesOnly) verdicts.push(marks.favorites.includes(session.id));
  if (filters.statuses.size) verdicts.push(filters.statuses.has(session.status));
  if (filters.providers.size) verdicts.push(filters.providers.has(session.provider));
  if (filters.workspaces.size) {
    verdicts.push(Boolean(session.cwd) && filters.workspaces.has(session.cwd));
  }
  if (filters.from || filters.to) {
    const created = day(session.createdAt);
    verdicts.push(
      Boolean(created) &&
        (!filters.from || created >= filters.from) &&
        (!filters.to || created <= filters.to),
    );
  }

  if (!verdicts.length) return true;
  return filters.match === 'any' ? verdicts.some(Boolean) : verdicts.every(Boolean);
}

const time = (iso) => Date.parse(iso) || 0;
const byTitle = (a, b) => a.title.localeCompare(b.title);

/** Ascending is defined once per column and flipped, rather than written twice. */
const ASCENDING = {
  // Rank ascending, so running comes first: the priority order.
  status: (a, b) =>
    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || time(b.updatedAt) - time(a.updatedAt),
  created: (a, b) => time(a.createdAt) - time(b.createdAt),
  updated: (a, b) => time(a.updatedAt) - time(b.updatedAt),
  provider: (a, b) => a.provider.localeCompare(b.provider),
  workspace: (a, b) => (a.cwd ?? '').localeCompare(b.cwd ?? ''),
  title: byTitle,
};

function splitSort(sort) {
  const at = sort.lastIndexOf('-');
  return { key: sort.slice(0, at), ascending: sort.slice(at + 1) === 'asc' };
}

/**
 * Watched sessions come first, then starred ones, then the rest — the chosen
 * ordering still applies inside each group.
 *
 * A marker is set automatically when a session starts working, so this can move
 * a row without anyone asking. It never moves on its own: `render` compares the
 * order it wants against the order on screen and offers the move instead.
 */
function comparator(sort) {
  const { key, ascending } = splitSort(sort);
  const primary = ASCENDING[key] ?? ASCENDING.created;
  const ordered = (a, b) => (ascending ? primary(a, b) : -primary(a, b)) || byTitle(a, b);

  const rank = (session) => {
    if (state.marks.watched.includes(session.id)) return 0;
    return state.marks.favorites.includes(session.id) ? 1 : 2;
  };
  return (a, b) => rank(a) - rank(b) || ordered(a, b);
}

function targetOrder() {
  return [...state.sessions.values()].filter(passes).sort(comparator(filters.sort)).map((s) => s.id);
}

// ---------------------------------------------------------------- rendering

function createRow(id) {
  const tr = document.createElement('tr');
  tr.dataset.id = id;
  tr.innerHTML =
    '<td><button class="marker status" type="button"></button></td>' +
    '<td><button class="marker watched" type="button" aria-pressed="false"></button></td>' +
    '<td><button class="marker favorite" type="button" aria-pressed="false"></button></td>' +
    '<td><button class="marker transcript" type="button">▤</button></td>' +
    '<td class="num"></td><td class="at created"></td><td class="at updated"></td>' +
    '<td><span class="badge"></span></td>' +
    '<td class="ws"><button class="link" type="button"></button></td>' +
    '<td class="title"><button class="link text" type="button"></button>' +
    '<span class="matched"></span></td>';
  tr.querySelector('.status').addEventListener('click', () => acknowledge([id]));
  tr.querySelector('.watched').addEventListener('click', () => toggleMark('watched', id));
  tr.querySelector('.favorite').addEventListener('click', () => toggleMark('favorite', id));
  // A click lands on the thing it means, never on the row: a stray click in the
  // margin opens nothing.
  tr.querySelector('.transcript').addEventListener('click', () => open(id, 'transcript'));
  tr.querySelector('.ws .link').addEventListener('click', () => open(id, 'workspace'));
  tr.querySelector('.title .link').addEventListener('click', () => open(id, 'session'));
  return tr;
}

function updateRow(tr, session) {
  const watched = state.marks.watched.includes(session.id);
  const unseen = state.marks.unacknowledged.includes(session.id);

  const status = tr.querySelector('.status');
  status.textContent = GLYPH[session.status] ?? '?';
  status.dataset.status = session.status;
  status.dataset.unseen = String(unseen);
  // An inferred status has to justify itself, and the label carries the meaning
  // for anyone who cannot see the shape.
  const label = statusLabel(session.status);
  status.setAttribute('aria-label', unseen ? `${label}, ${t('row.unacknowledged')}` : label);
  status.title = `${label} — ${session.statusReason}` + (unseen ? `\n${t('row.acknowledge')}` : '');

  // A hollow shape when unset and a filled one when set. Drawing both the same
  // and colouring the difference makes every row look marked at a glance, and
  // leaves nothing at all for anyone who does not see the colour.
  const favorite = state.marks.favorites.includes(session.id);
  const mark = (selector, on, offGlyph, onGlyph, onKey, offKey) => {
    const button = tr.querySelector(selector);
    button.textContent = on ? onGlyph : offGlyph;
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', t(on ? onKey : offKey));
    button.title = t(on ? onKey : offKey);
  };
  mark('.watched', watched, '○', '◉', 'row.watchedOn', 'row.watchedOff');
  mark('.favorite', favorite, '☆', '★', 'row.starredOn', 'row.starredOff');
  // Set here rather than in the markup, so it follows the language like the rest.
  const transcript = tr.querySelector('.transcript');
  transcript.title = t('row.openTranscript');
  transcript.setAttribute('aria-label', t('row.openTranscript'));

  // Every cell is addressed by name rather than by position. An index has to be
  // kept in step with the markup by hand, and one of them was not: the minute
  // timer wrote into the transcript cell, destroyed the button it held, and the
  // next redraw died looking for it — which froze every marker below that row.
  // Minutes only on watched rows: the point is how long the handful you follow
  // have been sitting in their current state.
  tr.querySelector('.num').textContent = watched
    ? `${minutesSince(session.statusChangedAt)}m`
    : '';
  tr.querySelector('.created').textContent = at(session.createdAt);
  tr.querySelector('.updated').textContent = at(session.updatedAt);
  tr.querySelector('.badge').textContent = session.provider;
  const ws = tr.querySelector('.ws .link');
  ws.textContent = folder(session.cwd);
  ws.title = session.cwd ? `${t('row.openWorkspace')} ${session.cwd}` : t('row.workspaceUnknown');
  const title = tr.querySelector('.title .link');
  title.textContent = session.title;
  // The whole title, since the column cuts it — and what a click does, which
  // the tooltip was saying alone before.
  title.title = `${session.title}\n\n${t('row.openSession')}`;
  const matched = state.matched?.[session.id] ?? [];
  tr.querySelector('.title .matched').textContent = matched.length ? `[${matched.join(', ')}]` : '';
}

function syncRows(target, applyOrder) {
  const present = new Map([...rowsBody.children].map((tr) => [tr.dataset.id, tr]));
  const wanted = new Set(target);

  for (const [id, tr] of present) {
    if (!wanted.has(id)) {
      tr.remove();
      present.delete(id);
    }
  }

  if (applyOrder) {
    for (const id of target) {
      const tr = present.get(id) ?? createRow(id);
      present.set(id, tr);
      rowsBody.append(tr);
    }
  } else {
    // A new row goes where the sort says. The rows already on screen do not
    // move: an update repaints them in place, and nothing jumps under the
    // cursor.
    for (let index = 0; index < target.length; index += 1) {
      const id = target[index];
      if (present.has(id)) continue;
      let anchor = null;
      for (let next = index + 1; next < target.length; next += 1) {
        const candidate = present.get(target[next]);
        if (candidate) {
          anchor = candidate;
          break;
        }
      }
      const tr = createRow(id);
      rowsBody.insertBefore(tr, anchor);
      present.set(id, tr);
    }
  }

  for (const id of target) {
    const session = state.sessions.get(id);
    const tr = present.get(id);
    if (session && tr) updateRow(tr, session);
  }
  return [...rowsBody.children].map((tr) => tr.dataset.id);
}

function render(applyOrder = false) {
  const target = targetOrder();
  const shown = syncRows(target, applyOrder);

  // If the sort would genuinely reorder the rows on screen, the list does not
  // jump: it offers to do it when you ask.
  const moved = shown.filter((id, index) => target[index] !== id).length;
  const reorder = el('reorder');
  if (moved > 0 && !applyOrder) {
    state.pendingOrder = true;
    setText(reorder, t('state.reorder', { count: moved }));
    reorder.classList.remove('hidden');
  } else {
    state.pendingOrder = null;
    // Emptied as well as hidden: it shares a live region with the counter, and
    // a hidden button that keeps its text would be read out with it.
    setText(reorder, '');
    reorder.classList.add('hidden');
  }

  setText(
    el('counts'),
    t('state.counts', { visible: target.length, loaded: state.sessions.size }),
  );
  renderEmpty(target.length);
  renderWorkspaces();
  if (state.selected && !target.includes(state.selected)) {
    select(null);
  }
}

function renderEmpty(visible) {
  const empty = el('empty');
  if (visible > 0) {
    empty.classList.add('hidden');
    // Cleared, or the live region would still hold the last "nothing matched".
    setText(empty, '');
    return;
  }
  empty.classList.remove('hidden');
  if (state.sessions.size > 0) {
    setText(empty, t('state.noMatch'));
    return;
  }
  // An empty list must say where it looked; a missing provider is not the same
  // thing as a quiet one.
  const roots = (state.service?.providers ?? [])
    .map((provider) => t('state.emptyProvider', { provider: provider.provider, root: provider.root }))
    .join('\n');
  setText(empty, roots || t('state.nothingFound'));
}

/**
 * The notices, rebuilt only when they actually say something different.
 *
 * This used to empty the container and refill it on every state event, which is
 * every scan. That is invisible when it only paints, and not invisible at all
 * now that it is a live region: identical notices, torn down and put back every
 * thirty seconds, would be read out every thirty seconds.
 */
function renderNotices() {
  const notices = el('notices');
  const service = state.service;
  const messages = [];
  if (service) {
    if (service.paused) messages.push(t('notice.paused'));
    for (const provider of service.providers) {
      if (provider.error) {
        messages.push(t('notice.scanFailed', {
          provider: provider.provider, root: provider.root, error: provider.error,
        }));
      }
    }
    for (const failure of service.watchFailures) {
      messages.push(t('notice.notWatching', { root: failure.root, error: failure.error }));
    }
    if (service.truncated > 0) {
      messages.push(t('notice.truncated', { count: service.truncated }));
    }
  }

  // A newline, not a NUL, for the same reason the workspace list uses one.
  const signature = messages.join('\n');
  if (notices.dataset.signature === signature) {
    return;
  }
  notices.dataset.signature = signature;
  notices.textContent = '';
  for (const message of messages) {
    const div = document.createElement('div');
    div.className = 'notice';
    div.textContent = message;
    notices.append(div);
  }
}

function renderWorkspaces() {
  const list = el('workspace-list');
  const known = [...new Set([...state.sessions.values()].map((s) => s.cwd).filter(Boolean))].sort();
  // A newline, not a NUL: a control byte in a source file makes it read as
  // binary to grep and to diffs, which costs more than it buys. A path cannot
  // contain either, so both work as a separator.
  const signature = known.join('\n');
  if (list.dataset.signature !== signature) {
    list.dataset.signature = signature;
    list.textContent = '';
    for (const cwd of known) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = cwd;
      box.addEventListener('change', () => {
        if (box.checked) filters.workspaces.add(cwd);
        else filters.workspaces.delete(cwd);
        applyFilters();
      });
      const text = document.createElement('span');
      text.textContent = cwd;
      label.append(box, text);
      list.append(label);
    }
  }
  for (const box of list.querySelectorAll('input')) {
    box.checked = filters.workspaces.has(box.value);
  }
  el('workspace-count').textContent = filters.workspaces.size ? `(${filters.workspaces.size})` : '';
}

// ------------------------------------------------------------------ actions

async function toggleMark(kind, id) {
  const path = kind === 'watched' ? '/api/marks/watched' : '/api/marks/favorite';
  state.marks = await post(path, { id });
  render();
}

async function acknowledge(ids) {
  if (!ids.length) return;
  state.marks = await post('/api/acknowledge', { ids });
  render();
}

/**
 * Handing over is the service's job: the browser cannot ask the operating
 * system to open anything. Opening a session also counts as seeing it, so the
 * service acknowledges it and pushes the new marks back.
 */
async function open(id, target) {
  const say = (message) => {
    el('service-state').textContent = message;
    // Only the outcomes worth interrupting for: a handover that reached what it
    // was asked for says so on screen and stays quiet.
    announce(message);
  };
  try {
    const result = await post('/api/open', { id, target });
    const message = t(result.fellBack ? 'state.fellBack' : 'state.opening');
    el('service-state').textContent = message;
    if (result.fellBack) {
      announce(message);
    }
  } catch (error) {
    say(t('settings.failed', { error: error.message }));
  }
}

function select(id) {
  for (const tr of rowsBody.children) tr.classList.toggle('selected', tr.dataset.id === id);
  state.selected = id;
  if (id) {
    rowsBody.querySelector(`tr[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
}

function move(step) {
  const ids = [...rowsBody.children].map((tr) => tr.dataset.id);
  if (!ids.length) return;
  const current = ids.indexOf(state.selected);
  const next = current < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, current + step));
  select(ids[next]);
}

/**
 * Asks the service to re-read the transcripts, then takes the whole list back
 * from it and draws it, order included.
 *
 * Both halves matter. Forcing a scan alone leaves the page waiting on a push,
 * and a push can be missed — a stream that dropped and reconnected has a hole
 * in it, and nothing on screen says so. Taking the snapshot back is the only
 * way to be sure what is displayed is what the service holds.
 *
 * It is also the one moment a reorder is applied without asking, because asking
 * for a refresh *is* the asking.
 */
async function refreshAll() {
  const button = el('refresh');
  button.disabled = true;
  try {
    await post('/api/refresh');
    const data = await api('/api/sessions');
    state.service = data.state;
    state.marks = data.marks;
    state.sessions = new Map(data.sessions.map((session) => [session.id, session]));
    renderService();
    // Re-runs the search too: its answer is the service's, and may have moved.
    applyFilters();
  } catch (error) {
    el('service-state').textContent = t('settings.failed', { error: error.message });
  } finally {
    button.disabled = false;
  }
}

let searchTimer;
function applyFilters(immediate = true) {
  writeUrl();
  clearTimeout(searchTimer);
  const run = async () => {
    if (filters.q.trim()) {
      const { matched } = await api(
        `/api/search?q=${encodeURIComponent(filters.q)}&scope=${filters.scope}`,
      );
      state.matched = matched;
    } else {
      state.matched = null;
    }
    // The user asked for this view, so it is drawn in full, order included.
    render(true);
  };
  if (immediate) void run();
  else searchTimer = setTimeout(() => void run(), 250);
}

function resetFilters() {
  filters.q = '';
  filters.scope = 'both';
  filters.sort = 'created-desc';
  filters.match = 'all';
  filters.statuses.clear();
  filters.providers.clear();
  filters.workspaces.clear();
  filters.from = '';
  filters.to = '';
  filters.watchedOnly = false;
  filters.favoritesOnly = false;
  syncControls();
  applyFilters();
}

// ------------------------------------------------------------------ controls

/**
 * A status reads in the current language; a provider does not. `claude` and
 * `codex` are names, and translating a name only makes it harder to recognise.
 */
function statusLabel(status) {
  return t(`status.${status}`);
}

function buildChips(container, values, selected, onToggle, label = (value) => value) {
  container.textContent = '';
  for (const value of values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.value = value;
    button.textContent = label(value);
    button.setAttribute('aria-pressed', String(selected.has(value)));
    button.addEventListener('click', () => {
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      button.setAttribute('aria-pressed', String(selected.has(value)));
      onToggle();
    });
    container.append(button);
  }
}

/**
 * The header says which column orders the list, and which way.
 *
 * On the `th`, not on the button inside it: `aria-sort` is only supported on a
 * `columnheader`, and a `<button>` has role `button`. Set on the button — which
 * is where it was — assistive technology drops it silently, so the one thing
 * the attribute exists to convey was conveyed to nobody. The arrow is drawn in
 * CSS off the same attribute, so it moves with it.
 */
function syncSortHeaders() {
  const { key, ascending } = splitSort(filters.sort);
  for (const button of document.querySelectorAll('button.sort')) {
    const header = button.closest('th');
    if (button.dataset.key === key) {
      header.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
    } else {
      header.removeAttribute('aria-sort');
    }
  }
}

function syncControls() {
  el('query').value = filters.q;
  el('scope').value = filters.scope;
  el('sort').value = filters.sort;
  el('match').value = filters.match;
  syncSortHeaders();
  el('from').value = filters.from;
  el('to').value = filters.to;
  el('watched-only').setAttribute('aria-pressed', String(filters.watchedOnly));
  el('favorites-only').setAttribute('aria-pressed', String(filters.favoritesOnly));
  buildChips(el('status-filters'), STATUSES, filters.statuses, () => applyFilters(), statusLabel);
  buildChips(el('provider-filters'), PROVIDERS, filters.providers, () => applyFilters());
}

function wireControls() {
  el('query').addEventListener('input', (event) => {
    filters.q = event.target.value;
    applyFilters(false);
  });
  el('scope').addEventListener('change', (event) => {
    filters.scope = event.target.value;
    applyFilters();
  });
  el('sort').addEventListener('change', (event) => {
    filters.sort = event.target.value;
    syncSortHeaders();
    applyFilters();
  });
  el('match').addEventListener('change', (event) => {
    filters.match = event.target.value;
    applyFilters();
  });
  for (const button of document.querySelectorAll('button.sort')) {
    button.addEventListener('click', () => {
      const key = button.dataset.key;
      const current = splitSort(filters.sort);
      // Clicking the column already sorting reverses it; any other column
      // starts on the direction that is useful for it.
      filters.sort =
        current.key === key
          ? `${key}-${current.ascending ? 'desc' : 'asc'}`
          : `${key}-${FIRST_DIRECTION[key]}`;
      el('sort').value = filters.sort;
      syncSortHeaders();
      applyFilters();
    });
  }
  el('from').addEventListener('change', (event) => {
    filters.from = event.target.value;
    applyFilters();
  });
  el('to').addEventListener('change', (event) => {
    filters.to = event.target.value;
    applyFilters();
  });
  el('watched-only').addEventListener('click', () => {
    filters.watchedOnly = !filters.watchedOnly;
    syncControls();
    applyFilters();
  });
  el('favorites-only').addEventListener('click', () => {
    filters.favoritesOnly = !filters.favoritesOnly;
    syncControls();
    applyFilters();
  });
  el('open-settings').addEventListener('click', () => void openSettings());
  // Named on `window` so the native menu can reach it: the page and the menu
  // are in different worlds, and this is the only door between them.
  window.openSettings = openSettings;
  el('set-language').addEventListener('change', (event) => {
    localStorage.setItem('language', event.target.value);
    redrawEverything();
  });
  el('set-date-locale').addEventListener('change', (event) => {
    localStorage.setItem('dateLocale', event.target.value);
    redrawEverything();
  });
  el('save-settings').addEventListener('click', () => void saveSettings());
  el('detect').addEventListener('click', () => void detectProviders());
  el('theme').addEventListener('click', () => {
    const current = localStorage.getItem('theme') ?? 'auto';
    localStorage.setItem('theme', THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
    applyAppearance();
  });
  el('primary').addEventListener('input', (event) => {
    localStorage.setItem('primary', event.target.value);
    applyAppearance();
  });
  el('primary-random').addEventListener('click', () => {
    // Full saturation and mid lightness: a hue picked at random, not a colour
    // picked at random, so the frame always reads as a deliberate choice.
    const hue = Math.floor(Math.random() * 360);
    const probe = document.createElement('span');
    probe.style.cssText = `color: hsl(${hue} 70% 50%); position: absolute; visibility: hidden`;
    document.body.append(probe);
    const chosen = toHex(parseRgb(getComputedStyle(probe).color));
    probe.remove();
    localStorage.setItem('primary', chosen);
    applyAppearance();
  });
  // Following the system means following it as it changes, not only at load.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('theme') ?? 'auto') === 'auto') applyAppearance();
  });
  el('reset').addEventListener('click', resetFilters);
  el('reorder').addEventListener('click', () => render(true));
  el('refresh').addEventListener('click', () => void refreshAll());
  // The global switch is visible rather than buried: a channel you cannot see
  // the state of is a channel you end up muting at the operating system level.
  el('notify').addEventListener('click', async () => {
    const notifications = state.service?.notifications;
    state.service = await post('/api/notifications', { enabled: !notifications?.enabled });
    renderService();
  });
  // Which sessions may raise one at all: the ones you follow, or anything
  // holding something you have not seen.
  el('notify-scope').addEventListener('change', async (event) => {
    state.service = await post('/api/notifications', { scope: event.target.value });
    renderService();
  });
  el('pause').addEventListener('click', async () => {
    const paused = state.service?.paused;
    state.service = await post(paused ? '/api/resume' : '/api/pause');
    renderService();
  });
  // Acknowledging everything settles what is on screen, never the rows a filter
  // is hiding: a hundred sessions acknowledged by accident feels irreversible.
  el('ack-visible').addEventListener('click', () =>
    acknowledge([...rowsBody.children].map((tr) => tr.dataset.id)),
  );

  document.addEventListener('keydown', (event) => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName);
    if (event.key === '/' && !typing) {
      event.preventDefault();
      el('query').focus();
      return;
    }
    if (event.key === 'Escape' && typing) {
      event.target.blur();
      return;
    }
    if (typing) return;
    if (event.key === 'j') move(1);
    else if (event.key === 'k') move(-1);
    else if (event.key === 'r') void refreshAll();
    else if (!state.selected) return;
    else if (event.key === 'e') void acknowledge([state.selected]);
    else if (event.key === 'Enter') void open(state.selected, 'session');
    else if (event.key === 't') void open(state.selected, 'transcript');
    else if (event.key === 'w') void open(state.selected, 'workspace');
  });
}

/**
 * Which statuses raise a notification.
 *
 * `idle` is the one that matters: it is the model stopping work, which is the
 * whole promise here. Left off, the application watches without ever speaking.
 */
function renderNotifyOn(notifications) {
  const container = el('notify-on');
  const chosen = new Set(notifications?.on ?? []);
  if (container.dataset.rendered !== 'true') {
    container.dataset.rendered = 'true';
    for (const status of STATUSES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.dataset.status = status;
      button.addEventListener('click', async () => {
        const on = new Set(state.service?.notifications?.on ?? []);
        if (on.has(status)) on.delete(status);
        else on.add(status);
        state.service = await post('/api/notifications', { on: [...on] });
        renderService();
      });
      container.append(button);
    }
  }
  for (const button of container.children) {
    // Written on every pass rather than once at creation, so the language can
    // change without the chips being rebuilt.
    button.textContent = statusLabel(button.dataset.status);
    // Each says what it actually means to be told about it: two of the four are
    // the model stopping work, and the other two are not.
    button.title =
      t('notify.onStatus', { status: statusLabel(button.dataset.status) }) +
      `\n${t(`notify.why.${button.dataset.status}`)}`;
    button.setAttribute('aria-pressed', String(chosen.has(button.dataset.status)));
    button.disabled = !notifications?.enabled;
  }
}

/**
 * Everything that holds a translated word or a formatted date, rewritten.
 *
 * The rows alone are not enough: the header carries the last scan time and the
 * filter chips carry status names, and neither is touched by drawing the list.
 * Changing the language and watching half the page change is worse than not
 * offering the setting.
 */
function redrawEverything() {
  applyLanguage();
  syncControls();
  renderService();
  render(false);
}

function renderService() {
  const service = state.service;
  const notifications = service?.notifications;
  const notify = el('notify');
  notify.setAttribute('aria-pressed', String(notifications?.enabled ?? false));
  // Through the dictionary like everything else. These two were written in
  // English in place, so switching to French left them behind — and the
  // interface test asserted the English wording, which locked that in.
  notify.title = notifications?.enabled
    ? t('notify.enabledTitle', { statuses: notifications.on.map(statusLabel).join(', ') })
    : t('notify.disabledTitle');
  const scope = el('notify-scope');
  if (notifications?.scope) scope.value = notifications.scope;
  scope.disabled = !notifications?.enabled;
  renderNotifyOn(notifications);
  el('pause').textContent = t(service?.paused ? 'bar.resume' : 'bar.pause');
  el('service-state').textContent = service
    ? `${
        service.paused
          ? t('state.paused')
          : t('state.watching', { count: service.watching.length })
      } — ${t('state.lastScan', { at: at(service.scannedAt) })}`
    : t('state.connecting');
  renderNotices();
}

// --------------------------------------------------------------------- boot

async function boot() {
  // A toast button can only carry one URI, and opening a session takes two
  // steps, so it sends the browser here with the session to open. Read before
  // the URL is rewritten, and dropped from it afterwards: a reload must not
  // open the session a second time.
  const requested = new URLSearchParams(location.search).get('open');
  readUrl();
  applyLanguage();
  syncControls();
  wireControls();
  applyAppearance();

  const initial = await api('/api/sessions');
  state.service = initial.state;
  state.marks = initial.marks;
  for (const session of initial.sessions) state.sessions.set(session.id, session);
  renderService();
  applyFilters();

  if (requested && state.sessions.has(requested)) {
    select(requested);
    void open(requested, 'session');
  }

  const stream = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  stream.addEventListener('delta', (event) => {
    const delta = JSON.parse(event.data);
    for (const session of delta.upserted) state.sessions.set(session.id, session);
    for (const id of delta.removed) state.sessions.delete(id);
    render();
  });
  stream.addEventListener('state', (event) => {
    state.service = JSON.parse(event.data);
    renderService();
  });
  stream.addEventListener('marks', (event) => {
    state.marks = JSON.parse(event.data);
    render();
  });
  stream.onerror = () => {
    const message = t('state.streamLost');
    el('service-state').textContent = message;
    // The list silently stops updating otherwise, which looks exactly like a
    // quiet afternoon.
    announce(message);
  };

  // The minute counts climb without anything being written, so they are the one
  // thing redrawn on a timer. Addressed by name, like the full redraw does: this
  // used to write into `children[3]`, which is the transcript button, and
  // setting text on a cell destroys what it contains. The next redraw then died
  // looking for that button, and a dead redraw freezes every marker below it.
  setInterval(() => {
    for (const tr of rowsBody.children) {
      const session = state.sessions.get(tr.dataset.id);
      if (session && state.marks.watched.includes(session.id)) {
        tr.querySelector('.num').textContent = `${minutesSince(session.statusChangedAt)}m`;
      }
    }
  }, 30000);
}

void boot();
