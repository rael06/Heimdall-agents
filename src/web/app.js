const token = new URLSearchParams(location.search).get('token') ?? '';

const el = (id) => document.getElementById(id);
const rowsBody = el('rows');

/*
 * ------------------------------------------------------------------- storage
 *
 * The theme, the accent, the colours handed to each workspace, the column
 * widths, the sort and the filters. All of it used to live in `localStorage`,
 * which is keyed by origin — and the origin carries the port.
 *
 * The port is asked for, not owned. Windows reserves blocks of the dynamic
 * range for Hyper-V and WSL and redraws them on every boot, so the morning the
 * usual port came back refused, the service took another one and the page
 * opened on an empty store. Nothing had been lost; nothing was reachable
 * either, which to the reader is the same thing.
 *
 * So the values live in the preferences file now, beside every other setting,
 * and the service writes them into this document before it paints. Reads stay
 * synchronous — the theme decides the first frame and cannot await a request —
 * and writes go back debounced.
 */

/** What the service inlined, and the copy every read below answers from. */
const view = window.__view ?? {};

let pendingView = {};
let viewInFlight = false;

/*
 * Sent at once, and coalesced rather than delayed.
 *
 * A timer was the obvious way to survive a column drag, which writes on every
 * mouse move — and it lost the change: set the theme, reload, and the request
 * had not left yet. Eleven end-to-end tests said so, and they were right about
 * the application rather than about themselves.
 *
 * So a change goes out immediately, and anything written while that request is
 * in flight waits for it and goes out together. A drag still costs one request
 * per round trip instead of one per frame, and nothing is ever held back on a
 * clock that a reload can outrun.
 */
function flushView() {
  if (viewInFlight || !Object.keys(pendingView).length) {
    return;
  }
  const patch = pendingView;
  pendingView = {};
  viewInFlight = true;
  post('/api/view', patch)
    .catch(() => undefined)
    .finally(() => {
      viewInFlight = false;
      flushView();
    });
}

const store = {
  get: (key) => (key in view ? view[key] : null),
  set(key, value) {
    const text = String(value);
    if (view[key] === text) {
      return;
    }
    view[key] = text;
    pendingView[key] = text;
    flushView();
  },
  remove(key) {
    if (!(key in view)) {
      return;
    }
    delete view[key];
    pendingView[key] = null;
    flushView();
  },
};

/*
 * A window closing must not take the last change with it.
 *
 * `pagehide` rather than `beforeunload`, which a hidden window is not
 * guaranteed to get, and `sendBeacon` rather than `fetch`, which is cancelled
 * with the document. The token rides in the query string exactly as it does for
 * every other route, so the beacon needs no headers — which it could not set
 * anyway.
 */
addEventListener('pagehide', () => {
  if (!Object.keys(pendingView).length) {
    return;
  }
  const body = new Blob([JSON.stringify(pendingView)], { type: 'application/json' });
  navigator.sendBeacon(`/api/view?token=${encodeURIComponent(token)}`, body);
  pendingView = {};
});

/**
 * Carries a store written under the old, port-shaped origin into the new home.
 *
 * Only when the service has nothing: once it holds the answer it is the answer,
 * and a stale copy in this origin must never overwrite it. Reading is wrapped
 * because a browser told to refuse site data throws on the property itself.
 */
function adoptPreviousStorage() {
  if (Object.keys(view).length) {
    return;
  }
  const carried = {};
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      const value = key === null ? null : localStorage.getItem(key);
      if (key && typeof value === 'string') {
        view[key] = value;
        carried[key] = value;
      }
    }
  } catch {
    return;
  }
  if (Object.keys(carried).length) {
    pendingView = { ...pendingView, ...carried };
    flushView();
  }
}

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
  el('set-notify-delay').value = String(view.notifications.delaySeconds);
  // Language and dates belong to the view, not to the service: they are stored
  // here like the theme, and take effect without a restart.
  el('set-language').value = store.get('language') ?? 'auto';
  el('set-date-locale').value = store.get('dateLocale') ?? 'auto';

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
  // Two routes because they are two different promises. The scan settings are
  // built into the providers and may want a restart; the notification delay is
  // handed to the queue and holds from the moment it is saved. Sent first, so a
  // restart that follows cannot swallow it.
  const delayed = await post('/api/notifications', {
    delaySeconds: Number(el('set-notify-delay').value),
  });
  const result = await post('/api/settings', body);
  fillSettings({ ...result.saved, notifications: delayed.notifications });

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
  const theme = store.get('theme') ?? 'auto';
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
  el('theme').textContent = `${t('bar.theme')}: ${theme}`;
  el('theme').title = t('bar.themeTitle');

  const primary = store.get('primary');
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

// Here rather than beside its definition: it sends what it carries straight
// away, and `post` above is the thing it sends with.
adoptPreviousStorage();

// ------------------------------------------------------------------ format

