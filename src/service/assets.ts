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

export class AssetReader {
  private page?: string;

  /** `dist/web`, beside the compiled service. */
  constructor(private readonly directory = path.join(__dirname, '..', 'web')) {}

  async read(): Promise<string> {
    if (this.page !== undefined) {
      return this.page;
    }
    const file = (name: string): Promise<string> =>
      fs.readFile(path.join(this.directory, name), 'utf8');
    const [html, css, i18n, js] = await Promise.all([
      file('index.html'),
      file('app.css'),
      file('i18n.js'),
      file('app.js'),
    ]);
    // The files cannot change while the service runs, so one read is enough.
    // The dictionary goes in as a classic script so the module can read it as a
    // global: there is one document and no route to import a second file from.
    this.page = html
      .replace(STYLES, `<style>\n${css}\n</style>`)
      .replace(I18N, `<script>\n${i18n}\n</script>`)
      .replace(SCRIPT, `<script type="module">\n${js}\n</script>`);
    return this.page;
  }
}
