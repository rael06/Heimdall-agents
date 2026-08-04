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
/** Matches STATUS_ORDER in the service: the chips and the sort share one order. */
const STATUSES = ['running', 'unknown', 'failed', 'idle'];
const PROVIDERS = ['claude', 'codex'];
/** A shape per status, so colour is never the only carrier. */
/*
 * Circle, diamond, square, triangle: four silhouettes nobody has to compare
 * against each other to tell apart, which is the whole point of not leaving the
 * meaning to colour.
 *
 * They were characters — `●✕▲◇` — until the three candidates were rendered side
 * by side at three times size and looked at. The dot is small, the cross is
 * thin, the diamond is a hairline: four glyphs from four type families, because
 * that is what they were. Drawn from one set they carry one weight.
 *
 * The prettiest candidate was rejected for being pretty. Play, x, pause and
 * question in circles read beautifully at three times size and share a circular
 * silhouette, and a silhouette is what survives when the centre does not.
 *
 * `idle` keeps its triangle: that triangle is the application's own icon, drawn
 * by `scripts/make-icon.mjs` as "the one shape in the interface that means this
 * one has stopped and is waiting for you".
 */
const STATUS_ICON = {
  running: 'status-running',
  unknown: 'status-unknown',
  failed: 'status-failed',
  idle: 'status-idle',
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

// The colour arithmetic — channel, luminance, contrast, readable and the hex
// conversions — is in `lib.js`, which Vitest can import and a browser cannot
// reach on a route of its own. What stays here is what needs a document.

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

/**
 * Kept between calls, and it is not a micro-optimisation.
 *
 * A formatter was built for every date in every row, twice a row, on every
 * redraw. Measured in this browser at 327 rows: 30.6ms an update, where the
 * same formatter reused costs 0.5ms — sixty times, and nearly two frames at
 * 60Hz spent constructing objects that never differ. It was found looking for
 * why dragging the colour picker stuttered, and it was never only about that:
 * every scan pays it. Keyed on the resolved locale, so changing the language
 * still changes the dates.
 */
let dateFormat = { locale: null, format: null };

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
  if (dateFormat.locale !== locale) {
    dateFormat = {
      locale,
      format: new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }),
    };
  }
  return dateFormat.format.format(date);
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
  nameResizers(lang);
  // The two that name themselves rather than carrying a fixed key.
  const system = resolveLanguage('auto', navigator.languages);
  el('set-language').options[0].textContent = translate(lang, 'settings.languageAuto', {
    name: system === 'fr' ? 'Français' : 'English',
  });
  el('set-date-locale').options[0].textContent = translate(lang, 'settings.dateFollows');
  el('set-date-locale').options[1].textContent = translate(lang, 'settings.dateIso');
}

// ------------------------------------------------------------- URL as state

// `day`, `folder`, `minutesSince`, `normalizeSort`, `splitSort`, `SORT_KEYS`
// and `FIRST_DIRECTION` are in `lib.js` for the same reason as the colour
// arithmetic: none of them needs a document, and all of them are worth asking
// directly rather than through a browser.

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
  const marked = {
    watched: (session) => state.marks.watched.includes(session.id),
    starred: (session) => state.marks.favorites.includes(session.id),
  };
  const primary =
    marked[key] !== undefined
      ? (a, b) => Number(marked[key](a)) - Number(marked[key](b))
      : (ASCENDING[key] ?? ASCENDING.created);
  const ordered = (a, b) => (ascending ? primary(a, b) : -primary(a, b)) || byTitle(a, b);

  // Sorting *by* a marker replaces the automatic grouping rather than fighting
  // it. The grouping is a default — it lifts what you follow without being
  // asked — and a default that outranked an explicit click would make the two
  // new columns do nothing at all: watched rows are already first, so ordering
  // by them could never change anything, least of all put them last.
  if (marked[key] !== undefined) {
    return ordered;
  }

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
    // The brush sits before the value it paints, in both columns that carry one.
    '<td class="provider"><button class="brush" type="button"></button>' +
    '<span class="badge tag"></span></td>' +
    '<td class="ws"><button class="brush" type="button"></button>' +
    '<button class="link tag" type="button"></button></td>' +
    '<td class="title"><button class="link text" type="button"></button>' +
    '<span class="matched"></span></td>';
  tr.querySelector('.status').addEventListener('click', () => acknowledge([id]));
  tr.querySelector('.watched').addEventListener('click', () => toggleMark('watched', id));
  tr.querySelector('.favorite').addEventListener('click', () => toggleMark('favorite', id));
  // A click lands on the thing it means, never on the row: a stray click in the
  // margin opens nothing.
  tr.querySelector('.transcript').addEventListener('click', () => open(id, 'transcript'));
  tr.querySelector('.ws .link').addEventListener('click', () => open(id, 'workspace'));
  for (const [selector, kind] of [
    ['.ws .brush', 'workspace'],
    ['.provider .brush', 'provider'],
  ]) {
    tr.querySelector(selector).addEventListener('click', () => {
      const session = state.sessions.get(id);
      const name = kind === 'workspace' ? folder(session.cwd) : session.provider;
      if (session.cwd || kind === 'provider') openPalette(kind, name);
    });
  }
  tr.querySelector('.title .link').addEventListener('click', () => open(id, 'session'));
  return tr;
}

