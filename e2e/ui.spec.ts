import { Page, expect, test } from '@playwright/test';
import { RunningService, finishRunningSession, startService } from './service';

let service: RunningService;
const problems: string[] = [];

test.beforeAll(async () => {
  service = await startService();
});

test.afterAll(async () => {
  await service?.stop();
});

async function open(page: Page, query = ''): Promise<void> {
  problems.length = 0;
  // A page that throws on its first line still renders a header and would pass
  // every check below, so nothing the console reports is ignored.
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));
  await page.goto(service.url + query);
  await expect(page.locator('tbody tr')).not.toHaveCount(0);
}

const rows = (page: Page) => page.locator('tbody tr');

/** WCAG contrast between two computed `rgb(...)` colours. */
function ratio(a: string, b: string): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (colour: string): number => {
    const [r, g, b] = (colour.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/**
 * Marks are shared state that outlives a page, so a test that cares about
 * ordering has to say what it expects rather than inherit what ran before it.
 */
async function clearMarks(page: Page): Promise<void> {
  for (const marker of ['.watched', '.favorite']) {
    const set = rows(page).locator(`${marker}[aria-pressed="true"]`);
    for (let remaining = await set.count(); remaining > 0; remaining -= 1) {
      await set.first().click();
      await expect(set).toHaveCount(remaining - 1);
    }
  }
}

test('lists the sessions, with their status and workspace', async ({ page }) => {
  await open(page);
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('#counts')).toHaveText('3 visible / 3 loaded');
  await expect(page.getByText('Refactor the importer')).toBeVisible();
  await expect(page.getByText('Rewrite the landing page')).toBeVisible();
  // The folder name is shown; the full path stays in the tooltip.
  await expect(rows(page).first().locator('td.ws .link')).toHaveAttribute('title', /projects/);
  expect(problems).toEqual([]);
});

test('the name stays put even when the conversation drifts away from it', async ({ page }) => {
  await open(page);
  // Claude rewrites its generated title as the subject moves; the first one is
  // what names the session, because a name that changes under you cannot be
  // learned. The later ones are not shown at all: Codex has no equivalent, and
  // a column only one provider can fill is not a column this list offers.
  const drifted = rows(page).filter({ hasText: 'Rewrite the landing page' });
  await expect(drifted.locator('.title .text')).toHaveText('Rewrite the landing page');
  await expect(page.getByText('Argue about the hero image')).toHaveCount(0);
});

test('the theme can be forced either way, and is remembered', async ({ page }) => {
  await open(page);
  const root = page.locator('html');
  const theme = page.locator('#theme');
  // Follows the system until told otherwise.
  await expect(theme).toHaveText('Theme: auto');
  await expect(root).not.toHaveAttribute('data-theme', /.+/);

  await theme.click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await theme.click();
  await expect(root).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.locator('#theme').click(); // back to auto
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('a random primary stays readable as text, whatever it is', async ({ page }) => {
  await open(page);
  await page.locator('#theme').click(); // light, so the check has a known background

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.locator('#primary-random').click();
    const { accent, background } = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.cssText = 'color: var(--accent); position: absolute; visibility: hidden';
      document.body.append(probe);
      const accentColour = getComputedStyle(probe).color;
      probe.remove();
      return { accent: accentColour, background: getComputedStyle(document.body).backgroundColor };
    });
    // The frame only has to be seen; the accent is read, so it is walked until
    // it clears the same 4.5:1 the palette is held to.
    expect(ratio(accent, background)).toBeGreaterThanOrEqual(4.4);
  }

  await page.evaluate(() => localStorage.removeItem('primary'));
  await page.locator('#theme').click();
  await page.locator('#theme').click();
});

test('the interface and the dates follow the chosen language', async ({ page }) => {
  await open(page);
  await expect(page.locator('#reset')).toHaveText('Reset');
  // English dates stay sortable: 01/08 reads as two different days depending on
  // where the reader is, and a column of dates is where that matters most.
  await expect(page.locator('tbody tr').first().locator('td.at').first()).toHaveText(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
  );

  await page.locator('#open-settings').click();
  await page.locator('#set-language').selectOption('fr');
  await expect(page.locator('#reset')).toHaveText('Réinitialiser');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  // French follows the language, so the date format follows with it.
  await expect(page.locator('tbody tr').first().locator('td.at').first()).toHaveText(
    /^\d{2}\/\d{2}\/\d{4}/,
  );

  // Statuses are words, so they are translated; providers are names and are not.
  await expect(page.locator('#status-filters button').first()).toHaveText('en cours');
  await expect(page.locator('#provider-filters button').first()).toHaveText('claude');
  // The header carries a date too, and drawing the list does not touch it.
  await expect(page.locator('#service-state')).toHaveText(/\d{2}\/\d{2}\/\d{4}/);

  // The date locale can be set on its own, against the language.
  await page.locator('#set-date-locale').selectOption('iso');
  await expect(page.locator('#service-state')).toHaveText(/\d{4}-\d{2}-\d{2}/);
  await expect(page.locator('tbody tr').first().locator('td.at').first()).toHaveText(
    /^\d{4}-\d{2}-\d{2}/,
  );
  await expect(page.locator('#reset')).toHaveText('Réinitialiser');

  await page.reload();
  await expect(page.locator('#reset')).toHaveText('Réinitialiser');

  // Left as it was found.
  await page.evaluate(() => {
    localStorage.removeItem('language');
    localStorage.removeItem('dateLocale');
  });
});

