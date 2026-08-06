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

const parse = (colour: string): number[] =>
  (colour.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);

/**
 * CIE76, the measure `npm run contrast` already uses on the status colours.
 * Below about 15 two colours are hard to tell apart at a glance, which is the
 * question contrast cannot answer: two chips can both be perfectly legible and
 * still be the same colour as each other.
 */
function difference(a: string, b: string): number {
  const lab = (colour: string): number[] => {
    const [r, g, b2] = parse(colour).map((value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    let x = (0.4124 * r + 0.3576 * g + 0.1805 * b2) / 0.95047;
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b2;
    let z = (0.0193 * r + 0.1192 * g + 0.9505 * b2) / 1.08883;
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    [x, y, z] = [f(x), f(y), f(z)];
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
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
    // it clears the same 4.5:1 the palette is held to. The bar was 4.4 here,
    // and that tenth of tolerance was hiding a real miss: `readable` judged the
    // fractional colour it was walking rather than the rounded one it returns,
    // and came back with 4.4967:1.
    expect(ratio(accent, background)).toBeGreaterThanOrEqual(4.5);
  }

  await page.evaluate(() => localStorage.removeItem('primary'));
  await page.locator('#theme').click();
  await page.locator('#theme').click();
});

test('the workspace chip stays readable at every hue, in both themes', async ({ page }) => {
  await open(page);

  // Measured here rather than in `npm run contrast`, which reads the stylesheet
  // and does the arithmetic itself. It could not answer this one: the chip's
  // chromas are outside the sRGB gamut for most hues, and the engine maps them
  // back to the most colourful thing it can display. Computing from what is
  // written in the CSS would be measuring a colour that never reaches a screen,
  // so this asks Chromium what it painted.
  const measure = () =>
    page.evaluate(() => {
      // Through a canvas, and not for convenience. `getComputedStyle` hands back
      // `oklch(0.93 0.08 30)` verbatim now — a colour function is no longer
      // serialised as `rgb()` — so reading the numbers out of that string gives
      // the lightness and the chroma where the red and green channels should be.
      // The first run of this test measured 1.17:1 that way and the stylesheet
      // was already correct. Filling a pixel and reading it back is the engine
      // answering in the space the screen works in, gamut mapping included.
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      const srgb = (value: string): string => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      };

      const probe = document.createElement('span');
      probe.className = 'link tag';
      probe.style.cssText = 'position: absolute; visibility: hidden';
      document.body.append(probe);
      const rowProbe = document.createElement('span');
      rowProbe.style.cssText =
        'background: var(--selected); position: absolute; visibility: hidden';
      document.body.append(rowProbe);

      const painted = [];
      for (let hue = 0; hue < 360; hue += 1) {
        probe.style.setProperty('--hue', String(hue));
        const style = getComputedStyle(probe);
        painted.push({
          hue,
          colour: srgb(style.color),
          background: srgb(style.backgroundColor),
          border: srgb(style.borderTopColor),
        });
      }
      const rows = {
        plain: srgb(getComputedStyle(document.body).backgroundColor),
        selected: srgb(getComputedStyle(rowProbe).backgroundColor),
      };
      probe.remove();
      rowProbe.remove();
      return { painted, rows };
    });

  for (const theme of ['light', 'dark']) {
    await page.locator('#theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const { painted, rows } = await measure();

    let worstText = { value: Infinity, hue: -1 };
    let worstEdge = { value: Infinity, hue: -1 };
    for (const { hue, colour, background, border } of painted) {
      const text = ratio(colour, background);
      if (text < worstText.value) worstText = { value: text, hue };
      // Against both the plain and the selected row: a chip that clears the
      // page and dissolves into the row you have selected has stopped being a
      // chip at the moment you are looking at it.
      const edge = Math.min(ratio(border, rows.plain), ratio(border, rows.selected));
      if (edge < worstEdge.value) worstEdge = { value: edge, hue };
    }

    expect(
      worstText.value,
      `${theme}: text on the chip, worst at hue ${worstText.hue}`,
    ).toBeGreaterThanOrEqual(4.5);
    // The bar for a boundary that carries meaning rather than a word.
    expect(
      worstEdge.value,
      `${theme}: chip edge against the row, worst at hue ${worstEdge.hue}`,
    ).toBeGreaterThanOrEqual(3);

    // The other question, and the one legibility never asks: sixteen chips can
    // each be perfectly readable and still be the same colour as each other,
    // which is the whole point of colouring them. Every pair, not just
    // neighbours — and these hues are not evenly spaced, so neighbours in the
    // list are not necessarily the closest in colour.
    const hues = [0, 17, 33, 60, 85, 102, 118, 133, 149, 168, 186, 204, 224, 255, 285, 328];
    let closest = { value: Infinity, pair: '' };
    for (let i = 0; i < hues.length; i += 1) {
      for (let j = i + 1; j < hues.length; j += 1) {
        const value = difference(painted[hues[i]].background, painted[hues[j]].background);
        if (value < closest.value) closest = { value, pair: `${hues[i]}/${hues[j]}` };
      }
    }
    // 12 rather than the 15 the statuses are held to, deliberately. A status is
    // a 13px glyph whose colour is one of only two things saying what it is; a
    // workspace chip is a wide patch of colour with the name written inside it.
    expect(
      closest.value,
      `${theme}: closest pair of workspace colours, hues ${closest.pair}`,
    ).toBeGreaterThanOrEqual(12);
  }

  await page.locator('#theme').click(); // back to auto
  expect(problems).toEqual([]);
});

const columnWidth = async (page: Page, key: string): Promise<number> => {
  const box = await page.locator(`th[data-column="${key}"]`).boundingBox();
  return box!.width;
};

/** Drags a column's handle by `by` pixels, the way a pointer would. */
async function dragColumn(page: Page, key: string, by: number): Promise<void> {
  const handle = page.locator(`th[data-column="${key}"] .resizer`);
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + by, y, { steps: 8 });
  await page.mouse.up();
}