function updateRow(tr, session) {
  const watched = state.marks.watched.includes(session.id);
  const unseen = state.marks.unacknowledged.includes(session.id);

  const status = tr.querySelector('.status');
  prependIcon(status, STATUS_ICON[session.status] ?? 'status-unknown');
  swapIcon(status, STATUS_ICON[session.status] ?? 'status-unknown');
  status.dataset.status = session.status;
  status.dataset.unseen = String(unseen);
  // An inferred status has to justify itself, and the label carries the meaning
  // for anyone who cannot see the shape.
  const label = statusLabel(session.status);
  status.setAttribute('aria-label', unseen ? `${label}, ${t('row.unacknowledged')}` : label);
  status.title = `${label} — ${session.statusReason}` + (unseen ? `\n${t('row.acknowledge')}` : '');

  // An outline when unset and a filled one when set. Drawing both the same and
  // colouring the difference makes every row look marked at a glance, and leaves
  // nothing at all for anyone who does not see the colour.
  //
  // Both markers are drawn rather than typed now. `○`/`◉` said nothing about
  // watching — a ring and a dot are a radio button, which is what they looked
  // like and not what they meant — and `☆`/`★` came from a block nothing else
  // here uses. An eye and a star say what they are, and each is one drawing at
  // two weights, which is exactly the off/on a marker means.
  const favorite = state.marks.favorites.includes(session.id);
  markWithIcon(tr.querySelector('.watched'), watched, 'eye', 'row.watchedOn', 'row.watchedOff');
  markWithIcon(tr.querySelector('.favorite'), favorite, 'star', 'row.starredOn', 'row.starredOff');
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
  const badge = tr.querySelector('.badge');
  badge.textContent = session.provider;
  paintTag(badge, 'provider', session.provider);
  const ws = tr.querySelector('.ws .link');
  const workspace = folder(session.cwd);
  ws.textContent = workspace;
  // A colour per project, so thirty rows separate into a handful of groups
  // before a single name has been read. The hue is all JavaScript decides; which
  // pair of colours it becomes is the stylesheet's, so the two themes stay one
  // declaration rather than a palette this file would have to recompute every
  // time the theme changed.
  //
  // Only where there is a workspace to name. A session without one shows a dash,
  // and a dash wearing a project colour would read as a project.
  ws.classList.toggle('tag', Boolean(session.cwd));
  if (session.cwd) paintTag(ws, 'workspace', workspace);
  else for (const p of ['--hue', 'background', 'color', 'border-color']) ws.style.removeProperty(p);
  // A brush on a row with no workspace would open a picker for a dash.
  const brush = tr.querySelector('.ws .brush');
  brush.hidden = !session.cwd;
  for (const [node, name] of [
    [brush, workspace],
    [tr.querySelector('.provider .brush'), session.provider],
  ]) {
    // Not `markWithIcon`, which is for the two markers: it writes `aria-pressed`,
    // and a brush that opens a picker has no pressed state to report.
    prependIcon(node, 'brush');
    const label = t('row.recolour', { name });
    node.setAttribute('aria-label', label);
    node.title = label;
  }
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
  // Before the rows are drawn, since it decides what colour they carry. It
  // returns early unless the set of projects actually changed, so this costs a
  // comparison on every render and a write on almost none.
  syncColours();
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

/**
 * Puts the status shape inside the chip that filters on it.
 *
 * Marked `aria-hidden`: the word is right beside it, and a screen reader
 * announcing "black circle running" is worse than one announcing "running".
 * It is decoration for the eye and duplication for anything else.
 */
/**
 * Points a button at one of the sprite's symbols.
 *
 * Built with `createElementNS` and `<use>` rather than assigned as markup: SVG
 * is not HTML, `innerHTML` would silently produce elements in the wrong
 * namespace that render as nothing, and this file writes no markup from a
 * string anywhere else either.
 */
function markWithIcon(button, on, name, onKey, offKey) {
  const id = on ? `${name}-fill` : name;
  let svg = button.querySelector('svg');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'use'));
    button.textContent = '';
    button.append(svg);
  }
  svg.firstChild.setAttribute('href', `#icon-${id}`);
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', t(on ? onKey : offKey));
  button.title = t(on ? onKey : offKey);
}

