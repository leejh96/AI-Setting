# JavaScript·TypeScript 전역 ESLint

공통 실행기와 설정은 각 도구의 사용자 디렉터리에 설치합니다. Codex는 `$CODEX_HOME/lints/`(기본값 `~/.codex/lints/`), Antigravity는 `~/.gemini/lints/`의 실행기를 Stop 검토에서 사용합니다. 전역 ESLint에는 Node.js 22.13 이상인 22.x 또는 24 이상이 필요합니다. 설치와 검토 지침 갱신은 [Windows](../hooks/code-quality-review/README.windows.md#실행-파일과-공통-린트-설정-복사)와 [macOS](../hooks/code-quality-review/README.macos.md#실행-파일과-공통-린트-설정-복사) 안내를 따릅니다.

| 파일 | 전역 규칙 |
| --- | --- |
| `.js`, `.jsx`, `.mjs`, `.cjs` | `@eslint/js` 권장 규칙과 `eqeqeq`, `no-self-compare`, `no-var` |
| `.ts`, `.tsx`, `.mts`, `.cts` | `@eslint/js`와 `typescript-eslint` 권장 규칙, `eqeqeq`, `no-self-compare`. `no-var`는 TypeScript 호환 설정에서 적용합니다. |

프로젝트 루트에서 직접 검사할 수 있습니다. 아래는 기본 Codex 홈을 사용한 예시입니다. Antigravity에서는 실행기 경로를 `$HOME/.gemini/lints/lint.mjs`로 바꿉니다. 파일은 하나 이상 지정합니다. 상대 경로는 첫 번째 인자인 프로젝트 루트를 기준으로 합니다.

```sh
node "$HOME/.codex/lints/lint.mjs" "." "src/app.ts" "scripts/build.js"
```

실행 결과는 위반 없이 검사했으면 0, 린트 오류가 있으면 1, 잘못된 설정이나 파일 경로 또는 파싱 오류가 있으면 2입니다.

## 프로젝트 규칙과 예외

별도 설정이 필요할 때 프로젝트의 `eslint.config.*`에 추가합니다. 실행기는 프로젝트 안에서 각 검사 파일에 가장 가까운 ESLint 10 플랫 설정을 찾아 전역 규칙 뒤에 적용합니다. 재정의한 규칙과 제외 패턴은 해당 파일에만 영향을 줍니다. 프로젝트 고유 플러그인이 있다면 프로젝트 설정에서 불러옵니다. [ESLint 설정 파일](https://eslint.org/docs/latest/use/configure/configuration-files)

```js
export default [
  { ignores: ['**/generated/**'] },
  { files: ['src/**/*.{js,ts}'], rules: { 'no-console': 'error' } },
  { files: ['scripts/**/*.js'], rules: { eqeqeq: 'off' } },
];
```

## 타입 기반 검사를 적용할 폴더

프로젝트 설정에서 파일 범위와 TypeScript 프로젝트를 지정합니다. 예시의 `src`와 `packages/api/src` 안 TypeScript 파일은 타입 기반 검사까지 받고, 그 밖의 TypeScript 파일은 전역 기본 규칙으로 검사합니다. 선택된 파일은 해당 `tsconfig.json`에 포함되어야 합니다.

```js
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    files: ['src/**/*.{ts,tsx,mts,cts}', 'packages/api/src/**/*.{ts,tsx,mts,cts}'],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
```

이 예시처럼 프로젝트 설정이 패키지를 직접 가져오는 경우 해당 패키지는 프로젝트 의존성에 포함합니다. 전역 설치의 TypeScript 플러그인을 사용하는 경우 일반 설정 배열에 같은 `files`와 `languageOptions`를 두고 `rules: { '@typescript-eslint/no-floating-promises': 'error' }`처럼 필요한 타입 기반 규칙을 지정할 수 있습니다. [타입 검사 설정](https://typescript-eslint.io/getting-started/typed-linting/)