test('a column can be dragged narrower than its own contents', async ({ page }) => {
  await open(page);
  // Long values in both columns, which is the case that was broken: a fixed
  // table still takes its own width from `max-content`, measured from the
  // contents rather than from the widths asked for, and hands the difference
  // back to the columns. Only the columns holding something long had a floor
  // under them, so it looked like a rule about the workspace.
  await page.evaluate(() => {
    for (const link of document.querySelectorAll('td.ws .link')) {
      link.textContent = 'a-workspace-with-a-long-name';
    }
  });

  // The direction that matters. Until the widths are taken over the table sizes
  // itself, and a column cannot be narrower than its widest cell however hard it
  // is dragged — so a resize that only ever widens is the failure to watch for.
  const before = await columnWidth(page, 'title');
  await dragColumn(page, 'title', -120);
  const after = await columnWidth(page, 'title');
  expect(after).toBeLessThan(before - 90);

  // All the way to the floor, and the floor is the only thing stopping it.
  // Asserting "narrower than it was" is what let the bug through: the column
  // did get narrower, just never as narrow as it was told to be.
  for (const key of ['workspace', 'title']) {
    await dragColumn(page, key, -600);
    expect(await columnWidth(page, key), `${key} dragged to its floor`).toBe(24);
  }

  // And the value in the cell is cut rather than spilling into what is beside
  // it — there is no column to the right of the title, but the row must not
  // reach past the table either.
  const table = (await page.locator('#sessions').boundingBox())!;
  const cell = (await page.locator('tbody tr').first().locator('td.title').boundingBox())!;
  expect(cell.x + cell.width).toBeLessThanOrEqual(table.x + table.width + 1);
  expect(problems).toEqual([]);
});

test('a width the reader chose survives a reload, and a fresh one does not', async ({ page }) => {
  await open(page);
  await dragColumn(page, 'provider', 60);
  const chosen = await columnWidth(page, 'provider');

  await page.reload();
  await expect(page.locator('tbody tr')).not.toHaveCount(0);
  expect(Math.abs((await columnWidth(page, 'provider')) - chosen)).toBeLessThan(2);

  // Nothing is stored until a column is actually dragged: a reader who never
  // touches the handles keeps the table that sizes itself.
  await page.evaluate(() => localStorage.removeItem('columns'));
  await page.reload();
  await expect(page.locator('tbody tr')).not.toHaveCount(0);
  await expect(page.locator('#sessions')).not.toHaveAttribute('data-sized', /.*/);
});

test('the handles answer the keyboard, and fit to the contents on Home', async ({ page }) => {
  await open(page);
  const handle = page.locator('th[data-column="provider"] .resizer');
  await handle.focus();
  const before = await columnWidth(page, 'provider');

  // Eight pixels a press, thirty-two with Shift: a column is not usefully
  // resized one pixel at a time, and neither is it in leaps.
  await handle.press('ArrowRight');
  expect(await columnWidth(page, 'provider')).toBeCloseTo(before + 8, 0);
  await handle.press('Shift+ArrowRight');
  expect(await columnWidth(page, 'provider')).toBeCloseTo(before + 40, 0);
  await handle.press('ArrowLeft');
  expect(await columnWidth(page, 'provider')).toBeCloseTo(before + 32, 0);

  // Home gives the column back to its contents, which is what the double-click
  // does — measured against the width the table had chosen for itself.
  await handle.press('Home');
  expect(Math.abs((await columnWidth(page, 'provider')) - before)).toBeLessThan(2);

  // The separator says what it is and what it is worth, since none of the above
  // is reachable by anyone who cannot be told the width they are changing.
  await expect(handle).toHaveAttribute('role', 'separator');
  await expect(handle).toHaveAttribute('aria-label', /provider/);
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});

