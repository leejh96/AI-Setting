import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasTerminalReviewStatus } from './review-status.mjs';

const openFencePrefixes = ['```text\n', '~~~text\n', '   ```text\r\n',
  '````text\n```\n', '~~~text\n```\n', '```text\n```not-a-close\n',
  '```text\n    ```\n', '- item\n\n```text\n',
  '- item\n\n# heading\n   ```text\n', '- item\n\ntext\n   ```text\n',
  '* * *\n  ```text\n', '- - -\n  ~~~text\n'];
const terminalPrefixes = ['', '```text\nexample\n```\n', '~~~text\nexample\n~~~~\n',
  '   ```text\r\nexample\r\n ```\t\r\n', '```not `a fence`\n', '    ```text\n',
  '- ```text\n  example\n  ```\n\n', '1. ~~~text\n   example\n   ~~~\n\n',
  '- item\n  ```text\n  example\n  ```\n\n', '- ```text\n  example\n\n',
  '- item\n  ~~~text\n  example\n\n', '> ```text\n> example\n> ```\n\n',
  '> ```text\n> example\n\n', '- item\nlazy continuation\n  ```text\n  example\n\n',
  '* * *\n  ```text\nexample\n  ```\n', '- - -\n  ~~~text\nexample\n  ~~~\n'];

for (const status of ['clean', 'skipped', 'blocked']) {
  const marker = `[code-quality-review:${status}]`;
  test(`열린 코드 펜스의 ${status} 표식은 종료로 인정하지 않는다`, () => {
    for (const prefix of openFencePrefixes) {
      assert.equal(hasTerminalReviewStatus(prefix + marker), false, JSON.stringify(prefix));
    }
  });
  test(`코드 펜스 밖의 독립 ${status} 표식은 종료로 인정한다`, () => {
    for (const prefix of terminalPrefixes) {
      assert.equal(hasTerminalReviewStatus(prefix + marker), true, JSON.stringify(prefix));
    }
  });
}

test('탭이 있는 줄과 없는 줄이 섞여도 들여쓰기와 펜스 경계를 유지한다', () => {
  const cases = [
    ['\t설명😀\n```text\n', false],
    ['\t설명😀\n```text\nexample\n```\n', true],
    ['```text\n\t```\n', false],
    ['- item\n\t```text\n\texample\n\t```\n\n', true],
    ['```text\n설명😀\t값\t예시\n```\t\t\n', true],
    ['```text\n\t```\t\t\n', false],
    ['- \t```text\n\t설명😀\t값\n\t```\t\t\n\n', true],
    ['- item\n\t~~~\ttext\n\t예시\t😀\n\t~~~\t\t\n\n', true],
  ];
  for (const status of ['clean', 'skipped', 'blocked']) {
    for (const [prefix, expected] of cases) {
      assert.equal(hasTerminalReviewStatus(prefix + `[code-quality-review:${status}]`), expected, JSON.stringify(prefix));
    }
  }
});

test('긴 일반 응답에서도 마지막 독립 표식과 열린 펜스를 구분한다', () => {
  const body = '일반 검토 내용과 설명입니다.\n'.repeat(20000);
  for (const status of ['clean', 'skipped', 'blocked']) {
    const marker = `[code-quality-review:${status}]`;
    assert.equal(hasTerminalReviewStatus(body + marker), true);
    assert.equal(hasTerminalReviewStatus(body + '```text\n' + marker), false);
  }
});

test('최상위 코드 펜스는 선행 탭·공백과 후행 탭을 구분해 닫는다', () => {
  const cases = [
    ['```text', '```\t\t', true],
    ['```text', ' ``` \t', true],
    ['```text', '   ````\t', true],
    ['```text', '    ```', false],
    ['```text', '\t```', false],
    ['```text', ' \t```', false],
    ['```text', '```\ttext', false],
    ['```text', '~~~\t', false],
    ['````text', '```\t', false],
    ['~~~text', '  ~~~~\t\t', true],
    ['~~~text', '  \t~~~', false],
  ];
  for (const status of ['clean', 'skipped', 'blocked']) {
    for (const [opener, closer, expected] of cases) {
      assert.equal(hasTerminalReviewStatus(`${opener}\n\tcode\tvalue\n\n${closer}\n[code-quality-review:${status}]`), expected);
    }
  }
});

test('긴 탭 포함 코드 블록에서도 열린 펜스의 표식은 거부하고 닫힌 뒤의 표식만 인정한다', () => {
  const body = '\tconst value\t=\t42;\n'.repeat(20000);
  for (const status of ['clean', 'skipped', 'blocked']) {
    const marker = `[code-quality-review:${status}]`;
    assert.equal(hasTerminalReviewStatus('```js\n' + body + marker), false);
    assert.equal(hasTerminalReviewStatus('```js\n' + body + '```\t\n' + marker), true);
  }
});