/** The language in force, resolved once per render pass. */
function language() {
  return resolveLanguage(store.get('language') ?? 'auto', navigator.languages);
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
  const stored = store.get('dateLocale') ?? 'auto';
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

/**
 * Everything that makes a view: the token is not part of one, and neither is
 * the `open` a toast adds to send the browser here with a session to reveal.
 */
const VIEW_KEYS = [
  'q',
  'scope',
  'sort',
  'match',
  'status',
  'provider',
  'ws',
  'from',
  'to',
  'watched',
  'starred',
];
const VIEW = 'view';

function readUrl() {
  let query = new URLSearchParams(location.search);
  /*
   * A start carries no view — the window opens the bare address every time, and
   * a toast adds only the session to open — so the last one is restored, from
   * where the theme, the colours and the column widths already live. Which
   * sessions you look at is a way of working rather than a one-off.
   *
   * An address that carries a view wins, and is not merged with the stored one:
   * a link is a whole view, and half of someone else's filters mixed into yours
   * would be neither of the two.
   */
  if (!VIEW_KEYS.some((key) => query.has(key))) {
    query = new URLSearchParams(store.get(VIEW) ?? '');
  }
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
 * kept as a bookmark — "what is waiting on webshop" as a favourite — and in
 * storage beside it, so the next start opens on the view you left rather than
 * on the default one. The URL is still the one that decides: see
 * {@link readUrl}.
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
  // Stored before the token is added, and deliberately without it: a new token
  // is minted every time the service starts, so a stored one would restore a
  // view that cannot talk to it. Reset writes an empty view through here too,
  // which is what makes it clear the stored one as well.
  store.set(VIEW, query.toString());
  // The token stays in the URL: without it a reload cannot talk to the service.
  query.set('token', token);
  history.replaceState(null, '', `${location.pathname}?${query}`);
}

// ------------------------------------------------------------- selection

/**
 * Whether a session survives the filters, optionally under a band's own markers.
 *
 * `markers` replaces the two marker filters and nothing else. A group that says
 * *watched* shows its watched rows whatever the bar at the top is narrowed to,
 * and every other filter — the search, the statuses, the dates — still applies:
 * the band overrides the one narrowing it is about, not the whole question.
 */
function passes(session, markers = filters) {
  const marks = state.marks;
  // A search is answered by the service, which reads the transcripts. It always
  // narrows, whatever the match mode: widening it would return sessions that do
  // not contain what you typed.
  if (state.matched && !state.matched[session.id]) return false;

  // One entry per filter actually switched on. An inactive filter is absent
  // rather than "true", which is what lets "any" mean "one of the things I
  // asked for" instead of "everything".
  const verdicts = [];
  if (markers.watchedOnly) verdicts.push(marks.watched.includes(session.id));
  if (markers.favoritesOnly) verdicts.push(marks.favorites.includes(session.id));
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
  /*
   * The direction lives in `lib.js`, where it can be asked directly — see the
   * note there. Every row takes part, including the ones showing nothing: the
   * column is filled on watched rows only, since the point of it is the handful
   * you follow, but the age behind it is a fact about all of them and leaving
   * the rest unordered would be a sort that scattered them.
   */
  minutes: byStatusAge,
  created: (a, b) => time(a.createdAt) - time(b.createdAt),
  updated: (a, b) => time(a.updatedAt) - time(b.updatedAt),
  // A row with nothing on record sorts as the oldest rather than as the newest:
  // "not since this was kept" is further back than any date here, not nearer.
  watchedAt: (a, b) =>
    time(state.marks.watchedAt?.[a.id] ?? 0) - time(state.marks.watchedAt?.[b.id] ?? 0),
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

// ------------------------------------------------------------------- groups

/*
 * Bands the reader put there, and the rows they hold.
 *
 * A sort answers "which of these needs me first"; it cannot answer "these six
 * belong together", because nothing in a transcript says so. Only the reader
 * knows, and until now there was nowhere to write it down.
 *
 * So the order is theirs and the sort works inside it: groups sit where they
 * were dragged, their rows are sorted within, and everything ungrouped follows
 * in one pool at the end. A group that floated according to its contents would
 * undo the one thing it exists to give — a place you can look back at.
 *
 * Membership outranks the watched and starred pinning above, which is the same
 * decision seen from the other side: a row that jumped out of its band the
 * moment it was watched would make the band a lie about what it holds.
 */
const GROUPS = 'groups';

/** Prefix on a band's key, so one list can carry both and stay reconcilable. */
const BAND = 'group:';
const bandKey = (group) => `${BAND}${group.id}`;
const isBand = (key) => key.startsWith(BAND);
const groupById = (id) => groups.find((group) => group.id === id);
const groupOf = (sessionId) => groups.find((group) => group.members.includes(sessionId));

/**
 * Read once and kept, because every render walks it.
 *
 * Shaped on the way in rather than trusted: this is a string the reader's own
 * store handed back, and a half-written one must cost a group rather than the
 * table it is drawn in.
 */
function readGroups() {
  let parsed;
  try {
    parsed = JSON.parse(store.get(GROUPS) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .filter((group) => group && typeof group.id === 'string' && typeof group.name === 'string')
    .map((group) => ({
      id: group.id,
      name: group.name,
      collapsed: group.collapsed === true,
      // Empty means "follow the bar at the top", which is what a band does
      // until it is told otherwise.
      only: group.only === 'watched' || group.only === 'starred' ? group.only : '',
      members: Array.isArray(group.members)
        ? group.members.filter((id) => typeof id === 'string')
        : [],
    }));
}

let groups = readGroups();

function saveGroups() {
  store.set(GROUPS, JSON.stringify(groups));
}

/**
 * A session belongs to one group at most, so joining one leaves the other.
 *
 * `null` takes it out of every band and returns it to the pool, which is also
 * what deleting a group does to everything it held.
 */
function assignToGroup(sessionId, groupId) {
  for (const group of groups) {
    group.members = group.members.filter((id) => id !== sessionId);
  }
  const wanted = groupId === null ? undefined : groupById(groupId);
  if (wanted) {
    wanted.members.push(sessionId);
  }
  saveGroups();
  render(true);
}

/**
 * The order the table is drawn in: bands where they were put, their rows sorted
 * inside them, and the pool last.
 *
 * A member that a filter hides is left out like any other row, and its band
 * stays: a group that vanished because nothing in it matched would be a group
 * the reader cannot find their way back to, and the count on it already says
 * how much is being held back.
 */
function targetOrder() {
  const order = comparator(filters.sort);
  const entries = [];
  // Everything any band claims, whether or not that band is showing it: a row
  // in a group must never also appear in the pool, and a band narrowed to its
  // watched rows is still the owner of the ones it is hiding.
  const claimed = new Set(groups.flatMap((group) => group.members));

  for (const group of groups) {
    entries.push(bandKey(group));
    if (!group.collapsed) {
      entries.push(...held(group).sort(order).map((session) => session.id));
    }
  }

  entries.push(
    ...[...state.sessions.values()]
      .filter((session) => !claimed.has(session.id) && passes(session))
      .sort(order)
      .map((session) => session.id),
  );
  return entries;
}

/** How many of those entries are sessions, which is what the counter counts. */
const sessionsIn = (entries) => entries.filter((key) => !isBand(key)).length;

/** The marker filters a band answers to: its own when it has any. */
const markersOf = (group) =>
  group.only
    ? { watchedOnly: group.only === 'watched', favoritesOnly: group.only === 'starred' }
    : filters;

/** What a group holds that the filters let through, collapsed or not. */
const held = (group) =>
  [...state.sessions.values()].filter(
    (session) => group.members.includes(session.id) && passes(session, markersOf(group)),
  );

// ---------------------------------------------------------------- rendering

/**
 * How far a band has to reach to span the table.
 *
 * Counted from the header rather than written down, for the same reason the
 * `col` elements are built from it: a column added there and forgotten here
 * would leave every band one cell short, which is a layout that looks like a
 * rendering bug and is a missed edit.
 */
// ------------------------------------------------------- the columns you keep

/*
 * Which columns are shown, and in what order.
 *
 * The table carries ten and no reader needs all ten: which ones matter depends
 * on what is being looked for, and the answer changes from one afternoon to the
 * next. The order does too — a column is easier to read against the one beside
 * it, and which one that should be is not something this can decide.
 *
 * Held with the rest of the view, so it survives a restart and a port change.
 * Applied to the markup rather than to a copy of it: the header row is the only
 * list of columns there has ever been here, the `col` elements are built from
 * it and now the cells are put in step with it, so a column cannot be added in
 * one place and forgotten in another.
 */
const COLUMN_LAYOUT = 'columnLayout';

/** Every column the table knows, in the order the markup declares them. */
const declaredColumns = () =>
  [...document.querySelectorAll('#sessions thead th[data-column]')].map((th) => th.dataset.column);

let layout = { order: [], hidden: [] };

function readLayout() {
  const known = declaredColumns();
  let stored;
  try {
    stored = JSON.parse(store.get(COLUMN_LAYOUT) ?? '{}');
  } catch {
    stored = {};
  }
  const kept = (list) =>
    Array.isArray(list) ? list.filter((key) => known.includes(key)) : [];
  // A column the store has never heard of is appended rather than dropped: a
  // release that adds one must not need the reader to go and find it, and a
  // release that removes one must not leave a name behind that nothing draws.
  const order = [...new Set(kept(stored.order))];
  return { order: [...order, ...known.filter((key) => !order.includes(key))], hidden: kept(stored.hidden) };
}

const saveLayout = () => store.set(COLUMN_LAYOUT, JSON.stringify(layout));
const shownColumns = () => layout.order.filter((key) => !layout.hidden.includes(key));

/** How far a band has to reach: the columns actually on screen. */
const COLUMN_COUNT = () => shownColumns().length;

/**
 * Applies a change and writes it, which is the whole of what saving means here.
 *
 * The rows are thrown away rather than reordered in place. A reorder touches
 * every cell of every row, and rebuilding them is what `syncRows` does anyway —
 * doing it twice, once by hand and once by the reconciler, is how the two ideas
 * of the order drift apart.
 */
function changeLayout(mutate) {
  mutate();
  saveLayout();
  applyColumnLayout();
  buildColumns();
  rowsBody.textContent = '';
  render(true);
  fillColumnsMenu();
}

/** The name a column is known by, which is the one its header wears. */
const columnName = (key) => t(`column.${key}`);

function fillColumnsMenu() {
  const shown = el('columns-visible');
  const order = el('columns-order');
  shown.textContent = '';
  order.textContent = '';

  for (const key of layout.order) {
    const on = !layout.hidden.includes(key);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'menu-item';
    toggle.setAttribute('aria-pressed', String(on));
    setText(toggle, columnName(key));
    toggle.addEventListener('click', () => {
      // The last one standing is not offered: a table with no columns is a
      // window with nothing in it and no obvious way back.
      if (on && shownColumns().length === 1) {
        return;
      }
      changeLayout(() => {
        layout.hidden = on
          ? [...layout.hidden, key]
          : layout.hidden.filter((hidden) => hidden !== key);
      });
    });
    shown.append(toggle);

    const row = document.createElement('div');
    row.className = 'menu-item order-item';
    row.draggable = true;
    row.dataset.column = key;
    const grip = document.createElement('span');
    grip.className = 'order-grip';
    grip.setAttribute('aria-hidden', 'true');
    prependIcon(grip, 'grip');
    row.append(grip, document.createTextNode(columnName(key)));
    bindColumnDrag(row, key);
    order.append(row);
  }
}

/** Picking a column up and dropping it above or below another, as bands do. */
let draggingColumn = null;

function bindColumnDrag(row, key) {
  row.addEventListener('dragstart', (event) => {
    draggingColumn = key;
    row.classList.add('dragged');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
  });
  row.addEventListener('dragend', () => {
    draggingColumn = null;
    row.classList.remove('dragged');
    for (const other of el('columns-order').children) delete other.dataset.drop;
  });
  row.addEventListener('dragover', (event) => {
    if (draggingColumn === null || draggingColumn === key) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    for (const other of el('columns-order').children) delete other.dataset.drop;
    const box = row.getBoundingClientRect();
    row.dataset.drop = event.clientY < box.top + box.height / 2 ? 'above' : 'below';
  });
  row.addEventListener('dragleave', () => delete row.dataset.drop);
  row.addEventListener('drop', (event) => {
    event.preventDefault();
    const where = row.dataset.drop;
    const moved = draggingColumn;
    draggingColumn = null;
    if (!moved || moved === key || !where) {
      return;
    }
    changeLayout(() => {
      const rest = layout.order.filter((candidate) => candidate !== moved);
      const at = rest.indexOf(key);
      rest.splice(where === 'above' ? at : at + 1, 0, moved);
      layout.order = rest;
    });
  });
}

/** Puts one row's cells into the reader's order, by name and never by index. */
function orderCells(tr) {
  for (const key of layout.order) {
    const cell = tr.querySelector(`td[data-column="${key}"]`);
    if (cell) tr.append(cell);
  }
}

/**
 * Writes the order and the hiding into the document.
 *
 * The hiding is one stylesheet rather than an attribute per cell: five hundred
 * rows of ten cells is five thousand writes for a change one selector makes,
 * and the header and the `col` carry the same name, so the same rule reaches
 * all three.
 */
function applyColumnLayout() {
  const head = document.querySelector('#sessions thead tr');
  for (const key of layout.order) {
    const th = head.querySelector(`th[data-column="${key}"]`);
    if (th) head.append(th);
  }
  for (const tr of rowsBody.querySelectorAll('tr:not(.band)')) {
    orderCells(tr);
  }
  const sheet = el('column-hiding');
  sheet.textContent = layout.hidden
    .map((key) => `#sessions [data-column="${key}"] { display: none; }`)
    .join('\n');
  for (const band of rowsBody.querySelectorAll('tr.band > td')) {
    band.colSpan = COLUMN_COUNT();
  }
}

/** Either a band or a session row, told apart by the key the order carries. */
function createEntry(key) {
  return isBand(key) ? createBand(key) : createRow(key);
}

/**
 * The band a group is drawn as: one row spanning the table, carrying the fold,
 * the name and how much it holds.
 *
 * A row of the same table rather than a heading between two tables, so the
 * columns keep lining up and one reconciliation pass still owns the order.
 */
function createBand(key) {
  const id = key.slice(BAND.length);
  const tr = document.createElement('tr');
  tr.dataset.id = key;
  tr.className = 'band';
  tr.draggable = true;
  tr.innerHTML =
    `<td colspan="${COLUMN_COUNT()}">` +
    '<button class="band-fold" type="button" aria-expanded="true"></button>' +
    '<span class="band-grip" aria-hidden="true"></span>' +
    '<span class="band-name"></span>' +
    '<span class="band-count muted"></span>' +
    // The band's own answer to the two marker filters at the top of the window.
    // Same two shapes, so a filter that narrows to a marker looks like the
    // marker it narrows to here exactly as it does up there.
    '<button class="band-only" type="button" data-only="watched" aria-pressed="false"></button>' +
    '<button class="band-only" type="button" data-only="starred" aria-pressed="false"></button>' +
    '</td>';

  for (const chip of tr.querySelectorAll('.band-only')) {
    prependIcon(chip, chip.dataset.only === 'watched' ? 'eye' : 'star');
    chip.addEventListener('click', () => {
      const group = groupById(id);
      if (!group) {
        return;
      }
      // A third press puts the band back on the bar's own filter, so there is
      // always a way back to following it without deleting the group.
      group.only = group.only === chip.dataset.only ? '' : chip.dataset.only;
      saveGroups();
      render(true);
    });
  }

  const fold = tr.querySelector('.band-fold');
  prependIcon(fold, 'caret-down');
  prependIcon(tr.querySelector('.band-grip'), 'grip');
  fold.addEventListener('click', () => {
    const group = groupById(id);
    if (!group) {
      return;
    }
    group.collapsed = !group.collapsed;
    saveGroups();
    render(true);
  });
  tr.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openGroupMenu(id, event);
  });
  bindBandDrag(tr, id);
  return tr;
}

/**
 * Picking a band up and putting it above or below another.
 *
 * An insertion point rather than a swap: "put this one under that one" is the
 * thing being asked, and swapping two bands moves a group the reader never
 * touched. The line is drawn on the band being passed, above or below according
 * to which half of it the pointer is in, so what will happen is visible before
 * the button is released.
 *
 * The order is only written on drop. A drag that ends anywhere else — Escape,
 * outside the table, on itself — leaves the groups exactly as they were.
 */
let dragging = null;
/** What is being dragged: a band being reordered, or a row looking for one. */
let draggingRow = null;

/**
 * A row dropped on a band joins that group.
 *
 * The menu remains the way that works from the keyboard and the way that scales
 * — dragging a row five hundred places up to a band is a gesture this table is
 * the wrong shape for. This is the short way for the row already beside the
 * band it belongs in.
 */
function bindRowDrag(tr, id) {
  tr.draggable = true;
  tr.addEventListener('dragstart', (event) => {
    draggingRow = id;
    tr.classList.add('dragged');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  });
  tr.addEventListener('dragend', () => {
    draggingRow = null;
    tr.classList.remove('dragged');
    clearDropMarks();
  });
}

function bindBandDrag(tr, id) {
  tr.addEventListener('dragstart', (event) => {
    dragging = id;
    tr.classList.add('dragged');
    event.dataTransfer.effectAllowed = 'move';
    // Firefox starts no drag at all without something on the transfer, and the
    // identifier is already held above: this is the price of entry, not a channel.
    event.dataTransfer.setData('text/plain', id);
  });
  tr.addEventListener('dragend', () => {
    dragging = null;
    tr.classList.remove('dragged');
    clearDropMarks();
  });
  tr.addEventListener('dragover', (event) => {
    clearDropMarks();
    // A row landing on a band goes *into* it, so there is no above or below to
    // choose: the whole band lights up rather than one of its edges.
    if (draggingRow !== null) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      tr.dataset.drop = 'into';
      return;
    }
    if (dragging === null || dragging === id) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = tr.getBoundingClientRect();
    tr.dataset.drop = event.clientY < box.top + box.height / 2 ? 'above' : 'below';
  });
  tr.addEventListener('dragleave', () => delete tr.dataset.drop);
  tr.addEventListener('drop', (event) => {
    event.preventDefault();
    const where = tr.dataset.drop;
    clearDropMarks();
    if (draggingRow !== null) {
      const row = draggingRow;
      draggingRow = null;
      assignToGroup(row, id);
      return;
    }
    if (dragging === null || dragging === id || !where) {
      return;
    }
    const moved = groupById(dragging);
    const onto = groups.indexOf(groupById(id));
    if (!moved || onto === -1) {
      return;
    }
    groups = groups.filter((group) => group.id !== dragging);
    const at = groups.indexOf(groupById(id));
    groups.splice(where === 'above' ? at : at + 1, 0, moved);
    saveGroups();
    render(true);
  });
}

function clearDropMarks() {
  for (const band of rowsBody.querySelectorAll('tr.band[data-drop]')) {
    delete band.dataset.drop;
  }
}

/** Name, count and fold, written only when they changed. */
function updateBand(tr, group, shown, total) {
  setText(tr.querySelector('.band-name'), group.name);
  // Both numbers when they differ, because the difference is the whole story: a
  // band narrowed to its watched rows keeps the ones it is hiding, and a bare
  // "0 shown" on a group holding six looks like a group that lost them.
  setText(
    tr.querySelector('.band-count'),
    shown === total ? t('group.count', { count: shown }) : t('group.countOf', { shown, total }),
  );
  tr.querySelector('.band-fold').setAttribute('aria-expanded', String(!group.collapsed));
  tr.dataset.collapsed = String(group.collapsed);
  tr.querySelector('.band-fold').title = t(group.collapsed ? 'group.expand' : 'group.collapse');
  for (const chip of tr.querySelectorAll('.band-only')) {
    const on = group.only === chip.dataset.only;
    lightIcon(chip, on, chip.dataset.only === 'watched' ? 'eye' : 'star');
    chip.title = t(on ? 'group.onlyOff' : `group.only.${chip.dataset.only}`);
    chip.setAttribute('aria-label', chip.title);
  }
}

function createRow(id) {
  const tr = document.createElement('tr');
  tr.dataset.id = id;
  // Every cell names its column, exactly as the header does. That is what lets
  // one rule hide a column everywhere at once, and what lets the cells be put
  // back in the reader's order without counting positions.
  tr.innerHTML =
    '<td data-column="status"><button class="marker status" type="button"></button></td>' +
    '<td data-column="watched"><button class="marker watched" type="button" aria-pressed="false"></button></td>' +
    '<td data-column="starred"><button class="marker favorite" type="button" aria-pressed="false"></button></td>' +
    '<td class="num" data-column="minutes"></td>' +
    '<td class="at created" data-column="created"></td>' +
    '<td class="at updated" data-column="updated"></td>' +
    '<td class="at watched-at" data-column="watchedAt"></td>' +
    // No brush before either value any more: recolouring lives in the row's
    // menu with everything else, and two buttons per row bought one gesture
    // each at the price of the width the names are read in.
    '<td class="provider" data-column="provider"><span class="badge tag"></span></td>' +
    '<td class="ws" data-column="workspace"><button class="link tag" type="button"></button></td>' +
    '<td class="title" data-column="title"><button class="link text" type="button"></button>' +
    '<span class="matched"></span></td>';
  orderCells(tr);
  tr.querySelector('.status').addEventListener('click', () =>
    state.marks.unacknowledged.includes(id) ? acknowledge([id]) : unacknowledge([id]),
  );
  tr.querySelector('.watched').addEventListener('click', () => toggleMark('watched', id));
  tr.querySelector('.favorite').addEventListener('click', () => toggleMark('favorite', id));
  // A click lands on the thing it means, never on the row: a stray click in the
  // margin opens nothing.
  tr.querySelector('.ws .link').addEventListener('click', () => open(id, 'workspace'));
  tr.querySelector('.title .link').addEventListener('click', () => open(id, 'session'));
  bindRowDrag(tr, id);
  // The browser's own menu offers nothing about a session, so the row takes the
  // gesture. `m` on the selected row does the same thing, for the keyboard.
  tr.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    // Remembered so the highlight can be taken back when the menu closes: a row
    // lit only because a menu was opened on it goes on looking chosen long
    // after the menu is gone. A row already selected — by `j`, `k` or a click —
    // was not selected by this, and keeps its highlight.
    menuSelected = state.selected === id ? null : id;
    select(id);
    openRowMenu(id, event);
  });
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
  // A status set by hand is drawn differently, because a status asserted and a
  // status observed are two different claims and the table must not mix them
  // silently. The service says which by the reason it sends.
  const forced = session.statusReason.startsWith(FORCED_PREFIX);
  status.dataset.forced = String(forced);
  // An inferred status has to justify itself, and the label carries the meaning
  // for anyone who cannot see the shape.
  const label = statusLabel(session.status);
  status.setAttribute('aria-label', unseen ? `${label}, ${t('row.unacknowledged')}` : label);
  // The tooltip names what the click will do, in both directions. It used to
  // appear only on an unseen row, which left the other half of the toggle with
  // nothing saying it was there at all.
  status.title =
    `${label} — ${session.statusReason}\n` +
    t(unseen ? 'row.acknowledge' : 'row.unacknowledge');

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
  // Every cell is addressed by name rather than by position. An index has to be
  // kept in step with the markup by hand, and one of them was not: the minute
  // timer wrote into the transcript cell, destroyed the button it held, and the
  // next redraw died looking for it — which froze every marker below that row.
  // Minutes only on watched rows: the point is how long the handful you follow
  // have been sitting in their current state.
  //
  // Through `setText` rather than written straight, here as in the live
  // regions: assigning `textContent` throws the text node away and makes a new
  // one even when the string is identical, and most of these are identical on
  // most passes. It costs a repaint per cell per scan, and a caret or a
  // selection inside one does not survive it.
  setText(
    tr.querySelector('.num'),
    watched ? duration(minutesSince(session.statusChangedAt)) : '',
  );
  setText(tr.querySelector('.created'), at(session.createdAt));
  setText(tr.querySelector('.updated'), at(session.updatedAt));
  // Empty when nothing is on record, which is not the same as "never watched":
  // it says only that no change has been seen since this began being kept.
  const changedAt = state.marks.watchedAt?.[session.id];
  const watchedCell = tr.querySelector('.watched-at');
  setText(watchedCell, changedAt ? at(changedAt) : '');
  watchedCell.title = changedAt
    ? t(watched ? 'row.watchedSince' : 'row.watchDropped', { at: at(changedAt) })
    : t('row.watchUnrecorded');
  const badge = tr.querySelector('.badge');
  setText(badge, session.provider);
  paintTag(badge, 'provider', session.provider);
  const ws = tr.querySelector('.ws .link');
  const workspace = folder(session.cwd);
  setText(ws, workspace);
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
  ws.title = session.cwd ? `${t('row.openWorkspace')} ${session.cwd}` : t('row.workspaceUnknown');
  const title = tr.querySelector('.title .link');
  setText(title, session.title);
  // The whole title, since the column cuts it — and what a click does, which
  // the tooltip was saying alone before.
  title.title = `${session.title}\n\n${t('row.openSession')}`;
  const matched = state.matched?.[session.id] ?? [];
  setText(
    tr.querySelector('.title .matched'),
    matched.length ? `[${matched.join(', ')}]` : '',
  );
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
    /*
     * Only the rows actually out of place are moved.
     *
     * `append` on a node already in the document does not leave it alone: it
     * detaches it and puts it back. Appending every row on every pass therefore
     * rebuilt the whole table each time, even when the order had not changed at
     * all — which, with the list keeping itself sorted, is most passes.
     *
     * Two things follow, and both were reported before this was found. A row
     * detached between a mousedown and a mouseup takes the click with it: the
     * browser fires no click at all when the press and the release do not meet,
     * so a click on a row simply does nothing. And a link under the pointer
     * loses its hover and regains it, which is the flash on the underline.
     *
     * The cursor walks the rows already there. A row that is where it belongs
     * costs one comparison and no mutation.
     */
    let cursor = rowsBody.firstChild;
    for (const id of target) {
      const tr = present.get(id) ?? createEntry(id);
      present.set(id, tr);
      if (tr === cursor) {
        cursor = cursor.nextSibling;
      } else {
        rowsBody.insertBefore(tr, cursor);
      }
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
      const tr = createEntry(id);
      rowsBody.insertBefore(tr, anchor);
      present.set(id, tr);
    }
  }

  /*
   * Which rows belong to a band, and which of those is the last one.
   *
   * Read from the membership rather than from "have we passed a band yet",
   * which was wrong in the one place it mattered: every group is emitted before
   * the ungrouped pool, so a walk carrying that flag forward marks the whole
   * pool as belonging to the last group — and the rule down the left edge would
   * have run to the bottom of the table.
   */
  const belongs = (key) => key !== undefined && !isBand(key) && Boolean(groupOf(key));
  for (const [index, id] of target.entries()) {
    const tr = present.get(id);
    if (!tr || isBand(id)) continue;
    const member = belongs(id);
    tr.classList.toggle('member', member);
    tr.dataset.last = String(member && !belongs(target[index + 1]));
  }

  for (const id of target) {
    const tr = present.get(id);
    if (!tr) continue;
    if (isBand(id)) {
      const group = groupById(id.slice(BAND.length));
      // What the band says it holds is what passed the filters, not what it was
      // given: a count of rows nobody can see would be the one number here that
      // does not answer "where did my session go".
      if (group) updateBand(tr, group, held(group).length, group.members.length);
      continue;
    }
    const session = state.sessions.get(id);
    if (session) updateRow(tr, session);
  }
  return [...rowsBody.children].map((tr) => tr.dataset.id);
}