const hueOf = (page: Page, selector: string) =>
  rows(page).first().locator(selector).evaluate((node) => node.style.getPropertyValue('--hue'));

test('the provider is a coloured chip, like the workspace', async ({ page }) => {
  await open(page);
  const badge = rows(page).first().locator('.badge');
  // Painted, not merely classed. A chip whose rule loses on source order still
  // has the class and no colour at all, which is how the workspace chip shipped
  // broken once and measured 1.17:1.
  const painted = await badge.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(painted).not.toBe('rgba(0, 0, 0, 0)');
  expect(await hueOf(page, '.badge')).not.toBe('');
});

test('any colour at all can be chosen by hand, and stays chosen', async ({ page }) => {
  await open(page);
  const automatic = await hueOf(page, '.badge');
  const badge = rows(page).first().locator('.badge');
  const painted = () =>
    badge.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, colour: style.color };
    });

  const brush = rows(page).first().locator('td.provider .brush');
  await expect(brush).toHaveAttribute('aria-label', /claude|codex/);
  await brush.click();
  await expect(page.locator('#palette')).toBeVisible();

  // Not one of a list. The picker offers what the frame colour offers, so the
  // test picks a colour that is deliberately not in the palette at all.
  await page.locator('#palette-colour').fill('#fa1f19');
  const seen = await painted();
  expect(seen.background).toBe('rgb(250, 31, 25)');
  // Dark on this red, not light: it sits at relative luminance 0.213, where
  // black gives 5.26:1 and white only 3.99:1. A saturated colour is not
  // necessarily a dark one, which is the assumption the ink exists to replace.
  // Dark, but not flat black — it carries a trace of the chip's own hue, which
  // is what makes it look like the same rule the assigned chips follow.
  expect(ratio(seen.colour, seen.background)).toBeGreaterThanOrEqual(4.5);
  expect(seen.colour).not.toBe('rgb(0, 0, 0)');
  expect(parse(seen.colour)[0]).toBeGreaterThan(parse(seen.colour)[2]);
  await page.locator('#palette').getByText('Close').click();

  await page.reload();
  await expect(rows(page)).not.toHaveCount(0);
  expect((await painted()).background).toBe('rgb(250, 31, 25)');

  // And handing it back returns it to whatever the assignment would have said.
  await rows(page).first().locator('td.provider .brush').click();
  await page.locator('#palette-auto').click();
  await page.locator('#palette').getByText('Close').click();
  expect(await hueOf(page, '.badge')).toBe(automatic);
  expect(problems).toEqual([]);
});

test('the picker opens on the colour the chip is already wearing', async ({ page }) => {
  await open(page);
  await rows(page).first().locator('td.ws .brush').click();
  await expect(page.locator('#palette')).toBeVisible();

  const same = await page.evaluate(() => {
    // Both sides through a painted pixel: the chip's computed background is an
    // `oklch(...)` string and the input holds a hex, so comparing the text of
    // them compares two spellings rather than two colours. Reading the numbers
    // out of the oklch is what put `#005400` in the picker for a pink chip.
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const srgb = (value: string): string => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).join(',');
    };
    const chip = document.querySelector('tbody tr td.ws .link')!;
    const input = document.querySelector('#palette-colour') as HTMLInputElement;
    return {
      chip: srgb(getComputedStyle(chip).backgroundColor),
      picker: srgb(input.value),
    };
  });
  expect(same.picker).toBe(same.chip);
  await page.locator('#palette').getByText('Close').click();
});

test('what is written on a chosen colour stays readable on it', async ({ page }) => {
  await open(page);
  const badge = rows(page).first().locator('.badge');
  await rows(page).first().locator('td.provider .brush').click();

  // Across the range, including the mid greys where black and white are closest
  // to each other — that band is the whole reason the ink is one or the other.
  for (const colour of ['#ffffff', '#000000', '#808080', '#6b6b6b', '#fa1f19', '#00ff00']) {
    await page.locator('#palette-colour').fill(colour);
    const seen = await badge.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, colour: style.color };
    });
    expect(ratio(seen.colour, seen.background), `text on ${colour}`).toBeGreaterThanOrEqual(4.5);
  }
  await page.locator('#palette-auto').click();
  await page.locator('#palette').getByText('Close').click();
});

