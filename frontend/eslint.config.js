import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
export default ts.config(
  { ignores: ['dist', 'public', 'coverage', 'test-results', 'playwright-report'] },
  js.configs.recommended, ...ts.configs.recommended,
  { files: ['src/**/*.{ts,tsx}'], languageOptions: { globals: { ...globals.browser, ...globals.es2022 } }, plugins: { 'react-hooks': hooks }, rules: { ...hooks.configs.recommended.rules, '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }], '@typescript-eslint/no-explicit-any': 'error' } },
  { files: ['*.{js,mjs}', 'scripts/*.mjs'], languageOptions: { globals: globals.node } },
);
