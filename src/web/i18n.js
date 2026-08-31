/*
 * The interface in English and French.
 *
 * Loaded as a classic script before the module, so the dictionary is a global
 * the module can read: the page is served as one document and there is no route
 * to import a second file from.
 *
 * English is the fallback rather than a first-class default — a key missing
 * from a translation falls back to it silently, so a partial translation
 * degrades to a readable page instead of to blanks.
 */
const TRANSLATIONS = {
  en: {
    'app.title': 'Heimdall agents',
    'bar.search': 'Search…  (/)',
    'bar.in': 'in',
    'bar.sort': 'sort',
    'bar.match': 'match',
    'bar.from': 'from',
    'bar.to': 'to',
    'bar.controls': 'Filters and settings',
    'statusPicker.inferred': 'The transcript says:',

    'columns.button': 'Columns',
    'columns.title': 'Choose which columns are shown, and in what order',
    'columns.show': 'Show or hide',
    'columns.reorder': 'Drag to reorder',

    'group.new': 'New group',
    'group.newTitle': 'Make a band the rows can be put into',
    'group.newHeading': 'Name the group',
    'group.renameHeading': 'Rename the group',
    'group.nameLabel': 'Name',
    'group.save': 'Save',
    'group.cancel': 'Cancel',
    'group.rename': 'Rename',
    'group.delete': 'Delete the group',
    'group.count': '{count} shown',
    'group.countOf': '{shown} of {total} shown',
    'group.collapse': 'Fold this group away',
    'group.expand': 'Show what this group holds',
    'group.only.watched': 'Narrow this group to what is watched',
    'group.only.starred': 'Narrow this group to what is starred',
    'group.onlyOff.watched': 'Stop narrowing this group to what is watched',
    'group.onlyOff.starred': 'Stop narrowing this group to what is starred',

    /* A menu item is an instruction. The two strings beside these are hints on
       a marker — "(click to acknowledge)" — and reading one in a menu was the
       clearest sign the menu had been assembled out of whatever was nearby. */
    'rowMenu.ack': 'Mark as seen',
    'rowMenu.unack': 'Mark as unseen',
    'rowMenu.open': 'Open',
    'rowMenu.session': 'Session in VS Code',
    'rowMenu.workspaceOpen': 'Workspace',
    'rowMenu.transcript': 'Raw transcript',
    'rowMenu.status': 'Status',
    'rowMenu.colour': 'Colour',
    'rowMenu.provider': 'Provider…',
    'rowMenu.workspace': 'Workspace…',
    'rowMenu.group': 'Group',
    'rowMenu.noGroup': 'None',
    'statusPicker.clear': 'Back to the inferred status',
    'bar.reset': 'Reset',
    'bar.refresh': 'Refresh',
    'bar.refreshTitle': 'Re-scan the transcripts and redraw the list (r)',
    'bar.pause': 'Pause',
    'bar.resume': 'Resume',
    'bar.settings': 'Settings',
    'bar.theme': 'Theme',
    'bar.themeTitle': 'Follow the system, or force light or dark',
    'bar.random': 'Random',
    'bar.randomTitle': 'Pick a primary colour at random',
    'bar.primary': 'Primary colour',
    'bar.notifications': 'Notifications',
    'bar.acknowledge': 'Acknowledge all',
    'bar.workspaces': 'Workspaces',
    'bar.watched': 'Watched',
    'bar.starred': 'Starred',

    'scope.both': 'title and content',
    'scope.title': 'title',
    'scope.content': 'content',
    'match.all': 'all of them',
    'match.any': 'any of them',
    /* The set the bell on each row decides. Watching a session turns its bell
       on, so this is where the old wording pointed — it just says which set. */
    'notifyScope.watched': 'sessions with the bell on',
    'notifyScope.unacknowledged': 'anything unacknowledged',

    'sort.watched-desc': 'watched first',
    'sort.watched-asc': 'watched last',
    'sort.starred-desc': 'starred first',
    'sort.starred-asc': 'starred last',
    'sort.status-asc': 'status, most urgent first',
    'sort.status-desc': 'status, least urgent first',
    'bar.autoSort': 'Keep sorted',
    'bar.autoSortTitle':
      'Reorder the list as it changes, instead of offering to. Off, rows already on screen stay where they are until you ask.',
    'sort.minutes-desc': 'minutes in this status, longest first',
    'sort.minutes-asc': 'minutes in this status, shortest first',
    'sort.created-desc': 'created, newest first',
    'sort.created-asc': 'created, oldest first',
    'sort.updated-desc': 'last activity, newest first',
    'sort.updated-asc': 'last activity, oldest first',
    'sort.provider-asc': 'provider, A to Z',
    'sort.provider-desc': 'provider, Z to A',
    'sort.workspace-asc': 'workspace, A to Z',
    'sort.workspace-desc': 'workspace, Z to A',
    'sort.title-asc': 'title, A to Z',
    'sort.title-desc': 'title, Z to A',

    'notify.onStatus': 'Raise a notification when a session becomes {status}',
    'notify.why.idle': 'The model stopped working — this is what you want to hear about.',
    'notify.why.failed': 'The turn ended on an error, a refusal or an interruption.',
    'notify.why.running': 'A session started working. Rarely worth a sound: you started it.',
    'notify.why.unknown':
      'An open turn went silent for too long. That is a fact about a stale file, ' +
      'not about the model stopping — off by default for that reason.',
    'status.running': 'running',
    'status.failed': 'failed',
    'status.idle': 'idle',
    'status.unknown': 'unknown',

    'column.status': 'status',
    'column.created': 'created',
    'column.updated': 'last activity',
    'column.watchedAt': 'watch changed',
    'column.provider': 'provider',
    'column.workspace': 'workspace',
    'column.title': 'title',
    'column.watched': 'Watched',
    'column.starred': 'Starred',
    'column.notify': 'Notifications',
    'column.minutes': 'Minutes in this status',
    /* Short enough not to set the width of a column of three-digit numbers. */
    'column.minutesShort': 'm.',
    /* One letter each: they sit against the digits in a narrow column. */
    'unit.days': 'd',
    'unit.hours': 'h',
    'unit.minutes': 'm',
    'column.resize': 'Resize the {name} column',
    'column.resizeHint':
      'Drag to resize {name}. Arrow keys adjust it, Home fits it to its contents, and so does a double-click.',

    'palette.heading': 'Colour for {name}',
    'palette.pick': 'Pick a colour',
    'palette.hex': 'Colour, in hex',
    'palette.textHex': 'Text colour, in hex',
    'palette.text': 'Text colour',
    'palette.contrast': 'Contrast it',
    'palette.auto': 'Choose for me',

    'row.openSession': 'Open this session in VS Code',
    'row.openWorkspace': 'Open',
    'row.watchedOn': 'Watched — click to remove',
    'row.watchedOff': 'Click to watch',
    'row.starredOn': 'Starred — click to remove',
    'row.starredOff': 'Click to star',
    'row.notifyOn': 'Notifying about this session — click to silence it',
    'row.notifyOff': 'Silent — click to be notified about this session',
    'row.acknowledge': '(click to acknowledge)',
    'row.unacknowledge': '(click to mark it unseen again)',
    'row.watchedSince': 'Watched since {at}',
    'row.watchDropped': 'Dropped from watching on {at}',
    'row.watchUnrecorded': 'No watch change recorded since this began being kept',
    'row.unacknowledged': 'unacknowledged',
    'row.workspaceUnknown': 'workspace unknown',

    'state.connecting': 'connecting…',
    'state.paused': 'paused',
    'state.watching': 'watching {count} root(s)',
    'state.lastScan': 'last scan {at}',
    'state.streamLost': 'stream lost — reconnecting…',
    'state.opening': 'opening…',
    'state.fellBack': 'the session could not be reached — opened the transcript instead',
    'table.caption': 'Claude and Codex sessions',
    'main.label': 'Sessions',
    'notify.enabledTitle': 'Notifying on: {statuses}',
    'notify.disabledTitle': 'Notifications are off',
    'state.counts': '{visible} visible / {loaded} loaded',
    'state.reorder': '{count} row(s) would move — reorder',
    'state.noMatch': 'No session matches the current search and filters.',
    'state.nothingFound': 'No session found.',
    'state.emptyProvider': '{provider}: nothing found in {root}',
    'notice.paused': 'Paused — nothing is being watched or scanned.',
    'notice.scanFailed': '{provider}: scan failed in {root} — {error}',
    'notice.notWatching': 'Not watching {root}: {error}',
    'notice.truncated': '{count} session(s) left out by the history window or the session cap.',

    'settings.heading': 'Settings',
    'settings.whereLegend': 'Where the transcripts are',
    'settings.whereHelp':
      'Left empty, each provider is looked for where it usually lives. Detection reports what it found, so a directory that exists but holds nothing is not mistaken for the right one.',
    'settings.claudeHome': 'Claude home',
    'settings.codexHome': 'Codex home',
    'settings.detect': 'Detect',
    'settings.detectLooking': 'looking…',
    'settings.detectFound': '{provider}: {count} transcript(s)',
    'settings.detectNothing': '{provider}: nothing found',
    'settings.scanLegend': 'What is scanned',
    'settings.maxSessions': 'Sessions per provider',
    'settings.history': 'History in days',
    'settings.historyHint': '(0 for everything)',
    'settings.stale': 'Stop believing an open turn after, in minutes',
    'settings.staleHint': '(0 for never)',
    'settings.staleHelp':
      'A turn stays open until the provider closes it, and a session killed ' +
      'mid-turn never closes its own — nothing is written to say so. Past this ' +
      'delay the session is called inconclusive rather than running, which is ' +
      'the only honest thing left to say about a file that has not moved. ' +
      'At 0 the clock never intervenes: an open turn stays running until the ' +
      'transcript itself says otherwise, and a row you know to be wrong is ' +
      'yours to correct by right-clicking it. That is the default, because a ' +
      'session that left something running is worth being reminded of rather ' +
      'than quietly aged away. Set 30 to have it decided for you — measured ' +
      'here, 99.9% of the silences inside a real turn last under ten minutes.',
    'settings.subagents': 'List orphan Codex sub-agent transcripts as sessions',
    'settings.behaviourLegend': 'Behaviour',
    'settings.autowatch': 'Watch a session when it starts working',
    'settings.notifyDelay': 'Wait before notifying, in seconds',
    'settings.notifyDelayHelp':
      'How long a session has to stay stopped before it is worth telling you about. A turn that ends and starts again inside this window is never reported. Zero tells you the moment the transcript says so, including the false stops.',
    'settings.handoff': 'Window handover delay, in seconds',
    'settings.appLegend': 'This application',
    'settings.login': 'Start with Windows',
    'settings.tray': 'Show the tray icon',
    'settings.trayHelp': 'The tray is where quitting and reopening the list live.',
    'settings.languageLegend': 'Language and dates',
    'settings.language': 'Language',
    'settings.dateLocale': 'Date format',
    'settings.dateFollows': 'follow the language',
    'settings.dateIso': 'ISO (2026-08-01 14:30)',
    'settings.languageAuto': 'system ({name})',
    'settings.close': 'Close',
    'settings.save': 'Save',
    'settings.saved': 'Saved.',
    'settings.savedRestarting': 'Saved — restarting to apply…',
    'settings.unavailable': 'settings unavailable: {error}',
    'settings.failed': 'failed: {error}',
  },

  fr: {
    'bar.search': 'Rechercher…  (/)',
    'bar.in': 'dans',
    'bar.sort': 'tri',
    'bar.match': 'critères',
    'bar.from': 'du',
    'bar.to': 'au',
    'bar.controls': 'Filtres et réglages',
    'statusPicker.inferred': 'Le transcript dit :',

    'columns.button': 'Colonnes',
    'columns.title': 'Choisir les colonnes affichées, et leur ordre',
    'columns.show': 'Afficher / masquer',
    'columns.reorder': 'Glisser pour réordonner',

    'group.new': 'Nouveau groupe',
    'group.newTitle': 'Créer une bande où ranger des lignes',
    'group.newHeading': 'Nommer le groupe',
    'group.renameHeading': 'Renommer le groupe',
    'group.nameLabel': 'Nom',
    'group.save': 'Enregistrer',
    'group.cancel': 'Annuler',
    'group.rename': 'Renommer',
    'group.delete': 'Supprimer le groupe',
    'group.count': '{count} affichée(s)',
    'group.countOf': '{shown} affichée(s) sur {total}',
    'group.collapse': 'Replier ce groupe',
    'group.expand': 'Afficher ce que ce groupe contient',
    'group.only.watched': 'Restreindre ce groupe aux surveillées',
    'group.only.starred': 'Restreindre ce groupe aux favorites',
    'group.onlyOff.watched': 'Ne plus restreindre ce groupe aux surveillées',
    'group.onlyOff.starred': 'Ne plus restreindre ce groupe aux favorites',

    'rowMenu.ack': 'Marquer comme vue',
    'rowMenu.unack': 'Marquer comme non vue',
    'rowMenu.open': 'Ouvrir',
    'rowMenu.session': 'La session dans VS Code',
    'rowMenu.workspaceOpen': 'Le workspace',
    'rowMenu.transcript': 'Le transcript brut',
    'rowMenu.status': 'Statut',
    'rowMenu.colour': 'Couleur',
    'rowMenu.provider': 'Du fournisseur…',
    'rowMenu.workspace': 'Du workspace…',
    'rowMenu.group': 'Groupe',
    'rowMenu.noGroup': 'Aucun',
    'statusPicker.clear': 'Revenir au statut déduit',
    'bar.reset': 'Réinitialiser',
    'bar.refresh': 'Actualiser',
    'bar.refreshTitle': 'Relire les transcripts et redessiner la liste (r)',
    'bar.pause': 'Pause',
    'bar.resume': 'Reprendre',
    'bar.settings': 'Réglages',
    'bar.theme': 'Thème',
    'bar.themeTitle': 'Suivre le système, ou forcer clair ou sombre',
    'bar.random': 'Aléatoire',
    'bar.randomTitle': 'Choisir une couleur primaire au hasard',
    'bar.primary': 'Couleur primaire',
    'bar.notifications': 'Notifications',
    'bar.acknowledge': 'Tout marquer comme vu',
    'bar.workspaces': 'Dossiers',
    'bar.watched': 'Suivies',
    'bar.starred': 'Favorites',

    'scope.both': 'titre et contenu',
    'scope.title': 'titre',
    'scope.content': 'contenu',
    'match.all': 'tous',
    'match.any': "au moins un",
    'notifyScope.watched': 'sessions dont la cloche est allumée',
    'notifyScope.unacknowledged': 'tout ce qui est non vu',

    'sort.watched-desc': 'suivies d’abord',
    'sort.watched-asc': 'suivies en dernier',
    'sort.starred-desc': 'favorites d’abord',
    'sort.starred-asc': 'favorites en dernier',
    'sort.status-asc': 'statut, plus urgent d’abord',
    'sort.status-desc': 'statut, moins urgent d’abord',
    'bar.autoSort': 'Tri auto',
    'bar.autoSortTitle':
      'Réordonner la liste à mesure qu’elle change, au lieu de le proposer. Désactivé, les lignes déjà à l’écran restent en place jusqu’à ce que vous le demandiez.',
    'sort.minutes-desc': 'minutes dans ce statut, plus longtemps d’abord',
    'sort.minutes-asc': 'minutes dans ce statut, moins longtemps d’abord',
    'sort.created-desc': 'création, plus récent d’abord',
    'sort.created-asc': 'création, plus ancien d’abord',
    'sort.updated-desc': 'activité, plus récent d’abord',
    'sort.updated-asc': 'activité, plus ancien d’abord',
    'sort.provider-asc': 'fournisseur, A à Z',
    'sort.provider-desc': 'fournisseur, Z à A',
    'sort.workspace-asc': 'dossier, A à Z',
    'sort.workspace-desc': 'dossier, Z à A',
    'sort.title-asc': 'titre, A à Z',
    'sort.title-desc': 'titre, Z à A',

    'notify.onStatus': 'Notifier quand une session passe à « {status} »',
    'notify.why.idle': 'Le modèle s’est arrêté de travailler — c’est ce qu’on veut savoir.',
    'notify.why.failed': 'Le tour s’est terminé sur une erreur, un refus ou une interruption.',
    'notify.why.running':
      'Une session s’est mise à travailler. Rarement utile : c’est vous qui l’avez lancée.',
    'notify.why.unknown':
      'Un tour ouvert s’est tu trop longtemps. C’est un fait sur un fichier figé, ' +
      'pas sur un modèle qui s’arrête — décoché par défaut pour cette raison.',
    'status.running': 'en cours',
    'status.failed': 'échec',
    // Ni « terminée » ni « inactive » : le modèle s’est arrêté et la suite vous
    // revient, qu’il ait fini de répondre ou qu’il vous pose une question.
    'status.idle': 'en attente',
    'status.unknown': 'indéterminé',

    'column.status': 'statut',
    'column.created': 'création',
    'column.updated': 'dernière activité',
    'column.watchedAt': 'surveillance modifiée',
    'column.provider': 'fournisseur',
    'column.workspace': 'dossier',
    'column.title': 'titre',
    'column.watched': 'Suivie',
    'column.starred': 'Favorite',
    'column.notify': 'Notifications',
    'column.minutes': 'Minutes dans ce statut',
    'column.minutesShort': 'm.',
    'unit.days': 'j',
    'unit.hours': 'h',
    'unit.minutes': 'm',
    'column.resize': 'Redimensionner la colonne {name}',
    'column.resizeHint':
      'Faites glisser pour redimensionner {name}. Les flèches ajustent, Origine ajuste au contenu, un double-clic aussi.',

    'palette.heading': 'Couleur de {name}',
    'palette.pick': 'Choisir une couleur',
    'palette.hex': 'Couleur, en hexadécimal',
    'palette.textHex': 'Couleur du texte, en hexadécimal',
    'palette.text': 'Couleur du texte',
    'palette.contrast': 'Contraster',
    'palette.auto': 'Choisir pour moi',

    'row.openSession': 'Ouvrir cette session dans VS Code',
    'row.openWorkspace': 'Ouvrir',
    'row.watchedOn': 'Suivie — cliquer pour retirer',
    'row.watchedOff': 'Cliquer pour suivre',
    'row.starredOn': 'Favorite — cliquer pour retirer',
    'row.starredOff': 'Cliquer pour mettre en favori',
    'row.notifyOn': 'Notifications actives — cliquer pour les couper',
    'row.notifyOff': 'Silencieuse — cliquer pour être notifié de cette session',
    'row.acknowledge': '(cliquer pour marquer comme vu)',
    'row.unacknowledge': '(cliquer pour remarquer comme non vu)',
    'row.watchedSince': 'Surveillée depuis le {at}',
    'row.watchDropped': 'Surveillance retirée le {at}',
    'row.watchUnrecorded': 'Aucun changement de surveillance enregistré depuis le début du suivi',
    'row.unacknowledged': 'non vu',
    'row.workspaceUnknown': 'dossier inconnu',

    'state.connecting': 'connexion…',
    'state.paused': 'en pause',
    'state.watching': 'surveille {count} racine(s)',
    'state.lastScan': 'dernier scan {at}',
    'state.streamLost': 'flux perdu — reconnexion…',
    'state.opening': 'ouverture…',
    'state.fellBack': 'session injoignable — transcript ouvert à la place',
    'table.caption': 'Sessions Claude et Codex',
    'main.label': 'Sessions',
    'notify.enabledTitle': 'Notifie sur : {statuses}',
    'notify.disabledTitle': 'Notifications désactivées',
    'state.counts': '{visible} affichées / {loaded} chargées',
    'state.reorder': '{count} ligne(s) se déplaceraient — réordonner',
    'state.noMatch': 'Aucune session ne correspond à la recherche et aux filtres.',
    'state.nothingFound': 'Aucune session trouvée.',
    'state.emptyProvider': '{provider} : rien trouvé dans {root}',
    'notice.paused': 'En pause — plus rien n’est surveillé ni scanné.',
    'notice.scanFailed': '{provider} : échec du scan dans {root} — {error}',
    'notice.notWatching': 'Non surveillé, {root} : {error}',
    'notice.truncated':
      '{count} session(s) écartée(s) par la fenêtre d’historique ou le plafond de sessions.',

    'settings.heading': 'Réglages',
    'settings.whereLegend': 'Emplacement des transcripts',
    'settings.whereHelp':
      'Laissé vide, chaque fournisseur est cherché là où il vit habituellement. La détection indique ce qu’elle a trouvé, pour qu’un répertoire existant mais vide ne soit pas pris pour le bon.',
    'settings.claudeHome': 'Dossier Claude',
    'settings.codexHome': 'Dossier Codex',
    'settings.detect': 'Détecter',
    'settings.detectLooking': 'recherche…',
    'settings.detectFound': '{provider} : {count} transcript(s)',
    'settings.detectNothing': '{provider} : rien trouvé',
    'settings.scanLegend': 'Ce qui est scanné',
    'settings.maxSessions': 'Sessions par fournisseur',
    'settings.history': 'Historique en jours',
    'settings.historyHint': '(0 pour tout)',
    'settings.stale': 'Cesser de croire un tour ouvert après, en minutes',
    'settings.staleHint': '(0 pour jamais)',
    'settings.staleHelp':
      'Un tour reste ouvert tant que le fournisseur ne le ferme pas, et une ' +
      'session tuée en plein tour ne ferme jamais le sien — rien n’est écrit ' +
      'pour le dire. Passé ce délai, la session est dite indéterminée plutôt ' +
      'qu’en cours, ce qui est la seule chose honnête à dire d’un fichier qui ' +
      'ne bouge plus. À 0, l’horloge n’intervient jamais : un tour ouvert reste ' +
      'en cours tant que le transcript ne dit pas le contraire, et une ligne que ' +
      'vous savez fausse se corrige d’un clic droit. C’est la valeur par ' +
      'défaut, parce qu’une session qui a laissé tourner quelque chose mérite ' +
      'de vous le rappeler plutôt que de vieillir en silence. Mettez 30 pour ' +
      'que ce soit tranché à votre place — mesuré ici, 99,9 % des silences à ' +
      'l’intérieur d’un vrai tour durent moins de dix minutes.',
    'settings.subagents': 'Lister les transcripts de sous-agents Codex orphelins',

    'settings.behaviourLegend': 'Comportement',
    'settings.autowatch': 'Suivre une session dès qu’elle se met à travailler',
    'settings.notifyDelay': 'Attente avant notification, en secondes',
    'settings.notifyDelayHelp':
      "Combien de temps une session doit rester arrêtée avant qu'il vaille la peine de vous prévenir. Un tour qui se termine et reprend dans cette fenêtre n'est jamais signalé. Zéro vous prévient dès que le transcript le dit, faux arrêts compris.",
    'settings.handoff': 'Délai de bascule de fenêtre, en secondes',
    'settings.appLegend': 'Cette application',
    'settings.login': 'Démarrer avec Windows',
    'settings.tray': 'Afficher l’icône de la zone de notification',
    'settings.trayHelp':
      'C’est depuis cette icône que l’on quitte et que l’on rouvre la liste.',
    'settings.languageLegend': 'Langue et dates',
    'settings.language': 'Langue',
    'settings.dateLocale': 'Format de date',
    'settings.dateFollows': 'suivre la langue',
    'settings.dateIso': 'ISO (2026-08-01 14:30)',
    'settings.languageAuto': 'système ({name})',
    'settings.close': 'Fermer',
    'settings.save': 'Enregistrer',
    'settings.saved': 'Enregistré.',
    'settings.savedRestarting': 'Enregistré — redémarrage pour appliquer…',
    'settings.unavailable': 'réglages indisponibles : {error}',
    'settings.failed': 'échec : {error}',
  },
};

const LANGUAGES = ['en', 'fr'];

/**
 * The language to use. The stored choice wins; `auto` asks the browser, which
 * in the desktop application is the system. Anything unsupported falls back to
 * English rather than to nothing.
 */
function resolveLanguage(stored, offered) {
  if (LANGUAGES.includes(stored)) {
    return stored;
  }
  for (const tag of offered ?? []) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (LANGUAGES.includes(base)) {
      return base;
    }
  }
  return 'en';
}

/** English fills any gap, so a missing key shows text rather than a blank. */
function translate(language, key, values) {
  const text = TRANSLATIONS[language]?.[key] ?? TRANSLATIONS.en[key] ?? key;
  return values
    ? text.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole))
    : text;
}

// Published deliberately rather than left to the implicit globals of a classic
// script: this is the contract the module depends on, and stating it means a
// typo on either side is an error rather than a silent undefined.
globalThis.resolveLanguage = resolveLanguage;
globalThis.translate = translate;