test('the text colour is picked as freely as the background, and can be contrasted back', async ({
  page,
}) => {
  await open(page);
  const badge = rows(page).first().locator('.badge');
  const ink = () => badge.evaluate((node) => getComputedStyle(node).color);
  await rows(page).first().locator('td.provider .brush').click();

  await page.locator('#palette-colour').fill('#fa1f19');
  // The measured answer is what a chip starts with, and it is a tint rather
  // than a flat extreme — the same kind of ink an assigned chip is written in.
  const started = await ink();
  expect(started).not.toBe('rgb(0, 0, 0)');
  expect(ratio(started, 'rgb(250, 31, 25)')).toBeGreaterThanOrEqual(4.5);

  // Any colour at all, including one nobody should choose — the picker does not
  // second-guess, and the button below is how it is taken back.
  await page.locator('#palette-ink').fill('#e01a14');
  expect(await ink()).toBe('rgb(224, 26, 20)');
  // And the background it was chosen against is still there, not reset by it.
  expect(await badge.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    'rgb(250, 31, 25)',
  );

  await page.reload();
  await expect(rows(page)).not.toHaveCount(0);
  expect(await ink()).toBe('rgb(224, 26, 20)');

  // And the button gives back exactly what the chip started with, which is the
  // whole of what it is for: the same answer, not a flatter one.
  await rows(page).first().locator('td.provider .brush').click();
  await page.locator('#palette-contrast').click();
  expect(await ink()).toBe(started);
  await page.locator('#palette-auto').click();
  await page.locator('#palette').getByText('Close').click();
  expect(problems).toEqual([]);
});

test('an assigned chip is written in something well clear of its own colour', async ({ page }) => {
  await open(page);
  // The complaint this answers was not a contrast failure — the pair measured
  // 5.84:1 in the dark theme — but a perceptual one: the text carried the chip's
  // own hue at full strength and read as one colour with it. The bar is above
  // 4.5 for that reason, and 6 rather than the 7 it briefly was: the first
  // correction went past the problem into plain black and white, and the bar
  // moved with it. What this has to catch is a slide back towards 5.84, not the
  // colour in the word.
  for (const theme of ['light', 'dark']) {
    await page.locator('#theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const seen = await rows(page)
      .first()
      .locator('td.ws .link')
      .evaluate((node) => {
        // Through a painted pixel, because an assigned chip's computed colours
        // are `oklch(...)` strings and reading the numbers out of one takes the
        // lightness where red belongs.
        const context = document.createElement('canvas').getContext('2d')!;
        const srgb = (value: string): string => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
          return `rgb(${r}, ${g}, ${b})`;
        };
        const style = getComputedStyle(node);
        return { colour: srgb(style.color), background: srgb(style.backgroundColor) };
      });
    expect(ratio(seen.colour, seen.background), `${theme}: assigned chip`).toBeGreaterThanOrEqual(6);
  }
  await page.locator('#theme').click(); // back to auto
});

test('a colour can be typed as hex without opening the native panel', async ({ page }) => {
  await open(page);
  const badge = rows(page).first().locator('.badge');
  const painted = () =>
    badge.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, colour: style.color };
    });
  await rows(page).first().locator('td.provider .brush').click();

  // The hex comes first because the panel behind the swatch opens on whichever
  // of hex, rgb and hsl the browser last remembered, and that selector is its
  // own chrome — the page cannot order it. Typing here needs it not at all.
  await page.locator('#palette-colour-hex').fill('#204060');
  expect((await painted()).background).toBe('rgb(32, 64, 96)');
  // And the two stay one thing: the swatch follows the field.
  expect(await page.locator('#palette-colour').inputValue()).toBe('#204060');

  // The text half, typed the same way and without its hash.
  await page.locator('#palette-ink-hex').fill('ffd700');
  expect((await painted()).colour).toBe('rgb(255, 215, 0)');
  expect((await painted()).background).toBe('rgb(32, 64, 96)');

  // Half a value paints nothing, rather than flashing through a colour nobody
  // asked for on the way to the one they did.
  await page.locator('#palette-ink-hex').fill('#ff');
  expect((await painted()).colour).toBe('rgb(255, 215, 0)');
  // And committing it puts the field back to what is actually painted.
  await page.locator('#palette-ink-hex').blur();
  expect(await page.locator('#palette-ink-hex').inputValue()).toBe('#ffd700');

  await page.locator('#palette-auto').click();
  await page.locator('#palette').getByText('Close').click();
  expect(problems).toEqual([]);
});