test('a bare service offers only what it can actually do', async ({ page }) => {
  await open(page);
  await page.locator('#open-settings').click();

  // The command has no window to start at login and no tray, so the section is
  // withheld rather than shown and quietly ignored.
  await expect(page.locator('#host-settings')).toBeHidden();
  await expect(page.locator('#set-stale')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

test('the page is served under a policy, and every answer refuses to leak its address', async ({
  page,
}) => {
  const response = await page.goto(service.url);
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("default-src 'none'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  // The token is in the address, so the address is a credential.
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-content-type-options']).toBe('nosniff');

  // Not only the document: an API answer carries the token in its address too.
  const api = await page.request.get(service.url.replace('/?token=', '/api/state?token='));
  expect(api.headers()['referrer-policy']).toBe('no-referrer');
  expect(api.headers()['x-content-type-options']).toBe('nosniff');
});

test('the settings dialog still closes from its own button, under that policy', async ({ page }) => {
  await open(page);
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings')).toBeVisible();

  // `form-action 'none'` must not reach a form whose only job is to close a
  // dialog. Nothing else in the suite clicks this button, so the policy could
  // have broken it without a single test noticing.
  await page.locator('#settings button[value="cancel"]').click();
  await expect(page.locator('#settings')).toBeHidden();
  // A blocked policy shows up here, since `open` fails the test on any console
  // error the page reports.
  expect(problems).toEqual([]);
});

test('an inferred status justifies itself in its tooltip', async ({ page }) => {
  await open(page);
  const status = rows(page).first().locator('.status');
  await expect(status).toHaveAttribute('title', /—/);
  await expect(status).toHaveAttribute('aria-label', /idle|running|unknown|failed/);
});

test('search narrows the list and says which field matched', async ({ page }) => {
  await open(page);
  await page.locator('#query').fill('importer');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('tbody .matched')).toHaveText('[title]');
  expect(problems).toEqual([]);
});

test('a status filter narrows the list, and reset brings it back', async ({ page }) => {
  await open(page);
  await page.locator('#status-filters button', { hasText: 'running' }).click();
  await expect(rows(page)).toHaveCount(1);
  await page.locator('#reset').click();
  await expect(rows(page)).toHaveCount(3);
});

test('the workspace filter keeps its one line, and filters', async ({ page }) => {
  await open(page);
  await page.locator('#workspace-filter summary').click();
  await page.locator('#workspace-list input').first().check();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('#workspace-count')).toHaveText('(1)');
});

test('the search scope decides whether transcripts are read', async ({ page }) => {
  await open(page);
  // Every transcript contains "the work", so a content search finds all three.
  await page.locator('#query').fill('the');
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).filter({ hasText: 'Chase a flaky test' }).locator('.matched')).toHaveText(
    '[content]',
  );
  // Only two titles contain it.
  await page.locator('#scope').selectOption('title');
  await expect(rows(page)).toHaveCount(2);
});

test('filters and sort survive a reload, because they live in the URL', async ({ page }) => {
  await open(page);
  await page.locator('#sort').selectOption('title-asc');
  await page.locator('#scope').selectOption('title');
  await page.locator('#query').fill('the');
  await expect(rows(page)).toHaveCount(2);
  await page.reload();
  await expect(page.locator('#sort')).toHaveValue('title-asc');
  await expect(page.locator('#scope')).toHaveValue('title');
  await expect(page.locator('#query')).toHaveValue('the');
  await expect(rows(page)).toHaveCount(2);
});