/**
 * Puts an icon in front of a button that already has its label in a span.
 *
 * Once, at boot. The label lives in `.chip-label` precisely so `applyLanguage`
 * can rewrite the words on every language change without taking the icon with
 * them — setting `textContent` on the button would.
 */
function prependIcon(button, name) {
  if (button.querySelector('svg')) {
    return;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  button.prepend(svg);
}

/** Swaps which symbol a button already carrying an icon points at. */
function swapIcon(button, name) {
  button.querySelector('svg use')?.setAttribute('href', `#icon-${name}`);
}

function decorate(button, status, label) {
  button.textContent = '';
  if (status) {
    const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    glyph.setAttribute('class', 'icon chip-glyph');
    glyph.dataset.status = status;
    glyph.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${STATUS_ICON[status] ?? 'status-unknown'}`);
    glyph.append(use);
    button.append(glyph);
  }
  // The word in a span of its own rather than loose in the button: with a glyph
  // beside it, `button.textContent` is "●running", and everything that wants the
  // label — a test, a future truncation — would have to know to strip a shape
  // off the front.
  const text = document.createElement('span');
  text.className = 'chip-label';
  text.textContent = label;
  button.append(text);
}

function buildChips(container, values, selected, onToggle, label = (value) => value, glyphed = false) {
  container.textContent = '';
  for (const value of values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.value = value;
    decorate(button, glyphed ? value : undefined, label(value));
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

// ------------------------------------------------------------------ colours

/**
 * Which colour each workspace and each provider wears, remembered so it stays.
 *
 * Taken from every session loaded rather than from the rows on screen: a filter
 * narrows what is visible, and a project changing colour because something else
 * was filtered out would make the colour worth less than no colour at all.
 *
 * The provider joins the workspace here rather than keeping a colour of its own
 * per name. There are two providers today and the list is not this page's to
 * fix — a third would arrive with no colour and no way to give it one.
 */
const PALETTES = {
  workspace: { store: 'workspaceColours', offset: 0, state: { slots: {}, colours: {} } },
  // Half the list along, so the provider column and the workspace column do not
  // both open on the same colour and imply a link between them that is not one.
  provider: {
    store: 'providerColours',
    offset: WORKSPACE_HUES.length / 2,
    state: { slots: {}, colours: {} },
  },
};

const namesOf = (kind) =>
  [
    ...new Set(
      [...state.sessions.values()]
        .map((session) => (kind === 'workspace' ? session.cwd && folder(session.cwd) : session.provider))
        .filter(Boolean),
    ),
  ].sort();

function syncColours() {
  for (const [kind, palette] of Object.entries(PALETTES)) {
    const next = assignSlots(namesOf(kind), palette.state, WORKSPACE_HUES.length, palette.offset);
    if (JSON.stringify(next) === JSON.stringify(palette.state)) continue;
    palette.state = next;
    localStorage.setItem(palette.store, JSON.stringify(next));
  }
}

/**
 * Paints one chip, either from the palette or from a colour that was chosen.
 *
 * The two are not the same mechanism and cannot be. An assigned colour is a hue,
 * and the stylesheet turns it into a light chip or a dark one depending on the
 * theme in force. A chosen colour is a colour: it is what was asked for, in both
 * themes, so it is written straight onto the element — and the only thing left
 * to decide is what can be read on top of it.
 */
function paintTag(node, kind, name) {
  // Recorded on the element so a colour change can find the handful of chips it
  // affects without walking every cell of every row.
  node.dataset.tag = name;
  const { colours, inks, slots } = PALETTES[kind].state;
  const chosen = colours[name];
  if (chosen) {
    // The measured answer unless the reader has said otherwise.
    const readable = inks[name] ?? contrastingInk(chosen);
    node.style.setProperty('background', chosen);
    node.style.setProperty('color', readable);
    // The edge, for a chip that lands on a row of nearly its own colour. It is
    // the ink rather than a shade of the fill, because a colour picked freely
    // has no shade this could safely derive.
    node.style.setProperty('border-color', readable);
    node.style.removeProperty('--hue');
    return;
  }
  for (const property of ['background', 'color', 'border-color']) node.style.removeProperty(property);
  node.style.setProperty('--hue', String(WORKSPACE_HUES[slots[name] ?? hashSlot(name)]));
}

/**
 * Repaints the chips carrying one name, and nothing else.
 *
 * The picker used to rewrite every row on every pointer move, which at 327 rows
 * meant a full redraw sixty times a second. Measured, the expensive part of a
 * redraw was never the colour: it was the two date formatters each row built
 * for itself, 30.6ms an update against 1.5ms for all the contrast arithmetic.
 * Both are fixed — the formatter is kept now — but a drag still has no reason
 * to touch a row whose colour cannot have changed.
 */
function repaintTag(kind, name) {
  const selector = kind === 'workspace' ? 'td.ws .link' : '.badge';
  for (const node of rowsBody.querySelectorAll(selector)) {
    if (node.dataset.tag === name) paintTag(node, kind, name);
  }
}

/** Every chip, for the one change that can move a colour it was not given. */
function repaintTags() {
  for (const tr of rowsBody.children) {
    const session = state.sessions.get(tr.dataset.id);
    if (!session) continue;
    paintTag(tr.querySelector('.badge'), 'provider', session.provider);
    if (session.cwd) paintTag(tr.querySelector('.ws .link'), 'workspace', folder(session.cwd));
  }
}

/** What the picker is currently pointed at. */
let recolouring = null;

/**
 * A computed colour as a hex, whatever space the engine chose to write it in.
 *
 * `getComputedStyle` does not convert a colour function any more: a chip comes
 * back as `oklch(0.84 0.12 285)`, and reading the numbers out of that takes the
 * lightness and the chroma for red and green. That put `#005400` — 0, 84, 0 —
 * into the picker for a chip that was painted pink. Filling a pixel and reading
 * it back is the engine answering in the space the screen works in.
 */
let pixel = null;

function paintedHex(value) {
  // One canvas, kept: this is on the path of a colour drag now, and a new one
  // per call is an allocation per pointer move.
  pixel ??= document.createElement('canvas').getContext('2d');
  pixel.fillStyle = '#000000';
  pixel.fillStyle = value;
  pixel.fillRect(0, 0, 1, 1);
  return toHex([...pixel.getImageData(0, 0, 1, 1).data].slice(0, 3));
}

/**
 * The text a chip wears when nobody has said otherwise.
 *
 * The same kind of answer the stylesheet gives an assigned chip: a near-white
 * or near-black carrying a trace of the chip's own hue. It used to be flat
 * black or flat white, which measured better and looked worse — and worse
 * still, it looked like a different rule from the one every other chip follows.
 * `oklch(from …)` takes the hue off the chosen colour, so the stylesheet's
 * lightness and chroma can be applied to it without this file having to convert
 * anything by hand.
 */
const TINT = { light: '.91 .11', dark: '.30 .12' };
const inkCache = new Map();

function contrastingInk(fill) {
  let answer = inkCache.get(fill);
  if (answer !== undefined) return answer;
  const flat = ink(fill);
  if (!CSS.supports('color', 'oklch(from red 0.5 0.1 h)')) return flat;
  const tint = flat === '#ffffff' ? TINT.light : TINT.dark;
  answer = readableInk(paintedHex(`oklch(from ${fill} ${tint} h)`), fill);
  // Bounded, because a drag passes through a colour a frame.
  if (inkCache.size > 500) inkCache.clear();
  inkCache.set(fill, answer);
  return answer;
}

/** What a chip is painted right now, as the colour input needs it: a hex. */
function paintedTag(kind, name) {
  const chosen = PALETTES[kind].state.colours[name];
  if (chosen) return chosen;
  // The palette's own answer is a hue the stylesheet resolves, so it is asked of
  // an element that has applied it rather than computed a second time here.
  const probe = document.createElement('span');
  probe.className = 'tag';
  probe.style.cssText = 'position: absolute; visibility: hidden';
  paintTag(probe, kind, name);
  document.body.append(probe);
  const painted = paintedHex(getComputedStyle(probe).backgroundColor);
  probe.remove();
  return painted;
}

/**
 * The whole value on the way in, and an ordinary caret once you are in.
 *
 * A field holding one seven-character value is replaced far more often than it
 * is edited, and the hash is part of what gets replaced — so arriving in it
 * with everything selected saves the same three keystrokes every time.
 *
 * Selecting on `focus` alone does not survive the click that caused it: the
 * caret is placed as part of the same gesture, afterwards, and collapses the
 * selection. So the click that would place it is stopped, once.
 *
 * Once per opening of the dialog, and not "once per focus", which is what this
 * tried first and what the test caught. `showModal` gives the focus to the
 * first control in the form, so by the time the reader clicks the field already
 * has it — a rule written around gaining focus never fired at all, and the
 * click placed a caret at character four. Measured before settling for it:
 * `autofocus` on the dialog and `tabindex="-1"` on the dialog both leave the
 * focus exactly where it was, on the first field, so there is no arranging this
 * away and the click has to be handled on its own terms.
 *
 * Typing counts as having entered too: someone who used the focus the dialog
 * handed them and then reaches for the mouse is editing, not starting again.
 */
function selectOnEntry(input) {
  const entered = () => {
    input.dataset.entered = 'true';
  };
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', entered);
  input.addEventListener('mousedown', (event) => {
    if (input.dataset.entered === 'true') return;
    entered();
    event.preventDefault();
    input.focus();
    input.select();
  });
}

/** Keeps the dialog's own controls in step with what the chip now wears. */
function syncPalette(settled = false) {
  const { kind, name } = recolouring;
  const preview = el('palette-preview');
  paintTag(preview, kind, name);
  const fill = paintedTag(kind, name);
  el('palette-colour').value = fill;
  // Read off the preview rather than worked out again: an assigned chip takes
  // its text from the stylesheet, so the only place the answer exists is on an
  // element that has applied it.
  const tone = paintedHex(getComputedStyle(preview).color);
  el('palette-ink').value = tone;
  // Never into the field being typed in, unless the value has been committed:
  // rewriting under the cursor would fight whoever is halfway through, and `#ff`
  // would become `#ff0000` before they had said which red they meant. Once it
  // is settled — blurred, or Enter, which keeps the focus — whatever was left
  // half-typed goes back to what the chip actually wears, so no field sits
  // there claiming a colour nothing is painted in.
  for (const [id, value] of [
    ['palette-colour-hex', fill],
    ['palette-ink-hex', tone],
  ]) {
    if (settled || document.activeElement !== el(id)) el(id).value = value;
  }
  // Nothing to take back while the chip is still wearing what it was given.
  el('palette-auto').disabled = PALETTES[kind].state.colours[name] === undefined;
}

/**
 * What the chip is wearing, so that changing one half does not discard the
 * other. Touching either colour makes the chip a chosen one, starting from
 * exactly what was on screen — nothing jumps at the first click.
 *
 * `tone` stays undefined until the reader has actually picked one, and that is
 * the whole of it. Reading the text off the chip instead looks equivalent and
 * is not: an assigned chip is written in a near-black tint of its own hue, so
 * choosing a background carried that tint onto it as though it had been chosen
 * — a dark green word on a red field, measured at 1.23:1. Left undefined, the
 * fill's own contrast answer applies.
 */
function currentColours(kind, name) {
  const { colours, inks } = PALETTES[kind].state;
  return { fill: colours[name] ?? paintedTag(kind, name), tone: inks[name] };
}

function openPalette(kind, name) {
  recolouring = { kind, name };
  el('palette-heading').textContent = t('palette.heading', { name });
  el('palette-preview').textContent = name;
  // "The first time" is once per opening, so every opening starts fresh.
  for (const id of ['palette-colour-hex', 'palette-ink-hex']) delete el(id).dataset.entered;
  syncPalette();
  el('palette').showModal();
}

/**
 * A colour chosen by hand, or the choice taken back.
 *
 * Taking it back drops the name and lets the next assignment decide, which is
 * what "automatic" has to mean if it is offered at all.
 */
function chooseColour(kind, name, colour, tone) {
  const palette = PALETTES[kind];
  const colours = { ...palette.state.colours };
  const inks = { ...palette.state.inks };
  const wasChosen = colours[name] !== undefined;
  if (colour === null) {
    delete colours[name];
    delete inks[name];
  } else {
    colours[name] = colour;
    if (tone !== undefined) inks[name] = tone;
  }
  // The assignment only moves when a name joins or leaves the automatic pool,
  // which happens on the first change and on the last one — not on every pixel
  // of a drag between them.
  if (wasChosen === (colour === null)) {
    palette.state = assignSlots(
      namesOf(kind),
      { slots: palette.state.slots, colours, inks },
      WORKSPACE_HUES.length,
      palette.offset,
    );
    repaintTags();
  } else {
    palette.state = { ...palette.state, colours, inks };
    repaintTag(kind, name);
  }
}

/** Written once the reader has settled on something, not on every pixel. */
function storeColours(kind) {
  localStorage.setItem(PALETTES[kind].store, JSON.stringify(PALETTES[kind].state));
}

// ----------------------------------------------------------- column widths

/**
 * Kept beside the theme rather than in the address bar.
 *
 * The address bar carries the view — a search, a filter, a sort — because those
 * are worth bookmarking and worth sending to someone else. A column dragged to
 * suit one window on one screen is neither.
 */
const COLUMN_STORE = 'columns';
let columnWidths = {};

const headerCells = () => [...document.querySelectorAll('#sessions thead th[data-column]')];

/**
 * The widths the table would choose for itself, measured by letting it choose.
 *
 * There is no other way to ask. Under a fixed layout the width a column would
 * have taken is not a value anything exposes, so the layout is handed back for
 * the length of one measurement and taken again immediately. Nothing is painted
 * in between: reading a rectangle forces the layout the lines above it asked
 * for, and the frame ends with the table as it started.
 */
function naturalWidths() {
  const table = el('sessions');
  const sized = table.hasAttribute('data-sized');
  table.removeAttribute('data-sized');
  // Including the table's own width, or the measurement is taken inside the
  // box the last set of widths added up to rather than in the one the contents
  // would ask for.
  table.style.removeProperty('width');
  for (const col of table.querySelectorAll('col')) col.style.removeProperty('width');
  const measured = {};
  for (const th of headerCells()) measured[th.dataset.column] = th.getBoundingClientRect().width;
  if (sized) table.setAttribute('data-sized', '');
  applyColumnWidths();
  return measured;
}

function applyColumnWidths() {
  const table = el('sessions');
  const widths = Object.values(columnWidths);
  table.toggleAttribute('data-sized', widths.length > 0);
  for (const col of table.querySelectorAll('col')) {
    const width = columnWidths[col.dataset.column];
    if (width) col.style.width = `${width}px`;
    else col.style.removeProperty('width');
  }
  // The table is told exactly what its columns add up to, and this is not
  // belt and braces. A fixed table still takes its own width from `max-content`
  // — which is measured from the contents, not from the widths asked for — and
  // hands everything beyond the sum of its columns back to the columns. So a
  // column holding something long kept a floor under it that no width could
  // cross: 40px was stored and written to the `col`, and 118.9px was drawn.
  // Only the columns with long values had it, which is why it looked like a
  // rule about the workspace rather than about every column.
  if (widths.length) table.style.width = `${widths.reduce((sum, value) => sum + value, 0)}px`;
  else table.style.removeProperty('width');
  for (const th of headerCells()) {
    const handle = th.querySelector('.resizer');
    if (!handle) continue;
    const width = columnWidths[th.dataset.column] ?? th.getBoundingClientRect().width;
    handle.setAttribute('aria-valuenow', String(Math.round(width)));
  }
}

function storeColumnWidths() {
  if (Object.keys(columnWidths).length) {
    localStorage.setItem(COLUMN_STORE, JSON.stringify({ v: COLUMN_FORMAT, widths: columnWidths }));
  } else {
    localStorage.removeItem(COLUMN_STORE);
  }
}

/**
 * Every column at once, on the first drag, and not only the one being dragged.
 *
 * A fixed layout hands a column with no width of its own an equal share of
 * whatever is left over rather than sizing it to its contents. Writing one
 * width and leaving the other nine empty would therefore rearrange the entire
 * table on the first pixel of the first drag.
 */
function takeOverWidths() {
  if (Object.keys(columnWidths).length) return;
  const natural = naturalWidths();
  for (const key of Object.keys(natural)) {
    columnWidths[key] = clampColumnWidth(DEFAULT_COLUMN_WIDTHS[key] ?? natural[key]);
  }
  applyColumnWidths();
}

/** Back to what the contents ask for: the double-click every table has. */
function fitColumn(key) {
  // Nothing to fit while the table is still sizing itself — every column is
  // already exactly as wide as its contents.
  if (!Object.keys(columnWidths).length) return;
  columnWidths[key] = clampColumnWidth(DEFAULT_COLUMN_WIDTHS[key] ?? naturalWidths()[key]);
  applyColumnWidths();
  storeColumnWidths();
}

function resizeColumn(key, width) {
  takeOverWidths();
  columnWidths[key] = clampColumnWidth(width);
  applyColumnWidths();
}

function wireResizer(handle, key) {
  handle.addEventListener('pointerdown', (event) => {
    // Captured, so the drag survives leaving the eight pixels it started in —
    // and the listeners come off with it rather than living on the document for
    // the rest of the session. Deliberately without `preventDefault`, which
    // would take the double-click with it: the text selection it would have
    // stopped is stopped by `body.resizing` instead.
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing');
    takeOverWidths();
    const startX = event.clientX;
    const startWidth = columnWidths[key];
    const move = (moving) => resizeColumn(key, startWidth + (moving.clientX - startX));
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      document.body.classList.remove('resizing');
      storeColumnWidths();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });

  handle.addEventListener('dblclick', () => fitColumn(key));

  handle.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      takeOverWidths();
      const step = event.shiftKey ? 32 : 8;
      resizeColumn(key, columnWidths[key] + (event.key === 'ArrowLeft' ? -step : step));
    } else if (event.key === 'Home') {
      fitColumn(key);
    } else {
      return;
    }
    // Only for the keys that were used: the rest still reach the table, and
    // Tab above all still leaves.
    event.preventDefault();
    storeColumnWidths();
  });
}