test('clicking into a hex field takes the whole value, hash and all', async ({ page }) => {
  await open(page);
  await rows(page).first().locator('td.provider .brush').click();
  const field = page.locator('#palette-colour-hex');
  const selection = () =>
    field.evaluate((node: HTMLInputElement) => ({
      from: node.selectionStart,
      to: node.selectionEnd,
      length: node.value.length,
      taken: node.value.slice(node.selectionStart ?? 0, node.selectionEnd ?? 0),
    }));

  // The value is replaced far more often than it is edited, and the hash is part
  // of what gets replaced.
  await field.click();
  const first = await selection();
  expect(first.from).toBe(0);
  expect(first.to).toBe(first.length);
  expect(first.taken.startsWith('#')).toBe(true);

  // Typing over it therefore replaces rather than appends — the check that the
  // selection is real and not just reported.
  await page.keyboard.type('#123456');
  expect(await field.inputValue()).toBe('#123456');

  // And a second click puts a caret where it was aimed, or the field could
  // never be edited at all.
  await field.click({ position: { x: 30, y: 8 } });
  const second = await selection();
  expect(second.from).toBe(second.to);
  expect(problems).toEqual([]);
});

test('the provider chip is drawn at the size of the workspace chip', async ({ page }) => {
  await open(page);
  const row = rows(page).first();
  const sizes = await row.evaluate((node) => {
    const read = (selector: string) => {
      const style = getComputedStyle(node.querySelector(selector)!);
      return `${style.fontSize} ${style.paddingLeft} ${style.paddingRight}`;
    };
    return { provider: read('.badge'), workspace: read('td.ws .link') };
  });
  // Two chips of two sizes in neighbouring columns read as a difference in
  // importance between a provider and a workspace, and there is not one.
  expect(sizes.provider).toBe(sizes.workspace);
});

