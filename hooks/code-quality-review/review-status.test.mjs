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

test('일반 문단 뒤에도 번호 목록·빈 줄·인용과 펜스의 소유 범위를 유지한다', () => {
  const cases = [
    ['plain\n2. ```text\n   code\n   ```\n', false],
    ['plain\n1. ```text\n   code\n   ```\n', true],
    ['plain\n\t\n2. ```text\n   code\n   ```\n', true],
    ['- item\n\nplain\n  ```text\n  code\n', false],
    ['- item\nplain\n  ```text\n  code\n', true],
    ['> quote\nplain\n2. ```text\n   code\n   ```\n', false],
    ['# heading\nplain\n2. ```text\n   code\n   ```\n', false],
    ['plain\n---\n2. ```text\n   code\n   ```\n', true],
  ];
  for (const status of ['clean', 'skipped', 'blocked']) {
    const marker = `[code-quality-review:${status}]`;
    for (const [prefix, expected] of cases) assert.equal(hasTerminalReviewStatus(prefix + marker), expected);
    for (const text of ['검토\t내용', '😀\tvalue', '[link](url)', '<tag>', '\\escape']) {
      assert.equal(hasTerminalReviewStatus(`${text}\n2. \`\`\`text\n   code\n   \`\`\`\n${marker}`), false);
    }
  }
});

test('LF·CRLF가 섞여도 빈 줄·목록·펜스의 종료 판정을 유지한다', () => {
  for (const status of ['clean', 'skipped', 'blocked']) {
    for (const [prefixes, expected] of [[openFencePrefixes, false], [terminalPrefixes, true]]) {
      for (const prefix of prefixes) {
        const lines = prefix.replaceAll('\r\n', '\n').split('\n');
        for (const style of ['lf', 'crlf', 'mixed']) {
          const message = lines.map((line, index) => line + (index === lines.length - 1 ? ''
            : style === 'crlf' || (style === 'mixed' && index % 2) ? '\r\n' : '\n')).join('');
          assert.equal(hasTerminalReviewStatus(message + `[code-quality-review:${status}]`), expected,
            JSON.stringify({ prefix, style, status }));
        }
      }
    }
  }
});

test('개행 앞의 CR 하나만 제거하고 줄 내부의 CR과 유니코드 줄 문자는 보존한다', () => {
  for (const status of ['clean', 'skipped', 'blocked']) {
    const marker = `[code-quality-review:${status}]`;
    assert.equal(hasTerminalReviewStatus('```text\r\ncode\n```\r\n' + marker), true);
    assert.equal(hasTerminalReviewStatus('```text\ncode\n```\r\r\n' + marker), false);
    assert.equal(hasTerminalReviewStatus('```text\ncode\n```\r \n' + marker), false);
    assert.equal(hasTerminalReviewStatus('```text\ncode\n```\u2028\n' + marker), false);
    assert.equal(hasTerminalReviewStatus('text\r' + marker), false);
  }
});
