import { describe, expect, it } from 'vitest';
import { LANGUAGES, STRINGS, appLanguage, text } from './strings';

describe('appLanguage', () => {
  it('takes what was chosen, whatever the machine says', () => {
    expect(appLanguage('fr', 'en-GB')).toBe('fr');
    expect(appLanguage('en', 'fr-FR')).toBe('en');
  });

  it('follows the machine when nothing was chosen', () => {
    for (const stored of ['auto', undefined, '', 'de']) {
      expect(appLanguage(stored, 'fr-FR')).toBe('fr');
      expect(appLanguage(stored, 'en-US')).toBe('en');
    }
  });

  it('matches on the leading subtag, not the whole tag', () => {
    // A machine set to Canadian or Belgian French is set to French.
    for (const locale of ['fr', 'fr-CA', 'fr-BE', 'FR-fr']) {
      expect(appLanguage('auto', locale)).toBe('fr');
    }
  });

  it('falls to English for a language it does not speak', () => {
    // Which is the language every string here was written in.
    expect(appLanguage('auto', 'de-DE')).toBe('en');
    expect(appLanguage('auto', '')).toBe('en');
  });
});

describe('STRINGS', () => {
  it('says everything in every language it offers', () => {
    // The failure this exists for: a key added on one side and forgotten on the
    // other shows up as an English sentence in a French menu, and only to the
    // people reading French.
    const english = Object.keys(STRINGS.en).sort();
    for (const language of LANGUAGES) {
      expect(Object.keys(STRINGS[language]).sort(), language).toEqual(english);
    }
  });

  it('asks for the same values in every language', () => {
    // A placeholder dropped in translation is a version number that never
    // appears, or a dialog with a literal `{app}` in it.
    const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(STRINGS.en)) {
      for (const language of LANGUAGES) {
        expect(placeholders(STRINGS[language][key]), `${language} ${key}`).toEqual(
          placeholders(STRINGS.en[key]),
        );
      }
    }
  });

  it('leaves no string empty', () => {
    for (const language of LANGUAGES) {
      for (const [key, value] of Object.entries(STRINGS[language])) {
        expect(value.trim(), `${language} ${key}`).not.toBe('');
      }
    }
  });
});

describe('text', () => {
  it('fills the placeholders', () => {
    expect(text('en', 'about.message', { app: 'Heimdall agents', version: '1.2.3' })).toBe(
      'Heimdall agents 1.2.3',
    );
    expect(text('fr', 'uninstall.message', { app: 'Heimdall agents' })).toBe(
      'Retirer Heimdall agents de cet ordinateur ?',
    );
  });

  it('leaves a placeholder it was given nothing for, rather than emptying it', () => {
    // `{version}` in a dialog is wrong and looks it. An empty gap is wrong and
    // reads as a sentence somebody wrote badly.
    expect(text('en', 'update.currentMessage', { app: 'X' })).toContain('{version}');
  });

  it('answers with the key when there is no string, rather than with nothing', () => {
    expect(text('en', 'nothing.here')).toBe('nothing.here');
  });

  it('falls back to English for a key one language is missing', () => {
    // Cannot happen while the test above passes, and is what happens if it
    // ever stops: an English sentence beats a blank dialog.
    expect(text('fr', 'menu.file')).toBe('Fichier');
  });
});
