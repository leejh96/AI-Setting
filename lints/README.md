# JavaScript·TypeScript 전역 ESLint

공통 실행기와 설정은 각 도구의 사용자 디렉터리에 설치합니다. Codex는 `$CODEX_HOME/lints/`(기본값 `~/.codex/lints/`), Antigravity는 `~/.gemini/lints/`의 실행기를 Stop 검토에서 사용합니다. 전역 ESLint에는 Node.js 22.13 이상인 22.x 또는 24 이상이 필요합니다. 설치와 검토 지침 갱신은 [Windows](../hooks/code-quality-review/README.windows.md#실행-파일과-공통-린트-설정-복사)와 [macOS](../hooks/code-quality-review/README.macos.md#실행-파일과-공통-린트-설정-복사) 안내를 따릅니다.

| 파일 | 전역 규칙 |
| --- | --- |
| `.js`, `.jsx`, `.mjs`, `.cjs` | `@eslint/js` 권장 규칙과 `eqeqeq`, `no-self-compare`, 처리되지 않은 Promise |
| `.ts`, `.tsx`, `.mts`, `.cts` | `@eslint/js`와 `typescript-eslint` 권장 규칙, `eqeqeq`, `no-self-compare`, TypeScript 타입 오류, 처리되지 않은 Promise. `no-var`는 TypeScript 호환 설정에서 적용합니다. |

프로젝트 루트에서 직접 검사할 수 있습니다. 아래는 기본 Codex 홈을 사용한 예시입니다. Antigravity에서는 실행기 경로를 `$HOME/.gemini/lints/lint.mjs`로 바꿉니다. 파일은 하나 이상 지정합니다. 상대 경로는 첫 번째 인자인 프로젝트 루트를 기준으로 합니다.

```sh
node "$HOME/.codex/lints/lint.mjs" "." "src/app.ts" "scripts/build.js"
```

실행 결과는 위반 없이 검사했으면 0, 린트·타입 오류가 있으면 1, 설정·파일 경로·파싱 오류 등으로 검사를 완료할 수 없으면 2입니다. 파일별 파서 또는 규칙 실행이 실패해도 다른 파일에서 수집한 진단을 출력합니다.

## 프로젝트 규칙과 예외

별도 설정이 필요할 때 프로젝트의 `eslint.config.*`에 추가합니다. 실행기는 프로젝트 안에서 각 검사 파일에 가장 가까운 ESLint 10 플랫 설정을 찾아 전역 규칙 뒤에 적용합니다. 재정의한 규칙과 제외 패턴은 해당 파일에만 영향을 줍니다. 프로젝트 고유 플러그인이 있다면 프로젝트 설정에서 불러옵니다. [ESLint 설정 파일](https://eslint.org/docs/latest/use/configure/configuration-files)

```js
export default [
  { ignores: ['**/generated/**'] },
  { files: ['src/**/*.{js,ts}'], rules: { 'no-console': 'error' } },
  { files: ['scripts/**/*.{js,mjs,cjs}'], languageOptions: { globals: { console: 'readonly', process: 'readonly' } } },
  { files: ['scripts/**/*.js'], rules: { eqeqeq: 'off' } },
];
```

## 처리되지 않은 Promise 검사

JS·TS 모두 `save()`가 반환한 Promise를 처리하지 않으면 검사에서 오류로 보고합니다. `void save()`만 붙여도 오류입니다. JS는 가까운 `tsconfig.json` 또는 `jsconfig.json`에 직접 포함되거나 `import`를 통해 포함되면 해당 설정을 사용합니다. 프로젝트 참조는 TypeScript가 허용하는 경우 소스에서 타입을 읽으므로 선언 파일을 미리 빌드할 필요가 없습니다. 설정에 속하지 않는 JS는 검사 대상과 가져온 모듈에서 타입을 추론합니다. 동적 호출처럼 반환 타입을 알아낼 수 없거나 `forEach(async () => …)`처럼 콜백이 Promise를 반환하는 유형은 이 규칙만으로 잡지 못할 수 있습니다.

프로젝트 ESLint가 `parserOptions.project` 또는 `projectService` 등으로 타입 정보를 제공하면 이를 우선 사용합니다. 상대 `project` 경로와 `projectService`의 `allowDefaultProject`·상대 `defaultProject`는 해당 ESLint 설정이 있는 디렉터리를 기준으로 해석합니다. 경로를 지정하지 않은 자동 탐색은 기본적으로 전역 실행기에 전달한 프로젝트 루트까지 설정을 찾습니다. `tsconfigRootDir`를 명시했다면 그 값이 우선합니다.

기본 JS 파서인 Espree는 명시적으로 지정해도 전역 실행기가 타입 정보를 연결하고, JS의 전역 변수와 ECMAScript 버전은 프로젝트의 ESLint 설정을 따릅니다. Espree가 읽을 수 있는 구형 문법을 타입 파서가 읽지 못하면 기본 린트 진단과 타입 검사 실패를 함께 출력합니다. 다른 파서를 지정한 경우 그 파서가 `no-floating-promises`에 필요한 타입 정보를 제공해야 합니다. 파일별 제외나 규칙 옵션은 프로젝트 ESLint에서 지정할 수 있습니다.

## TypeScript 기본 검사

TS 파일은 `const value: number = 'text'` 같은 타입 오류도 검사합니다. 별도 타입 설정이 없으면 TypeScript 프로젝트 서비스가 파일을 포함하는 `tsconfig.json`이나 그 참조 설정을 찾습니다. 타입 정보를 얻을 수 없는 TS 파일은 실행 실패로 보고합니다. 오류는 검사 대상 파일 기준으로 보고하므로 프로젝트 전체 검사가 필요할 때는 기존 타입 검사나 빌드 명령을 별도로 실행하세요.

`tsconfig`에 의도적으로 포함하지 않은 도구 스크립트는 해당 파일에만 두 타입 규칙을 끄고 기본 린트를 계속 적용할 수 있습니다. 프로젝트 ESLint가 타입 정보 옵션을 직접 설정한다면 그 옵션도 실제 타입 검사 대상에만 적용하세요.

```js
export default [{
  files: ['tools/**/*.ts'],
  rules: {
    'ai-setting/typescript-diagnostics': 'off',
    '@typescript-eslint/no-floating-promises': 'off',
  },
}];
```

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

CI는 macOS와 Windows에서 `npm --prefix lints test`를 실행합니다. 로컬에서 같은 테스트를 실행하려면 먼저 `npm --prefix lints ci --ignore-scripts --no-audit --no-fund`로 의존성을 설치하세요.
