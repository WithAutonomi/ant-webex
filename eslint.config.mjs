// Security-focused ESLint config. Deliberately narrow: this enforces the
// extension's XSS-safe DOM convention, not a general style overhaul (so it
// doesn't churn on `any`/formatting). The extension injects a content script
// on <all_urls> and has a prior XSS fix in its history — treating HTML sinks
// as hard errors keeps that class of bug out.
import tsparser from '@typescript-eslint/parser';
import nounsanitized from 'eslint-plugin-no-unsanitized';

export default [
  { ignores: ['dist/', 'dist-firefox/', 'node_modules/'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { 'no-unsanitized': nounsanitized },
    rules: {
      // Untrusted data into HTML sinks (innerHTML/outerHTML assignment,
      // insertAdjacentHTML, document.write, Range.createContextualFragment…).
      'no-unsanitized/property': 'error',
      'no-unsanitized/method': 'error',
      // The repo convention is stricter than no-unsanitized: never touch these
      // sinks at all, regardless of the value — build DOM via textContent /
      // createElement. Encoded as a hard syntactic ban.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
          message:
            'Do not use innerHTML/outerHTML — build DOM via textContent/createElement (XSS-safe convention).',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message:
            'Do not use insertAdjacentHTML — build DOM nodes instead (XSS-safe convention).',
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
];