/**
 * Whether the list keeps itself in order, or offers to.
 *
 * Off, a sort applies to rows as they arrive and the ones already on screen
 * stay put until asked — nothing jumps under the cursor, which is what the
 * offer beside the counter exists for. On, the order is the order, and a row
 * that stops working moves to where the sort says while you are looking at it.
 *
 * Beside the theme rather than in the address bar: it changes how the list
 * behaves rather than what it shows, and a link that reordered someone else's
 * screen under them would be a strange thing to send.
 */
const AUTO_SORT = 'autoSort';
const autoSorting = () => store.get(AUTO_SORT) === 'on';

/**
 * Whether the fold over the settings and the filters is open, kept where the
 * theme and the view already are.
 *
 * Closed by default, which is the point of the fold: those four lines are set up
 * occasionally and then read past every time. What guards against forgetting a
 * filter is left behind it is the counter, which stays on screen and says "10
 * visible / 327 loaded" whether the fold is open or not.
 */
const CONTROLS = 'controls';

/**
 * `until-found` rather than a class: the content stays reachable by find-in-page,
 * which opens it to show the match — and that is the case
 * {@link showControls} exists to catch, since the switch would otherwise still
 * read as off over an open panel.
 */
function showControls(open) {
  const panel = el('controls');
  if (open) panel.removeAttribute('hidden');
  else panel.setAttribute('hidden', 'until-found');
  el('controls-toggle').setAttribute('aria-expanded', String(open));
}