test('the workspace column starts at a readable width, not at its floor', async ({ page }) => {
  await open(page);
  // Any drag hands every column its width at once. The workspace takes a stated
  // default rather than a measurement, because measuring it measures whichever
  // project happens to have the longest name today.
  await dragColumn(page, 'title', -10);
  expect(await columnWidth(page, 'workspace')).toBe(80);

  // A set written before the widths were drawn correctly is thrown away rather
  // than applied for the first time by the fix that made them work.
  await page.evaluate(() => localStorage.setItem('columns', '{"workspace":24,"title":300}'));
  await page.reload();
  await expect(rows(page)).not.toHaveCount(0);
  await expect(page.locator('#sessions')).not.toHaveAttribute('data-sized', /.*/);
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
  // The label, not the whole button: a status chip carries its shape too, and
  // `textContent` on the button would be "●en cours".
  await expect(page.locator('#status-filters .chip-label').first()).toHaveText('en cours');
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

test('the minutes column claims the ordering, and opens on the longest wait', async ({ page }) => {
  await open(page);
  const header = page.locator('th[data-column="minutes"] button.sort');
  const column = page.locator('th[data-column="minutes"]');

  // Descending on the first click: the useful question about that column is
  // which session has been sitting in its status the longest.
  await header.click();
  await expect(column).toHaveAttribute('aria-sort', 'descending');
  await expect(page.locator('#sort')).toHaveValue('minutes-desc');
  await header.click();
  await expect(column).toHaveAttribute('aria-sort', 'ascending');

  // Only one column claims it at a time, like every other.
  await page.locator('th[data-column="title"] button.sort').click();
  await expect(column).not.toHaveAttribute('aria-sort', /.*/);

  // What this deliberately does not check is the resulting order of the rows.
  // `statusChangedAt` is measured from when the service first saw a session,
  // not from anything in the transcript, so every session in this fixture
  // shares one — a column of identical values would pass on any order at all.
  // The direction is pinned down in the unit tests, on `byStatusAge`, where
  // two ages can actually differ.
  expect(problems).toEqual([]);
});

test('the wait before notifying is a setting, and the service takes it', async ({ page }) => {
  await open(page);
  await page.locator('#open-settings').click();
  const field = page.locator('#set-notify-delay');
  await expect(field).toBeVisible();

  await field.fill('19');
  await page.locator('#save-settings').click();
  await expect(page.locator('#settings-note')).not.toHaveText('');

  // Read back from the service rather than from the field that was just typed
  // into: this setting travels by a different route from the rest of the dialog
  // — the queue takes it without a restart — and the failure worth catching is
  // it never leaving the page.
  const stored = await page.evaluate(async () => {
    const response = await fetch(`/api/settings?token=${new URLSearchParams(location.search).get('token')}`);
    return (await response.json()).notifications.delaySeconds;
  });
  expect(stored).toBe(19);

  await page.keyboard.press('Escape');
  await page.reload();
  await expect(rows(page)).not.toHaveCount(0);
  await page.locator('#open-settings').click();
  await expect(page.locator('#set-notify-delay')).toHaveValue('19');

  // Back to the default, since the service outlives this test.
  await page.locator('#set-notify-delay').fill('5');
  await page.locator('#save-settings').click();
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
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

test('the toolbars wrap instead of pushing the page sideways', async ({ page }) => {
  await open(page);

  // The frame is a fixed overlay: it cannot follow a document that scrolls
  // sideways, so the document must never do it. The first toolbar carries
  // eleven controls and used to have no wrap at all.
  for (const width of [1280, 1024, 800, 640, 480]) {
    await page.setViewportSize({ width, height: 820 });
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scroll,
      `the document scrolls sideways at ${width}px`,
    ).toBeLessThanOrEqual(overflow.client);
  }

  // The table is the one thing allowed to be wider than the window, and it
  // scrolls inside its own box rather than moving the page.
  await expect(page.locator('.scroller')).toHaveCSS('overflow-x', 'auto');

  await page.setViewportSize({ width: 1280, height: 820 });
  expect(problems).toEqual([]);
});

test('refresh sits beside acknowledge, on the bar that carries the counter', async ({ page }) => {
  await open(page);
  const bar = page.locator('header .bar').last();

  // Both act on the list as it stands, so they are together rather than three
  // toolbars apart — and refresh is no longer among the settings, where it was
  // the only control that touched the rows instead of how they behave.
  await expect(bar.locator('#counts')).toBeVisible();
  await expect(bar.locator('#ack-visible')).toBeVisible();
  await expect(bar.locator('#refresh')).toBeVisible();

  const order = await bar.locator('button').evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(order.indexOf('ack-visible')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('refresh')).toBeGreaterThan(order.indexOf('ack-visible'));

  // Moving it changed nothing about what it does, keyboard included.
  await page.locator('body').press('r');
  await expect(rows(page)).toHaveCount(3);
  expect(problems).toEqual([]);
});

test('a status filter shows the shape it filters on', async ({ page }) => {
  await open(page);

  // Four silhouettes, one drawing set. They were characters from four different
  // type families until the three candidates were rendered side by side and
  // looked at.
  for (const [status, icon] of [
    ['running', '#icon-status-running'],
    ['unknown', '#icon-status-unknown'],
    ['failed', '#icon-status-failed'],
    ['idle', '#icon-status-idle'],
  ]) {
    const chip = page.locator(`#status-filters .chip[data-value="${status}"]`);
    await expect(chip.locator('.chip-glyph use')).toHaveAttribute('href', icon);
    // The word is beside it, so the shape is decoration for the eye and noise
    // for anything reading the page aloud.
    await expect(chip.locator('.chip-glyph')).toHaveAttribute('aria-hidden', 'true');

    // The same shape in the row, when a row of that status is on screen. The
    // fixtures only ever produce `running` and `idle` — asserting all four here
    // is what the first version of this test did, and it failed for a reason
    // that had nothing to do with the chips.
    const row = page.locator(`tbody .status[data-status="${status}"]`).first();
    if (await row.count()) {
      await expect(row.locator('use')).toHaveAttribute('href', icon);
    }
  }

  // Left to right in the order the service ranks them, so the chips and the
  // "most urgent first" sort cannot disagree.
  expect(
    await page.locator('#status-filters .chip').evaluateAll((n) => n.map((c) => c.dataset.value)),
  ).toEqual(['running', 'unknown', 'failed', 'idle']);

  // The statuses that raise a notification are the same four, and say so.
  await expect(page.locator('#notify-on .chip[data-status="failed"] .chip-glyph use')).toHaveAttribute(
    'href',
    '#icon-status-failed',
  );
  // Providers are names, not states: no shape to show.
  await expect(page.locator('#provider-filters .chip-glyph')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('the marker columns are headed by their mark, and sort by it', async ({ page }) => {
  await open(page);

  for (const [key, icon] of [
    ['watched', '#icon-eye'],
    ['starred', '#icon-star'],
  ]) {
    const header = page.locator(`th:has(button.sort[data-key="${key}"])`);
    await expect(header.locator('use')).toHaveAttribute('href', icon);
    // The word survives for anything reading the page aloud.
    await expect(header.locator('.sr-only')).toHaveText(/\w/);
    // And the column is no wider than the mark it holds.
    expect((await header.boundingBox())?.width ?? 0).toBeLessThan(60);
  }

  // Nothing is marked or unmarked here. Marks are shared state that outlives a
  // page, and a previous version of this test cleared them — which cost the
  // auto-watch test its subject three tests later, because a session is watched
  // on the *transition* into running and that had already happened.
  //
  // The fixtures give one watched session and two unwatched ones, which is all
  // this needs.
  const reorder = page.locator('#reorder');
  await page.locator('button.sort[data-key="watched"]').click();
  if (await reorder.isVisible()) await reorder.click();
  await expect(rows(page).first().locator('.watched')).toHaveAttribute('aria-pressed', 'true');

  // Clicking again reverses it — which the automatic grouping alone could never
  // do, since it always lifts what you follow.
  await page.locator('button.sort[data-key="watched"]').click();
  if (await reorder.isVisible()) await reorder.click();
  await expect(rows(page).first().locator('.watched')).toHaveAttribute('aria-pressed', 'false');

  await expect(page.locator('#sort')).toHaveValue('watched-asc');
  expect(problems).toEqual([]);
});

test('reset turns back and refresh turns forward', async ({ page }) => {
  await open(page);
  await expect(page.locator('#reset use')).toHaveAttribute('href', '#icon-reset');
  await expect(page.locator('#refresh use')).toHaveAttribute('href', '#icon-refresh');
  // The words are still there, and still follow the language.
  await expect(page.locator('#reset .chip-label')).toHaveText(/\w/);
});

test('the starred marker is drawn from the sprite, in two weights', async ({ page }) => {
  await open(page);

  // The sprite is inlined into the document like the stylesheet, because a
  // browser does not carry the token across to a relative asset.
  await expect(page.locator('#icon-star')).toHaveCount(1);
  await expect(page.locator('#icon-star-fill')).toHaveCount(1);

  const row = rows(page).first();
  const marker = row.locator('.favorite');
  await expect(marker.locator('svg use')).toHaveAttribute('href', '#icon-star');

  await marker.click();
  await expect(marker).toHaveAttribute('aria-pressed', 'true');
  // The same drawing at a heavier weight, which is what on/off means here.
  await expect(marker.locator('svg use')).toHaveAttribute('href', '#icon-star-fill');
  // One element reused rather than replaced, so nothing under the cursor moves.
  await expect(marker.locator('svg')).toHaveCount(1);

  // It takes its colour from the marker state, as the typed glyphs beside it do.
  const painted = await marker.locator('svg').evaluate((node) => getComputedStyle(node).color);
  expect(painted).toMatch(/^rgb/);

  await marker.click();
  await expect(marker.locator('svg use')).toHaveAttribute('href', '#icon-star');
  expect(problems).toEqual([]);
});

test('the watched marker is an eye, and the filter that narrows to it wears one', async ({
  page,
}) => {
  await open(page);

  // `○`/`◉` were a ring and a dot — a radio button, which is what they looked
  // like and not what they meant.
  const marker = rows(page).first().locator('.watched');
  const before = await marker.getAttribute('aria-pressed');
  await expect(marker.locator('svg use')).toHaveAttribute(
    'href',
    before === 'true' ? '#icon-eye-fill' : '#icon-eye',
  );

  await marker.click();
  await expect(marker.locator('svg use')).toHaveAttribute(
    'href',
    before === 'true' ? '#icon-eye' : '#icon-eye-fill',
  );
  await marker.click();

  // A filter that narrows to a marker should look like the marker it narrows to.
  await expect(page.locator('#watched-only svg use')).toHaveAttribute('href', '#icon-eye');
  await expect(page.locator('#favorites-only svg use')).toHaveAttribute('href', '#icon-star');
  // And the word beside it still follows the language, which is the reason it
  // lives in a span the icon is not inside.
  await expect(page.locator('#watched-only .chip-label')).toHaveText(/\w/);
  expect(problems).toEqual([]);
});

test('the notification switch says off by being struck through, not by being paler', async ({
  page,
}) => {
  await open(page);
  const notify = page.locator('#notify');

  // The service under test starts with notifications off.
  await expect(notify).toHaveAttribute('aria-pressed', 'false');
  await expect(notify.locator('svg use')).toHaveAttribute('href', '#icon-bell-slash');

  await notify.click();
  await expect(notify).toHaveAttribute('aria-pressed', 'true');
  await expect(notify.locator('svg use')).toHaveAttribute('href', '#icon-bell');

  await notify.click();
  await expect(notify.locator('svg use')).toHaveAttribute('href', '#icon-bell-slash');
  expect(problems).toEqual([]);
});

test('the status column is as wide as its shapes, not as its name', async ({ page }) => {
  await open(page);

  const header = page.locator('th:has(button.sort[data-key="status"])');
  // The word is still there for anything reading the page aloud, and for the
  // accessible name of a column that can be sorted.
  await expect(header.locator('.sr-only')).toHaveText(/\w/);
  await expect(header.locator('svg use')).toHaveAttribute('href', '#icon-circles-three');

  // 93px for a 21px glyph before this; the shapes set the width now. The bound
  // is generous — this guards against the word coming back, not a pixel.
  const width = (await header.boundingBox())?.width ?? 0;
  expect(width).toBeLessThan(60);

  // Still a sort control, and still says which way.
  await page.locator('button.sort[data-key="status"]').click();
  await expect(header).toHaveAttribute('aria-sort', /ascending|descending/);
});

test('settings stay reachable on a service with no menu of its own', async ({ page }) => {
  await open(page);

  // This suite drives `asm serve`, which is read in a browser: there is no File
  // menu, so the button is the only door and must not be hidden.
  await expect(page.locator('#open-settings')).toBeVisible();

  // And the shortcut the desktop menu advertises works here too, which is what
  // lets the application hide its button without losing the room behind it.
  await page.locator('body').press('Control+,');
  await expect(page.locator('#settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toBeHidden();
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

/** The column header cell, which is the only element `aria-sort` is valid on. */
const header = (page: Page, key: string) => page.locator(`th:has(button.sort[data-key="${key}"])`);

test('a column header sorts, and reverses when clicked again', async ({ page }) => {
  await open(page);
  const titles = () => rows(page).locator('.title .text').allInnerTexts();
  // Marked rows are grouped first, which would hide a plain reversal.
  await clearMarks(page);

  await page.locator('button.sort[data-key="title"]').click();
  // On the `th`: `aria-sort` is only supported on a `columnheader`, so on the
  // button it was there to be read by nothing.
  await expect(header(page, 'title')).toHaveAttribute('aria-sort', 'ascending');
  const ascending = await titles();
  expect(ascending).toEqual([...ascending].sort());

  await page.locator('button.sort[data-key="title"]').click();
  await expect(header(page, 'title')).toHaveAttribute('aria-sort', 'descending');
  expect(await titles()).toEqual([...ascending].reverse());

  // The select and the header are the same control, said twice.
  await expect(page.locator('#sort')).toHaveValue('title-desc');
});

test('only one column claims the ordering at a time', async ({ page }) => {
  await open(page);
  await page.locator('button.sort[data-key="title"]').click();
  await page.locator('button.sort[data-key="provider"]').click();
  await expect(header(page, 'provider')).toHaveAttribute('aria-sort', /.+/);
  await expect(header(page, 'title')).not.toHaveAttribute('aria-sort', /.+/);
});

test('the list announces what changed, without announcing every scan', async ({ page }) => {
  await open(page);
  // The regions a screen reader is meant to hear.
  await expect(page.locator('#notices')).toHaveAttribute('role', 'status');
  await expect(page.locator('#empty')).toHaveAttribute('role', 'status');
  await expect(page.locator('#announcer')).toHaveAttribute('role', 'status');
  await expect(page.locator('.live[role="status"]')).toContainText(/visible/);

  // And the one that is deliberately not a region: it restates the last scan
  // time on a timer, and a region that speaks on a timer gets switched off.
  await expect(page.locator('#service-state')).not.toHaveAttribute('role', 'status');

  // The table and the landmark say what they hold.
  await expect(page.locator('table#sessions caption')).toHaveText(/sessions/i);
  await expect(page.locator('main')).toHaveAttribute('aria-label', /.+/);
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

  // This tooltip was written in English in place, and this assertion is what
  // kept that from being noticed: it passed precisely because the wording never
  // followed the language. It has to change with it now.
  await page.locator('#open-settings').click();
  await page.locator('#set-language').selectOption('fr');
  await page.keyboard.press('Escape');
  await expect(notify).toHaveAttribute('title', /Notifie sur/);
  await expect(notify).toHaveAttribute('title', /en attente/);

  await page.locator('#open-settings').click();
  await page.locator('#set-language').selectOption('auto');
  await page.keyboard.press('Escape');
  await expect(notify).toHaveAttribute('title', /Notifying on/);

  await notify.click();
  await expect(notify).toHaveAttribute('aria-pressed', 'false');
  await expect(notify).toHaveAttribute('title', /off/);
  await page.evaluate(() => localStorage.removeItem('language'));
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
