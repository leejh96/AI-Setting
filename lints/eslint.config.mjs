import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import ts from 'typescript';
import tseslint from 'typescript-eslint';

const javascriptFiles = '**/*.{js,jsx,mjs,cjs}';
const typescriptFiles = '**/*.{ts,tsx,mts,cts}';

function diagnosticMessage(diagnostic) {
  return `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
}

export const typescriptChecks = {
  files: [typescriptFiles],
  plugins: {
    'ai-setting': {
      rules: {
        'typescript-diagnostics': {
          meta: { schema: [], messages: { diagnostic: '{{diagnostic}}' } },
          create(context) {
            return {
              Program(node) {
                const { program, esTreeNodeToTSNodeMap } = context.sourceCode.parserServices;
                const source = esTreeNodeToTSNodeMap?.get(node);
                if (!program || !source) throw new Error('TypeScript 타입 정보를 확인할 수 없습니다.');
                if (program.getCompilerOptions().noCheck) throw new Error('tsconfig의 noCheck가 타입 검사를 비활성화합니다.');
                const setupError = [
                  ...program.getConfigFileParsingDiagnostics(),
                  ...program.getOptionsDiagnostics(),
                  ...program.getGlobalDiagnostics(),
                ].find(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
                if (setupError) throw new Error(diagnosticMessage(setupError));

                for (const diagnostic of program.getSemanticDiagnostics(source)) {
                  if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
                  const start = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
                  context.report({
                    loc: { line: start.line + 1, column: start.character },
                    messageId: 'diagnostic', data: { diagnostic: diagnosticMessage(diagnostic) },
                  });
                }
              },
            };
          },
        },
      },
    },
  },
  rules: {
    'ai-setting/typescript-diagnostics': 'error',
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
  },
};

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