function syncControlsFold() {
  showControls(store.get(CONTROLS) === 'open');
}

/** The switch says which of the two it is doing, in its state and its icon. */
function syncAutoSort() {
  const on = autoSorting();
  const button = el('auto-sort');
  button.setAttribute('aria-pressed', String(on));
  // Sorted while it holds, and the offer to sort while it does not: the icon
  // says what is happening rather than what the button would do next.
  swapIcon(button, on ? 'sort-ascending' : 'reorder');
}

function render(applyOrder = false) {
  // Before the rows are drawn, since it decides what colour they carry. It
  // returns early unless the set of projects actually changed, so this costs a
  // comparison on every render and a write on almost none.
  syncColours();
  const keepOrdered = applyOrder || autoSorting();
  const target = targetOrder();
  const shown = syncRows(target, keepOrdered);

  // If the sort would genuinely reorder the rows on screen, the list does not
  // jump: it offers to do it when you ask.
  const moved = shown.filter((id, index) => target[index] !== id).length;
  const reorder = el('reorder');
  if (moved > 0 && !keepOrdered) {
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

  const visible = sessionsIn(target);
  setText(el('counts'), t('state.counts', { visible, loaded: state.sessions.size }));
  renderEmpty(visible);
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
/** Writes a list of messages, and only when it actually changed. */
function fillNotices(node, messages) {
  // A newline, not a NUL, for the same reason the workspace list uses one.
  const signature = messages.join('\n');
  if (node.dataset.signature === signature) {
    return;
  }
  node.dataset.signature = signature;
  node.textContent = '';
  for (const message of messages) {
    const div = document.createElement('div');
    div.className = 'notice';
    div.textContent = message;
    node.append(div);
  }
}

/**
 * Two places, because these are two kinds of thing.
 *
 * A scan that failed, a root nobody is watching and a paused service are all
 * something being wrong now, and they stay on screen: an error behind a fold is
 * an error nobody reads. The history window and the session cap leaving sessions
 * out is not wrong, it is the setting doing its job — and the two settings that
 * decide it live behind the fold, so their consequence goes with them.
 */
function renderNotices() {
  const service = state.service;
  const problems = [];
  if (service) {
    if (service.paused) problems.push(t('notice.paused'));
    for (const provider of service.providers) {
      if (provider.error) {
        problems.push(t('notice.scanFailed', {
          provider: provider.provider, root: provider.root, error: provider.error,
        }));
      }
    }
    for (const failure of service.watchFailures) {
      problems.push(t('notice.notWatching', { root: failure.root, error: failure.error }));
    }
  }
  fillNotices(el('notices'), problems);
  fillNotices(
    el('truncated'),
    service && service.truncated > 0 ? [t('notice.truncated', { count: service.truncated })] : [],
  );
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
 * The other direction: puts the marker back on.
 *
 * Clicking a status now says "I have dealt with this" or "I have not", by
 * toggling, which is what the two markers beside it have always done. One-way
 * meant a marker cleared by mistake — or cleared by opening the session to look
 * — could not be put back, and the row lost the only thing saying it still
 * needed you.
 */
async function unacknowledge(ids) {
  if (!ids.length) return;
  state.marks = await post('/api/unacknowledge', { ids });
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
  /*
   * Said before the call, not on the way back from it. The service runs the
   * whole handover before it replies — including the pause a window is given to
   * come up — so a note written afterwards announced something that had already
   * finished, and left the click unanswered for the seconds that were the only
   * ones needing an answer. It then stayed until some later scan happened to
   * overwrite it, which is a lifetime decided by nothing.
   */
  el('service-state').textContent = t('state.opening');
  try {
    const result = await post('/api/open', { id, target });
    if (result.fellBack) {
      say(t('state.fellBack'));
      return;
    }
    // It arrived, so the bar goes back to saying what it says the rest of the
    // time rather than holding a progress note about finished progress.
    renderService();
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
 * How long a session has been in its status, read rather than counted.
 *
 * `1248m` is a number you have to divide before it means anything, and the
 * column is read at a glance or not at all. A unit that is zero is left out
 * entirely — `2j` rather than `2j0h0m` — so what is shown is only what carries
 * information, and `0m` is what nothing looks like.
 */
function duration(total) {
  const { days, hours, minutes } = splitDuration(total);
  const parts = [];
  if (days) parts.push(`${days}${t('unit.days')}`);
  if (hours) parts.push(`${hours}${t('unit.hours')}`);
  if (minutes || parts.length === 0) parts.push(`${minutes}${t('unit.minutes')}`);
  return parts.join('');
}

/**
 * How a hand-set status announces itself in the reason the service sends.
 *
 * Matched on rather than carried as a separate field: the reason is already the
 * one thing every status has to justify itself with, and a second field saying
 * the same thing is a second field that can disagree with the first.
 */
const FORCED_PREFIX = 'Set by you';

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
/**
 * Lights an icon that already sits beside a label, and leaves the label alone.
 *
 * {@link markWithIcon} owns the whole button — it writes the accessible name
 * and clears the content to build the icon — which is right for a marker that
 * is nothing but an icon, and wrong for a chip that carries a word. This swaps
 * the drawing and the pressed state and touches nothing else, so the outline
 * and the filled weight mean the same thing on a filter as they do on a row.
 */
function lightIcon(button, on, name) {
  button.setAttribute('aria-pressed', String(on));
  const use = button.querySelector('svg use');
  if (use) {
    use.setAttribute('href', `#icon-${on ? `${name}-fill` : name}`);
  }
}

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
    store.set(palette.store, JSON.stringify(next));
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

/** The session whose status the picker is currently about. */
let correcting = null;

/**
 * Opens the status picker on one row.
 *
 * The inferred status is shown beside the choices rather than hidden in a
 * tooltip: you are about to disagree with it, so it is the one thing you need
 * in front of you while you choose.
 */
/**
 * Everything a row offers, gathered where it can be found.
 *
 * The markers on the row keep working — a click on the eye is faster than any
 * menu — so this adds a door rather than moving one. It is also the only way a
 * row joins a group: dragging five hundred rows onto a band is a gesture the
 * list is the wrong shape for, and this works from the keyboard.
 */
/**
 * Puts a menu where the pointer is, without letting it hang off the window.
 *
 * Measured after showing rather than before: a popover has no size until it is
 * in the top layer, so a menu placed first and measured second is placed from
 * zeroes. Shown, measured, then moved — one frame, and no flash, because the
 * top layer paints once at the end of the task either way.
 */
/** Where a menu opens when a key asked for it rather than a pointer. */
function rowCorner(id) {
  const box = rowsBody
    .querySelector(`tr[data-id="${CSS.escape(id)}"]`)
    ?.getBoundingClientRect();
  return { clientX: box ? box.left + 24 : 24, clientY: box ? box.bottom : 24 };
}

function placeMenu(menu, at) {
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.showPopover();
  const box = menu.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(margin, Math.min(at.clientX, innerWidth - box.width - margin));
  const top = Math.max(margin, Math.min(at.clientY, innerHeight - box.height - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  // A flyout grows to the right by default and would go off the window when the
  // menu opened near the edge. Decided here, where the position is finally
  // known, rather than guessed at by the stylesheet.
  menu.dataset.flip = String(left + box.width + FLYOUT_WIDTH > innerWidth);
}

/** Enough room for a section to open into, in pixels; matches `.menu-flyout`. */
const FLYOUT_WIDTH = 176;

/** The row the menu lit by opening on it, and will put back when it closes. */
let menuSelected = null;

/*
 * `toggle` rather than a callback on every way out: a popover closes on Escape,
 * on a click outside, and on an item being chosen, and one of those three is
 * always the one somebody forgets.
 */
el('row-menu').addEventListener('toggle', (event) => {
  if (event.newState === 'closed' && menuSelected) {
    if (state.selected === menuSelected) {
      select(null);
    }
    menuSelected = null;
  }
});

function openRowMenu(id, at) {
  const session = state.sessions.get(id);
  if (!session) {
    return;
  }
  const dialog = el('row-menu');
  setText(el('row-menu-heading'), session.title);
  el('row-menu-heading').title = session.title;

  const unseen = state.marks.unacknowledged.includes(id);
  const ack = el('row-menu-ack');
  setText(ack, t(unseen ? 'rowMenu.ack' : 'rowMenu.unack'));
  ack.onclick = () => {
    dialog.hidePopover();
    void (unseen ? acknowledge([id]) : unacknowledge([id]));
  };

  const act = (element, run) => {
    element.onclick = () => {
      dialog.hidePopover();
      run();
    };
  };
  act(el('row-menu-session'), () => void open(id, 'session'));
  act(el('row-menu-workspace-open'), () => void open(id, 'workspace'));
  act(el('row-menu-transcript'), () => void open(id, 'transcript'));
  act(el('row-menu-provider'), () => openPalette('provider', session.provider));
  act(el('row-menu-workspace'), () => {
    const name = session.cwd && folder(session.cwd);
    if (name) openPalette('workspace', name);
  });

  // The four statuses, and the way back to the one the transcript infers. Set
  // straight from the menu rather than through a second window: a status is a
  // choice from a short list, which is what a menu is for.
  const statuses = el('row-menu-statuses');
  statuses.textContent = '';
  const forced = session.statusReason.startsWith(FORCED_PREFIX);
  for (const status of STATUSES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-item';
    button.setAttribute('aria-pressed', String(forced && session.status === status));
    setText(button, statusLabel(status));
    button.addEventListener('click', () => {
      dialog.hidePopover();
      correcting = id;
      void chooseStatus(status);
    });
    statuses.append(button);
  }
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'menu-item';
  setText(clear, t('statusPicker.clear'));
  clear.addEventListener('click', () => {
    dialog.hidePopover();
    correcting = id;
    void chooseStatus(null);
  });
  statuses.append(document.createElement('hr'), clear);
  statuses.lastElementChild.previousElementSibling.className = 'menu-sep';

  const current = groupOf(id);
  const choices = el('row-menu-groups');
  choices.textContent = '';
  // "None" is an item rather than a separate control, because leaving a group
  // and joining one are the same decision and belong in the same list of them.
  for (const group of [null, ...groups]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-item';
    button.setAttribute('aria-pressed', String((current?.id ?? null) === (group?.id ?? null)));
    setText(button, group ? group.name : t('rowMenu.noGroup'));
    button.addEventListener('click', () => {
      dialog.hidePopover();
      assignToGroup(id, group ? group.id : null);
    });
    choices.append(button);
  }
  placeMenu(dialog, at);
}

/**
 * Asks for a name, and calls back with it only when one was given.
 *
 * One dialog for creating and for renaming, because they are the same question
 * asked twice — and a second dialog saying the same thing is a second place to
 * forget a translation.
 */
function askGroupName(heading, current, done) {
  const dialog = el('group-name');
  const input = el('group-name-input');
  setText(el('group-name-heading'), heading);
  input.value = current;
  dialog.addEventListener(
    'close',
    () => {
      const name = input.value.trim();
      if (dialog.returnValue === 'save' && name) {
        done(name);
      }
    },
    { once: true },
  );
  dialog.showModal();
  input.select();
}

function createGroup() {
  askGroupName(t('group.newHeading'), '', (name) => {
    // Newest on top: a group is made to be filled, and the rows about to go in
    // it are the ones on screen now. Made at the bottom of five hundred rows it
    // would have to be dragged up before it could be used.
    groups.unshift({ id: crypto.randomUUID(), name, collapsed: false, members: [] });
    saveGroups();
    render(true);
  });
}

function openGroupMenu(id, at) {
  const group = groupById(id);
  if (!group) {
    return;
  }
  setText(el('group-menu-heading'), group.name);
  const dialog = el('group-menu');
  const rename = el('group-menu-rename');
  const remove = el('group-menu-delete');
  rename.onclick = () => {
    dialog.hidePopover();
    askGroupName(t('group.renameHeading'), group.name, (name) => {
      group.name = name;
      saveGroups();
      render(true);
    });
  };
  remove.onclick = () => {
    dialog.hidePopover();
    // The rows are not touched, only the band: they fall back into the pool and
    // the sort has them again, which is the whole of what deleting means here.
    groups = groups.filter((candidate) => candidate.id !== id);
    saveGroups();
    render(true);
  };
  placeMenu(dialog, at);
}

function openStatusPicker(id) {
  const session = state.sessions.get(id);
  if (!session) {
    return;
  }
  correcting = id;
  setText(el('status-picker-heading'), session.title);
  setText(el('status-picker-inferred'), `${t('statusPicker.inferred')} ${session.statusReason}`);

  const choices = el('status-picker-choices');
  choices.textContent = '';
  for (const status of STATUSES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.status = status;
    button.setAttribute('aria-pressed', String(session.status === status));
    decorate(button, status, statusLabel(status));
    button.addEventListener('click', () => void chooseStatus(status));
    choices.append(button);
  }
  el('status-picker').showModal();
}

async function chooseStatus(status) {
  const id = correcting;
  if (!id) {
    return;
  }
  el('status-picker').close();
  const { sessions } = await post('/api/status', { id, status });
  state.sessions = new Map(sessions.map((session) => [session.id, session]));
  render();
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
  store.set(PALETTES[kind].store, JSON.stringify(PALETTES[kind].state));
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
    store.set(COLUMN_STORE, JSON.stringify({ v: COLUMN_FORMAT, widths: columnWidths }));
  } else {
    store.remove(COLUMN_STORE);
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
  // Built again whenever the layout changes, so what the last pass left has to
  // go first: a second run would otherwise hang a second handle on every
  // header, and two resizers on one edge fight over the same drag.
  table.querySelector('colgroup')?.remove();
  for (const handle of table.querySelectorAll('.resizer')) {
    handle.remove();
  }
  const group = document.createElement('colgroup');
  // Only the columns on screen get a `col`. A hidden one whose `col` stayed
  // would leave the width it was given behind as a gap, which reads as a
  // rendering fault rather than as a column that was put away.
  for (const th of headerCells().filter((th) => !layout.hidden.includes(th.dataset.column))) {
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
    store.get(COLUMN_STORE),
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
  syncAutoSort();
  el('from').value = filters.from;
  el('to').value = filters.to;
  // The icon says whether the filter is on, the way it does on every row: an
  // outline for off and the filled weight for on. It used to be said by a lit
  // background instead, which made these two the only controls here whose state
  // the reader had to learn a second language for.
  lightIcon(el('watched-only'), filters.watchedOnly, 'eye');
  lightIcon(el('favorites-only'), filters.favoritesOnly, 'star');
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
    const chosen = event.target.value;
    // Kept here for this page, which asks for the language on every string it
    // draws and cannot await a request per call — and sent to the service as
    // well, because the menus, the dialogs and the toast buttons are written by
    // a process that cannot see this storage. One control, two readers, each
    // holding the answer where it can reach it.
    store.set('language', chosen);
    redrawEverything();
    void post('/api/settings', { app: { language: chosen } }).catch(() => undefined);
  });
  el('set-date-locale').addEventListener('change', (event) => {
    store.set('dateLocale', event.target.value);
    redrawEverything();
  });
  el('save-settings').addEventListener('click', () => void saveSettings());
  el('detect').addEventListener('click', () => void detectProviders());
  el('theme').addEventListener('click', () => {
    const current = store.get('theme') ?? 'auto';
    store.set('theme', THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
    applyAppearance();
  });
  el('primary').addEventListener('input', (event) => {
    store.set('primary', event.target.value);
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
    store.set('primary', chosen);
    applyAppearance();
  });
  // Following the system means following it as it changes, not only at load.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((store.get('theme') ?? 'auto') === 'auto') applyAppearance();
  });
  el('auto-sort').addEventListener('click', () => {
    const next = !autoSorting();
    store.set(AUTO_SORT, next ? 'on' : 'off');
    syncAutoSort();
    // Straight away rather than at the next scan: switching it on is itself the
    // asking, exactly as pressing the reorder offer is.
    render(next);
  });
  el('controls-toggle').addEventListener('click', () => {
    const open = el('controls-toggle').getAttribute('aria-expanded') !== 'true';
    store.set(CONTROLS, open ? 'open' : 'closed');
    showControls(open);
  });
  // Find-in-page reveals `hidden="until-found"` content by itself, and this is
  // the only warning it gives. Without it the panel would be on screen with its
  // switch still dark, and the next click would "open" what is already open.
  el('controls').addEventListener('beforematch', () => {
    store.set(CONTROLS, 'open');
    el('controls-toggle').setAttribute('aria-expanded', 'true');
  });
  el('status-picker-clear').addEventListener('click', () => void chooseStatus(null));
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
  /*
   * Everything carrying an unseen marker, not the rows that happen to be on
   * screen.
   *
   * It used to settle only what a filter was letting through, so that a hundred
   * rows could not be acknowledged by accident. That guard turned out to be the
   * problem: the marker exists to say "this is new to you", and the moment you
   * are looking at a filtered view — watched only, one workspace — the button
   * silently left the rest marked, so the tray counter and the dots stayed up
   * for sessions you had decided about. A button that says *all* and settles
   * some is worse than either.
   *
   * The unacknowledged list rather than the loaded sessions: it is exactly what
   * still carries a dot, including a session that has aged out of the window and
   * would otherwise keep its marker forever.
   */
  el('ack-all').addEventListener('click', () => acknowledge([...state.marks.unacknowledged]));
  el('new-group').addEventListener('click', () => createGroup());

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
    else if (event.key === 's') openStatusPicker(state.selected);
    // The whole menu, where `s` opens the one thing in it that had a key of its
    // own. Both stay: a key that used to do something must keep doing it.
    // No pointer to open at, so the row itself is the anchor: a menu that
    // appeared in the corner of the window would leave the reader hunting for
    // the thing they had just selected.
    else if (event.key === 'm') openRowMenu(state.selected, rowCorner(state.selected));
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
  // Before anything is drawn, so the fold does not open and shut in front of you
  // on every start.
  syncControlsFold();
  prependIcon(el('controls-toggle'), 'gear');
  prependIcon(el('watched-only'), 'eye');
  prependIcon(el('favorites-only'), 'star');
  prependIcon(el('notify'), 'bell');
  prependIcon(el('auto-sort'), 'reorder');
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
  // A language chosen before the desktop process could read one is still a
  // choice, and it lives here. Sent on every start rather than migrated once:
  // it costs a request nobody waits on, and there is no flag to get wrong. A
  // reader who never picked one leaves this at `auto` and nothing is sent.
  const chosenLanguage = store.get('language');
  if (chosenLanguage && chosenLanguage !== 'auto') {
    void post('/api/settings', { app: { language: chosenLanguage } }).catch(() => undefined);
  }
  // The order and the hiding first: the `col` elements and the handles are
  // built from the header row, so the header has to be in the reader's order
  // before anything is built from it.
  layout = readLayout();
  applyColumnLayout();
  // Before the language pass, which is what names the handles it builds.
  buildColumns();
  fillColumnsMenu();
  for (const palette of Object.values(PALETTES)) {
    palette.state = readSlots(store.get(palette.store));
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
        // Through `setText` like the redraw: this fires twice a minute and the
        // value changes once, so half of these writes replaced a text node with
        // an identical one.
        setText(tr.querySelector('.num'), duration(minutesSince(session.statusChangedAt)));
      }
    }
  }, 30000);
}

void boot();