test('a session mid-tool is watched on its own, and shows its minutes', async ({ page }) => {
  await open(page);
  // The transcript left mid-tool was just written, so it counts as running, and
  // a session that starts working is watched without being asked.
  const running = rows(page).filter({ hasText: 'Chase a flaky test' });
  await expect(running.locator('.watched')).toHaveAttribute('aria-pressed', 'true');
  await expect(running.locator('td.num')).toHaveText(/^\d+m$/);

  // The minutes land in their own cell and nothing else is touched. They used to
  // be written into the transcript cell by the timer that keeps them climbing,
  // which destroyed the button it held; the next redraw then died looking for
  // that button, and a dead redraw freezes every marker below the row.
  await expect(running.locator('.transcript')).toHaveCount(1);
  await expect(running.locator('td.num .marker')).toHaveCount(0);
});

test('marking a session watched shows its minutes, and moves nothing', async ({ page }) => {
  await open(page);
  const titles = () => rows(page).locator('.title .text').allInnerTexts();
  const before = await titles();

  const row = rows(page).filter({ hasText: 'Refactor the importer' });
  await expect(row.locator('td.num')).toHaveText('');
  await row.locator('.watched').click();
  await expect(row.locator('.watched')).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('td.num')).toHaveText(/^\d+m$/);

  // A marker never lifts a row: a position depends on the chosen sort alone.
  expect(await titles()).toEqual(before);
});

test('the keyboard moves the selection without touching the mouse', async ({ page }) => {
  await open(page);
  await page.locator('body').press('j');
  await expect(rows(page).first()).toHaveClass(/selected/);
  await page.locator('body').press('j');
  await expect(rows(page).nth(1)).toHaveClass(/selected/);
  await page.locator('body').press('k');
  await expect(rows(page).first()).toHaveClass(/selected/);
  await page.locator('body').press('/');
  await expect(page.locator('#query')).toBeFocused();
});

test('an empty result says so rather than showing nothing', async ({ page }) => {
  await open(page);
  await page.locator('#query').fill('nothing matches this');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#empty')).toBeVisible();
});

test('every action is a target of its own, reachable by keyboard', async ({ page }) => {
  await open(page);
  const row = rows(page).first();
  // Nothing is bound to the row itself, so a stray click opens nothing. The
  // handover is not exercised here: it would launch VS Code on the machine
  // running the tests. It is covered by the unit tests of `handover`.
  await expect(row).not.toHaveAttribute('onclick');
  // The tooltip carries the whole title, since the column cuts it.
  await expect(row.locator('.title .link')).toHaveAttribute('title', /Open this session/);
  await expect(row.locator('.title .link')).toHaveAttribute(
    'title',
    new RegExp(await row.locator('.title .text').innerText()),
  );
  await expect(row.locator('.transcript')).toHaveAttribute('title', /raw transcript/);
  await expect(row.locator('td.ws .link')).toHaveAttribute('title', /Open /);
});

test('a column header sorts, and reverses when clicked again', async ({ page }) => {
  await open(page);
  const titles = () => rows(page).locator('.title .text').allInnerTexts();
  // Marked rows are grouped first, which would hide a plain reversal.
  await clearMarks(page);

  await page.locator('button.sort[data-key="title"]').click();
  await expect(page.locator('button.sort[data-key="title"]')).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  const ascending = await titles();
  expect(ascending).toEqual([...ascending].sort());

  await page.locator('button.sort[data-key="title"]').click();
  await expect(page.locator('button.sort[data-key="title"]')).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  expect(await titles()).toEqual([...ascending].reverse());

  // The select and the header are the same control, said twice.
  await expect(page.locator('#sort')).toHaveValue('title-desc');
});

test('only one column claims the ordering at a time', async ({ page }) => {
  await open(page);
  await page.locator('button.sort[data-key="title"]').click();
  await page.locator('button.sort[data-key="provider"]').click();
  await expect(page.locator('button.sort[data-key="provider"]')).toHaveAttribute('aria-sort', /.+/);
  await expect(page.locator('button.sort[data-key="title"]')).not.toHaveAttribute('aria-sort', /.+/);
});

test('filters narrow with all, and widen with any', async ({ page }) => {
  await open(page);
  // Nothing is both running and a codex session, so narrowing gives nothing.
  await page.locator('#status-filters button', { hasText: 'running' }).click();
  await page.locator('#provider-filters button', { hasText: 'codex' }).click();
  await expect(rows(page)).toHaveCount(0);

  await page.locator('#match').selectOption('any');
  // Widening gives the running one back; there are no codex sessions here.
  await expect(rows(page)).toHaveCount(1);
});