function buildColumns() {
  const table = el('sessions');
  const group = document.createElement('colgroup');
  for (const th of headerCells()) {
    const key = th.dataset.column;
    const col = document.createElement('col');
    col.dataset.column = key;
    group.append(col);

    const handle = document.createElement('div');
    handle.className = 'resizer';
    handle.dataset.column = key;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-valuemin', String(MIN_COLUMN_WIDTH));
    handle.setAttribute('aria-valuemax', String(MAX_COLUMN_WIDTH));
    handle.tabIndex = 0;
    wireResizer(handle, key);
    th.append(handle);
  }
  // After the caption, which is the only place a colgroup is allowed to be.
  table.querySelector('caption').after(group);

  columnWidths = readColumnWidths(
    localStorage.getItem(COLUMN_STORE),
    headerCells().map((th) => th.dataset.column),
  );
  applyColumnWidths();
}

/** Named from the column they belong to, so they follow the language with it. */
function nameResizers(lang) {
  for (const handle of document.querySelectorAll('.resizer')) {
    const name = translate(lang, `column.${handle.dataset.column}`);
    handle.setAttribute('aria-label', translate(lang, 'column.resize', { name }));
    handle.title = translate(lang, 'column.resizeHint', { name });
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
  // The statuses carry their shape; `claude` and `codex` are names and have none.
  buildChips(el('status-filters'), STATUSES, filters.statuses, () => applyFilters(), statusLabel, true);
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
  // `input` so the rows follow the picker as it is dragged — the only way to
  // judge a colour against the list it will live in — and `change` to write it
  // down, because a drag crosses several hundred colours nobody chose.
  el('palette-colour').addEventListener('input', (event) => {
    if (!recolouring) return;
    const { kind, name } = recolouring;
    const { tone } = currentColours(kind, name);
    chooseColour(kind, name, event.target.value, tone);
    syncPalette();
  });
  el('palette-ink').addEventListener('input', (event) => {
    if (!recolouring) return;
    const { kind, name } = recolouring;
    const { fill } = currentColours(kind, name);
    chooseColour(kind, name, fill, event.target.value);
    syncPalette();
  });
  // The hex fields, which are the first way in rather than the last: the panel
  // behind the swatch opens on whichever of hex, rgb and hsl the browser last
  // remembered, and that selector is its own chrome — a page cannot order it.
  for (const [id, half] of [
    ['palette-colour-hex', 'fill'],
    ['palette-ink-hex', 'tone'],
  ]) {
    selectOnEntry(el(id));
    el(id).addEventListener('input', (event) => {
      const typed = normalizeHex(event.target.value);
      if (!recolouring || !typed) return;
      const { kind, name } = recolouring;
      const current = currentColours(kind, name);
      chooseColour(
        kind,
        name,
        half === 'fill' ? typed : current.fill,
        half === 'fill' ? current.tone : typed,
      );
      syncPalette();
    });
    el(id).addEventListener('change', () => {
      if (!recolouring) return;
      storeColours(recolouring.kind);
      syncPalette(true);
    });
  }
  for (const id of ['palette-colour', 'palette-ink']) {
    el(id).addEventListener('change', () => {
      if (recolouring) storeColours(recolouring.kind);
    });
  }
  // The measured answer, on demand rather than as a rule. It is what a chip
  // starts out with, and this is how it is taken back after a colour that
  // turned out not to be readable.
  el('palette-contrast').addEventListener('click', () => {
    if (!recolouring) return;
    const { kind, name } = recolouring;
    const { fill } = currentColours(kind, name);
    chooseColour(kind, name, fill, contrastingInk(fill));
    storeColours(kind);
    syncPalette();
  });
  el('palette-auto').addEventListener('click', () => {
    if (!recolouring) return;
    chooseColour(recolouring.kind, recolouring.name, null);
    storeColours(recolouring.kind);
    syncPalette();
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
    // The same shortcut the native menu advertises, so the two hosts answer the
    // same key. The desktop application hides its settings button because the
    // menu carries it; a browser has no menu, so without this the panel would
    // have exactly one door and losing it would lose the settings.
    if (event.key === ',' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void openSettings();
      return;
    }
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
    // change without the chips being rebuilt. Shape included: the same status
    // must not be a shape in one bar and a bare word in the other.
    decorate(button, button.dataset.status, statusLabel(button.dataset.status));
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
  // A bell that is not ringing looks like a bell that is, so off is struck
  // through rather than merely paler.
  swapIcon(notify, notifications?.enabled ? 'bell' : 'bell-slash');
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
  // Before the language pass: these buttons keep their words in a `.chip-label`
  // span, and the icon sits outside it precisely so translating one does not
  // remove the other.
  prependIcon(el('watched-only'), 'eye');
  prependIcon(el('favorites-only'), 'star');
  prependIcon(el('notify'), 'bell');
  // Reset turns back, refresh turns forward.
  prependIcon(el('reset'), 'reset');
  prependIcon(el('refresh'), 'refresh');
  // The three headers whose words moved to `sr-only`, so a column stops being
  // several times wider than the mark it holds. Each wears what its column
  // carries; all three still sort.
  for (const [key, icon] of [
    ['status', 'circles-three'],
    ['watched', 'eye'],
    ['starred', 'star'],
  ]) {
    prependIcon(document.querySelector(`button.sort[data-key="${key}"]`), icon);
  }
  // Before the language pass, which is what names the handles it builds.
  buildColumns();
  for (const palette of Object.values(PALETTES)) {
    palette.state = readSlots(localStorage.getItem(palette.store));
  }
  applyLanguage();
  syncControls();
  wireControls();
  applyAppearance();

  const initial = await api('/api/sessions');
  state.service = initial.state;
  state.marks = initial.marks;
  for (const session of initial.sessions) state.sessions.set(session.id, session);
  // Where a native menu already carries Settings, the button in the bar is a
  // second door to one room and takes space from the controls that have none.
  // Where there is no menu — a browser — it is the only door, and stays.
  el('open-settings').classList.toggle('hidden', Boolean(initial.host?.nativeMenu));
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
