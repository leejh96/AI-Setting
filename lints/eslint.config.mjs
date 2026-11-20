import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const javascriptFiles = '**/*.{js,jsx,mjs,cjs}';
const typescriptFiles = '**/*.{ts,tsx,mts,cts}';

const baseConfig = [
  {
    files: [javascriptFiles, typescriptFiles],
    extends: [js.configs.recommended],
    rules: {
      eqeqeq: ['error', 'always'],
      'no-self-compare': 'error',
    },
  },
  {
    files: [javascriptFiles],
    rules: {
      'no-var': 'error',
    },
  },
  {
    files: ['**/*.jsx'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: [typescriptFiles],
    extends: [tseslint.configs.recommended],
  },
];

export function createLintConfig({ typedFiles = [], tsconfigRootDir = import.meta.dirname } = {}) {
  if (typedFiles.length === 0) return defineConfig(baseConfig);

  return defineConfig(baseConfig, {
    files: typedFiles.map(pattern => [typescriptFiles, pattern]),
    extends: [tseslint.configs.recommendedTypeCheckedOnly],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
  });
}

export default createLintConfig();