test('watched sessions come first, then starred, whatever the sort', async ({ page }) => {
  await open(page);
  await clearMarks(page);
  // Sorted by title, "Chase" would come first on its own merits, so it is the
  // one deliberately left unmarked: the grouping has to be what moves the others.
  await page.locator('button.sort[data-key="title"]').click();

  await rows(page).filter({ hasText: 'Rewrite the landing page' }).locator('.favorite').click();
  await rows(page).filter({ hasText: 'Refactor the importer' }).locator('.watched').click();

  // Nothing jumps on its own: the move is offered, and taken here on purpose.
  const reorder = page.locator('#reorder');
  if (await reorder.isVisible()) await reorder.click();

  expect(await rows(page).locator('.title .text').allInnerTexts()).toEqual([
    'Refactor the importer', // watched
    'Rewrite the landing page', // starred
    'Chase a flaky test', // unmarked, despite sorting first by title
  ]);
});

test('refreshing takes the whole list back from the service', async ({ page }) => {
  await open(page);
  await page.locator('#query').fill('importer');
  await expect(rows(page)).toHaveCount(1);

  await page.locator('#refresh').click();
  // The search still holds afterwards: refreshing is not resetting.
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#query')).toHaveValue('importer');

  await page.locator('#reset').click();
  await expect(rows(page)).toHaveCount(3);
  await page.locator('body').press('r');
  await expect(rows(page)).toHaveCount(3);
  expect(problems).toEqual([]);
});

test('refreshing applies a pending reorder, because asking is the asking', async ({ page }) => {
  await open(page);
  await clearMarks(page);
  await page.locator('button.sort[data-key="title"]').click();

  // Marking a row wants to lift it, and the list offers the move rather than
  // taking it.
  await rows(page).filter({ hasText: 'Rewrite the landing page' }).locator('.watched').click();
  await expect(page.locator('#reorder')).toBeVisible();

  await page.locator('#refresh').click();
  await expect(page.locator('#reorder')).toBeHidden();
  await expect(rows(page).first().locator('.title .text')).toHaveText('Rewrite the landing page');
});

test('the notification switch shows its state, and can be turned back on', async ({ page }) => {
  await open(page);
  const notify = page.locator('#notify');
  // The service was started with notifications off, so the tests cannot raise
  // a toast on the machine running them.
  await expect(notify).toHaveAttribute('aria-pressed', 'false');
  await notify.click();
  await expect(notify).toHaveAttribute('aria-pressed', 'true');
  await expect(notify).toHaveAttribute('title', /idle/);
  await notify.click();
  await expect(notify).toHaveAttribute('aria-pressed', 'false');
});

test('the statuses that notify are chosen from the interface, and remembered', async ({ page }) => {
  await open(page);
  await page.locator('#notify').click(); // on, so the controls are live
  const unknown = page.locator('#notify-on button[data-status="unknown"]');
  await expect(unknown).toHaveAttribute('aria-pressed', 'false');

  await unknown.click();
  await expect(unknown).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('#notify-on button[data-status="unknown"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Left as it was found, so the tests stay independent of each other.
  await page.locator('#notify-on button[data-status="unknown"]').click();
  await page.locator('#notify').click();
});

test('the notification scope can follow the acknowledgement marker instead', async ({ page }) => {
  await open(page);
  const scope = page.locator('#notify-scope');
  await expect(scope).toHaveValue('watched');
  // Off by default in the tests, and the scope is meaningless while it is off.
  await expect(scope).toBeDisabled();

  await page.locator('#notify').click();
  await expect(scope).toBeEnabled();
  await scope.selectOption('unacknowledged');
  await page.reload();
  await expect(page.locator('#notify-scope')).toHaveValue('unacknowledged');

  // Left as it was found, so the tests stay independent of each other.
  await page.locator('#notify-scope').selectOption('watched');
  await page.locator('#notify').click();
});

/**
 * Last, because it ends a turn the earlier tests rely on being in progress.
 */
test('a status change arrives on its own, and marks the row unseen', async ({ page }) => {
  await open(page);
  const row = rows(page).filter({ hasText: 'Chase a flaky test' });
  const status = row.locator('.status');
  await expect(status).toHaveAttribute('data-status', 'running');
  await expect(status).toHaveAttribute('data-unseen', 'false');

  const before = await rows(page).locator('.title .text').allInnerTexts();
  await finishRunningSession(service.home);

  // Nothing was clicked and no page was reloaded: the service watched the file,
  // scanned, and pushed the row that moved.
  await expect(status).toHaveAttribute('data-status', 'idle', { timeout: 20000 });
  // The session stopped, so there is something on it you have not seen.
  await expect(status).toHaveAttribute('data-unseen', 'true');
  // And it stayed exactly where it was.
  expect(await rows(page).locator('.title .text').allInnerTexts()).toEqual(before);

  await status.click();
  await expect(status).toHaveAttribute('data-unseen', 'false');
  expect(problems).toEqual([]);
});
