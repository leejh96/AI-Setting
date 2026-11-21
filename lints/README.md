# JavaScript·TypeScript 전역 ESLint

공통 실행기와 설정은 각 도구의 사용자 디렉터리에 설치합니다. Codex는 `$CODEX_HOME/lints/`(기본값 `~/.codex/lints/`), Antigravity는 `~/.gemini/lints/`의 실행기를 Stop 검토에서 사용합니다. 전역 ESLint에는 Node.js 22.13 이상인 22.x 또는 24 이상이 필요합니다. 설치와 검토 지침 갱신은 [Windows](../hooks/code-quality-review/README.windows.md#실행-파일과-공통-린트-설정-복사)와 [macOS](../hooks/code-quality-review/README.macos.md#실행-파일과-공통-린트-설정-복사) 안내를 따릅니다.

| 파일 | 전역 규칙 |
| --- | --- |
| `.js`, `.jsx`, `.mjs`, `.cjs` | `@eslint/js` 권장 규칙과 `eqeqeq`, `no-self-compare`, `no-var` |
| `.ts`, `.tsx`, `.mts`, `.cts` | `@eslint/js`와 `typescript-eslint` 권장 규칙, `eqeqeq`, `no-self-compare`, TypeScript 타입 오류, 처리되지 않은 Promise. `no-var`는 TypeScript 호환 설정에서 적용합니다. |

프로젝트 루트에서 직접 검사할 수 있습니다. 아래는 기본 Codex 홈을 사용한 예시입니다. Antigravity에서는 실행기 경로를 `$HOME/.gemini/lints/lint.mjs`로 바꿉니다. 파일은 하나 이상 지정합니다. 상대 경로는 첫 번째 인자인 프로젝트 루트를 기준으로 합니다.

```sh
node "$HOME/.codex/lints/lint.mjs" "." "src/app.ts" "scripts/build.js"
```

실행 결과는 위반 없이 검사했으면 0, 린트·타입 오류가 있으면 1, 잘못된 설정이나 파일 경로 또는 파싱 오류 등으로 검사를 실행할 수 없으면 2입니다.

## 프로젝트 규칙과 예외

별도 설정이 필요할 때 프로젝트의 `eslint.config.*`에 추가합니다. 실행기는 프로젝트 안에서 각 검사 파일에 가장 가까운 ESLint 10 플랫 설정을 찾아 전역 규칙 뒤에 적용합니다. 재정의한 규칙과 제외 패턴은 해당 파일에만 영향을 줍니다. 프로젝트 고유 플러그인이 있다면 프로젝트 설정에서 불러옵니다. [ESLint 설정 파일](https://eslint.org/docs/latest/use/configure/configuration-files)

```js
export default [
  { ignores: ['**/generated/**'] },
  { files: ['src/**/*.{js,ts}'], rules: { 'no-console': 'error' } },
  { files: ['scripts/**/*.js'], rules: { eqeqeq: 'off' } },
];
```

## TypeScript 기본 검사

전역 실행기는 검사 대상 TS 파일에서 `const value: number = 'text'` 같은 타입 오류와 `save()`처럼 처리하지 않은 Promise를 기본으로 검사합니다. `void save()`만 붙여도 거부 처리는 생기지 않으므로 기본 설정에서 오류입니다. 오류는 검사 대상 파일 기준으로 보고하고, 가져온 모듈의 타입 정보는 검사에 사용합니다. 프로젝트 전체 빌드나 전체 타입 검사가 필요한 경우에는 기존 명령을 별도로 실행하세요.

프로젝트 ESLint가 `parserOptions.project` 또는 `projectService` 등으로 타입 정보를 제공하면 이를 사용합니다. 설정하지 않았다면 TypeScript 프로젝트 서비스가 파일을 포함하는 `tsconfig.json`이나 그 참조 설정을 찾습니다. 타입 정보를 얻을 수 없는 파일은 실행 실패로 보고합니다. 의도적으로 제외한 파일은 프로젝트 ESLint의 `ignores`를 사용하고, 규칙별 예외는 해당 파일 범위에서 설정할 수 있습니다.

더 많은 타입 기반 규칙이 필요한 폴더에는 프로젝트 설정을 추가할 수 있습니다. 다음 예시는 `src`와 `packages/api/src`에서 `recommendedTypeChecked`를 사용합니다. 이 설정의 규칙 옵션은 해당 범위의 전역 기본값보다 우선합니다.

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

이 예시처럼 프로젝트 설정이 패키지를 직접 가져오는 경우 해당 패키지는 프로젝트 의존성에 포함합니다. [타입 기반 린트 설정](https://typescript-eslint.io/getting-started/typed-linting/)
