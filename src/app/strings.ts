/**
 * What the application itself says: menus, dialogs, the tray, toast buttons.
 *
 * Its own table rather than the page's, and not for want of trying to share
 * one. The two have no string in common — the page names columns and filters,
 * this names *Uninstall…* and *Nothing was installed* — so a shared table would
 * ship each side the other's vocabulary for nothing. `src/web/i18n.js` is also a
 * classic script served into the page, and this project compiles with `allowJs`
 * off, so it is not importable here in any case. What is duplicated is the
 * twenty lines of mechanism below, and that is the whole of it.
 *
 * No import from `electron`, so the strings can be asked about in a unit test
 * without a window. The locale is passed in.
 */

export type Language = 'en' | 'fr';

export const LANGUAGES: readonly Language[] = ['en', 'fr'];

/**
 * The language to speak, from what was chosen and what the machine is set to.
 *
 * `auto` follows the system, matched on the leading subtag so `fr-CA` and
 * `fr-FR` both count as French. Anything else falls to English, which is what
 * every string here was written in.
 */
export function appLanguage(stored: string | undefined, locale: string): Language {
  if (stored === 'en' || stored === 'fr') {
    return stored;
  }
  return locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

type Strings = Record<string, string>;

const EN: Strings = {
  'menu.file': 'File',
  'menu.settings': 'Settings…',
  'menu.quit': 'Quit',
  'menu.help.about': 'About {app}',
  'menu.help.updates': 'Check for updates…',
  'menu.help.uninstall': 'Uninstall…',

  'tray.show': 'Show the list',
  'tray.login': 'Start with Windows',
  'tray.quit': 'Quit',
  'tray.unseen': '{app} — {count} sessions you have not seen',
  'tray.unseenOne': '{app} — 1 session you have not seen',

  'toast.markSeen': 'Mark as seen',
  'toast.open': 'Open the session',

  'update.skip': 'Skip this version',
  'update.later': 'Not now',
  'update.install': 'Download and install',

  'start.failedTitle': '{app} could not start',
  'start.failedMessage': 'The service behind the window did not come up, so there is nothing to show.',

  'update.errorTitle': 'Could not check for updates',
  'update.errorMessage': 'GitHub could not be reached.',

  'update.noneTitle': 'No release published',
  'update.noneMessage': 'There is nothing to update to yet.',
  'update.noneDetail':
    'No published release was found. A private repository answers the same way as one with no ' +
    'releases, so this says nothing about which it is.',

  'update.currentTitle': 'Up to date',
  'update.currentMessage': '{app} {version} is the latest version.',

  'update.noInstallerTitle': 'Nothing to install',
  'update.noInstallerMessage': 'Version {version} is published, and carries no Windows installer.',
  'update.noInstallerDetail':
    'You are on {current}. There is nothing here to install from yet.',

  'update.unverifiableTitle': 'Update available, but not verifiable',
  'update.unverifiableMessage': 'Version {version} is published, and cannot be installed from here.',
  'update.unverifiableDetail':
    'The release carries no checksum manifest, so there is nothing to check the download against. ' +
    'Without a code-signing certificate that manifest is the whole of what can be verified, and ' +
    'running an installer whose only credential is that it arrived over TLS is not something this ' +
    'will do quietly.\n\nInstall it by hand from the releases page if you want it.',

  'update.availableTitle': 'Update available',
  'update.availableMessage': 'Version {version} is available. You have {current}.',
  'update.availableDetail':
    'The installer is downloaded, checked against the length and the sha512 published with the ' +
    'release, then run — and nothing is run that fails either check. {app} closes while it works ' +
    'and comes back on the new version.\n\nIt is not code-signed, so Windows may warn about it — ' +
    'the only thing vouching for it is that it came from GitHub over TLS.',

  'update.failedTitle': 'Update failed',
  'update.failedMessage': 'Nothing was installed.',
  'update.failedDetail':
    '{error}\n\nYou are still on {current} and nothing was replaced. Every release stays on the ' +
    'releases page, so an installer can be fetched by hand — and going back to an earlier version ' +
    'is the same thing: install it over this one.',

  'about.title': 'About {app}',
  'about.message': '{app} {version}',
  'about.detail': 'Electron {electron} · Node {node}\n\nShared files: {shared}',

  'uninstall.cancel': 'Cancel',
  'uninstall.confirm': 'Uninstall',
  'uninstall.title': 'Uninstall {app}',
  'uninstall.message': 'Remove {app} from this computer?',
  'uninstall.detail':
    'The application closes and the Windows uninstaller takes over.\n\nYour marks, titles and ' +
    'settings stay in {shared}, so a later install picks up where you left off. Delete that folder ' +
    'by hand if you want them gone as well.',

  'uninstall.noneTitle': 'Nothing to uninstall',
  'uninstall.noneMessage': 'This copy was not installed by the Windows installer.',
  'uninstall.noneDetail':
    'No uninstaller was found beside the executable, which is what a run from a build directory ' +
    'looks like. Delete that directory instead.',
};

const FR: Strings = {
  'menu.file': 'Fichier',
  'menu.settings': 'Réglages…',
  'menu.quit': 'Quitter',
  'menu.help.about': 'À propos de {app}',
  'menu.help.updates': 'Rechercher des mises à jour…',
  'menu.help.uninstall': 'Désinstaller…',

  'tray.show': 'Afficher la liste',
  'tray.login': 'Démarrer avec Windows',
  'tray.quit': 'Quitter',
  'tray.unseen': '{app} — {count} sessions que vous n’avez pas vues',
  'tray.unseenOne': '{app} — 1 session que vous n’avez pas vue',

  'toast.markSeen': 'Marquer comme vu',
  'toast.open': 'Ouvrir la session',

  'update.skip': 'Ignorer cette version',
  'update.later': 'Pas maintenant',
  'update.install': 'Télécharger et installer',

  'start.failedTitle': '{app} n’a pas pu démarrer',
  'start.failedMessage':
    'Le service derrière la fenêtre n’est pas monté, il n’y a donc rien à afficher.',

  'update.errorTitle': 'Impossible de vérifier les mises à jour',
  'update.errorMessage': 'GitHub n’a pas pu être joint.',

  'update.noneTitle': 'Aucune version publiée',
  'update.noneMessage': 'Il n’y a encore rien vers quoi mettre à jour.',
  'update.noneDetail':
    'Aucune version publiée n’a été trouvée. Un dépôt privé répond exactement comme un dépôt sans ' +
    'aucune version, donc ceci ne dit pas lequel des deux c’est.',

  'update.currentTitle': 'À jour',
  'update.currentMessage': '{app} {version} est la dernière version.',

  'update.noInstallerTitle': 'Rien à installer',
  'update.noInstallerMessage': 'La version {version} est publiée, et ne porte aucun installeur Windows.',
  'update.noInstallerDetail':
    'Vous êtes en {current}. Il n’y a rien ici depuis quoi installer.',

  'update.unverifiableTitle': 'Mise à jour disponible, mais invérifiable',
  'update.unverifiableMessage':
    'La version {version} est publiée, et ne peut pas être installée d’ici.',
  'update.unverifiableDetail':
    'La publication ne porte aucun manifeste de sommes de contrôle : il n’y a donc rien contre quoi ' +
    'vérifier le téléchargement. Sans certificat de signature de code, ce manifeste est tout ce qui ' +
    'peut être vérifié, et lancer un installeur dont le seul titre est d’être arrivé par TLS n’est ' +
    'pas quelque chose qui se fera en silence.\n\nInstallez-la à la main depuis la page des ' +
    'publications si vous la voulez.',

  'update.availableTitle': 'Mise à jour disponible',
  'update.availableMessage': 'La version {version} est disponible. Vous avez la {current}.',
  'update.availableDetail':
    'L’installeur est téléchargé, vérifié contre la taille et le sha512 publiés avec la version, ' +
    'puis lancé — et rien n’est lancé qui échoue à l’une des deux vérifications. {app} se ferme ' +
    'pendant l’opération et revient sur la nouvelle version.\n\nIl n’est pas signé, donc Windows ' +
    'peut vous avertir à son sujet — la seule chose qui répond de lui est qu’il vient de GitHub ' +
    'par TLS.',

  'update.failedTitle': 'Échec de la mise à jour',
  'update.failedMessage': 'Rien n’a été installé.',
  'update.failedDetail':
    '{error}\n\nVous êtes toujours en {current} et rien n’a été remplacé. Chaque version reste sur ' +
    'la page des publications, donc un installeur peut être récupéré à la main — et revenir à une ' +
    'version antérieure est la même chose : installez-la par-dessus celle-ci.',

  'about.title': 'À propos de {app}',
  'about.message': '{app} {version}',
  'about.detail': 'Electron {electron} · Node {node}\n\nFichiers partagés : {shared}',

  'uninstall.cancel': 'Annuler',
  'uninstall.confirm': 'Désinstaller',
  'uninstall.title': 'Désinstaller {app}',
  'uninstall.message': 'Retirer {app} de cet ordinateur ?',
  'uninstall.detail':
    'L’application se ferme et le désinstalleur Windows prend le relais.\n\nVos marques, vos titres ' +
    'et vos réglages restent dans {shared}, donc une installation ultérieure reprend où vous en ' +
    'étiez. Supprimez ce dossier à la main si vous les voulez partis aussi.',

  'uninstall.noneTitle': 'Rien à désinstaller',
  'uninstall.noneMessage': 'Cette copie n’a pas été installée par l’installeur Windows.',
  'uninstall.noneDetail':
    'Aucun désinstalleur n’a été trouvé à côté de l’exécutable, ce qui est à quoi ressemble une ' +
    'exécution depuis un répertoire de compilation. Supprimez ce répertoire à la place.',
};

export const STRINGS: Record<Language, Strings> = { en: EN, fr: FR };

/**
 * One string, with its placeholders filled.
 *
 * A key with no entry comes back as the key rather than as an empty dialog: a
 * missing string should look like a missing string, not like an application
 * with nothing to say.
 */
export function text(
  language: Language,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const template = STRINGS[language][key] ?? STRINGS.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}
