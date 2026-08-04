import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // The interface runs in a browser, not in Node: different globals, and no
    // TypeScript rules to apply to it.
    files: ['src/web/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    // `i18n.js` is served as a classic script before the module, so what it
    // declares is a global by the time `app.js` runs. `lib.js` is concatenated
    // into the same module script just above `app.js`, so what it exports is in
    // scope by the same trick. Declared here rather than silenced with a
    // comment, so an actual typo is still caught.
    files: ['src/web/app.js'],
    languageOptions: {
      globals: {
        resolveLanguage: 'readonly',
        translate: 'readonly',
        TRANSLATIONS: 'readonly',
        channel: 'readonly',
        luminance: 'readonly',
        contrast: 'readonly',
        toRgb: 'readonly',
        toHex: 'readonly',
        parseRgb: 'readonly',
        readable: 'readonly',
        SORT_KEYS: 'readonly',
        FIRST_DIRECTION: 'readonly',
        normalizeSort: 'readonly',
        splitSort: 'readonly',
        day: 'readonly',
        folder: 'readonly',
        WORKSPACE_HUES: 'readonly',
        hashSlot: 'readonly',
        ink: 'readonly',
        readableInk: 'readonly',
        assignSlots: 'readonly',
        readSlots: 'readonly',
        minutesSince: 'readonly',
        MIN_COLUMN_WIDTH: 'readonly',
        MAX_COLUMN_WIDTH: 'readonly',
        DEFAULT_COLUMN_WIDTHS: 'readonly',
        COLUMN_FORMAT: 'readonly',
        clampColumnWidth: 'readonly',
        readColumnWidths: 'readonly',
      },
    },
  },
  {
    // It is loaded as a classic script, not a module.
    files: ['src/web/i18n.js'],
    languageOptions: { sourceType: 'script' },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      // A command writes to stdout and stderr through src/cli/output.ts, so the
      // data a pipe carries never gets mixed with anything else.
      'no-console': 'error',
    },
  },
);
