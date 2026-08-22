import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * The interface, served as one document.
 *
 * The page is opened with the token in its URL, and a browser does not carry a
 * query string over to a relative `app.css`. Rather than exempt the stylesheet
 * and the script from the token — the one rule that must hold for every route —
 * they are written as separate files and inlined here. Authoring stays split;
 * the surface stays a single protected route.
 *
 * No path ever comes from the request, so traversal is not defended against: it
 * is impossible.
 */

const STYLES = '<!--{{styles}}-->';
const I18N = '<!--{{i18n}}-->';
const SCRIPT = '<!--{{script}}-->';
/**
 * The icon sprite, built at compile time by `scripts/make-sprite.mjs` out of the
 * handful of Phosphor icons the page references. Inlined for the same reason as
 * everything else here: a browser does not carry the token across to a relative
 * asset, and a sprite fetched on its own route would be the one thing exempt
 * from it.
 */
const ICONS = '<!--{{icons}}-->';
/**
 * Where what the page owns goes back into the page.
 *
 * Written into the document rather than fetched, because the theme and the
 * accent decide the first paint: a request for them, however quick, is a flash
 * of the wrong colours on every open. That immediacy is what `localStorage` was
 * being used for, and inlining keeps it while the values live in the
 * preferences file — see {@link ViewPreferences} for why they had to leave.
 */
const VIEW = '<!--{{view}}-->';

/**
 * `lib.js` and `app.js` go into the *same* module script, in that order.
 *
 * Not two scripts and not an import: a browser does not carry the token in the
 * query string over to a relative `./lib.js`, so importing would mean exempting
 * one file from the rule that every route needs the token. Concatenated, the
 * two share one module scope and `lib.js`'s `export` keywords are simply inert —
 * an inline module has no importer. They exist for Vitest, which imports the
 * file directly and never sees this page at all.
 */
function moduleScript(lib: string, app: string): string {
  return `<script type="module">\n${lib}\n${app}\n</script>`;
}

/**
 * The stored view, as a global the page can read before it paints anything.
 *
 * `<` is escaped because a value the page wrote is being put back inside a
 * script element: a workspace named `</script>` would otherwise end the element
 * early and the rest of the document would be read as markup. Nothing here is
 * hostile — it is all the reader's own — but a name is not a place to find out.
 */
function viewScript(view: Readonly<Record<string, string>>): string {
  const json = JSON.stringify(view).replace(/</g, '\\u003c');
  return `<script>window.__view = ${json};</script>`;
}

export class AssetReader {
  private template?: string;

  /** `dist/web`, beside the compiled service. */
  constructor(private readonly directory = path.join(__dirname, '..', 'web')) {}

  /**
   * The files cannot change while the service runs and the view can, so one is
   * cached and the other substituted on every request. Serving a cached page
   * would have handed the reader whatever the view was when the window opened.
   */
  async read(view: Readonly<Record<string, string>> = {}): Promise<string> {
    return (await this.load()).replace(VIEW, viewScript(view));
  }

  private async load(): Promise<string> {
    if (this.template !== undefined) {
      return this.template;
    }
    const file = (name: string): Promise<string> =>
      fs.readFile(path.join(this.directory, name), 'utf8');
    const [html, css, i18n, lib, js, icons] = await Promise.all([
      file('index.html'),
      file('app.css'),
      file('i18n.js'),
      file('lib.js'),
      file('app.js'),
      file('icons.svg'),
    ]);
    // The dictionary goes in as a classic script so the module can read it as a
    // global: there is one document and no route to import a second file from.
    this.template = html
      .replace(STYLES, `<style>\n${css}\n</style>`)
      .replace(I18N, `<script>\n${i18n}\n</script>`)
      .replace(ICONS, icons)
      .replace(SCRIPT, moduleScript(lib, js));
    return this.template;
  }
}
