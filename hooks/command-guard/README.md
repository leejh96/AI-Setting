# Codex·Antigravity 터미널 명령 검사

두 도구의 `PreToolUse` 훅에서 터미널 명령이 실행되기 전에 Git 이력 변경, 삭제, 검사 우회와 권한 완화를 확인합니다. Node.js 22 이상을 사용하며 별도 패키지와 API 키는 필요하지 않습니다.

## 적용 정책

| 결과 | 예시 |
|---|---|
| Git 명령 차단 | `git push --force`, `-f`, `+refspec`, `--mirror`, `--force-with-lease`, 원격 ref 삭제, Git 훅 우회, `git clean`, `git reset --hard`, 작업 트리 전체 복원, 로컬 브랜치 강제 삭제, stash 삭제, 강제 worktree 제거 |
| 파일 명령 차단 | 재귀 삭제, `find -delete`, `rsync --delete` 계열, 재귀 `chmod 777` |
| 기존 권한 정책 적용 | 일반 `git push`, 일반 커밋, `git clean -n` 등 미리보기, 안전한 파일 작업 |

`--no-verify`와 커밋·푸시에서 `core.hooksPath`를 일회성으로 덮어쓰는 Git 옵션을 검사합니다. Windows에서는 일반적인 PowerShell `Remove-Item -Recurse`와 `rmdir /s` 형태도 검사합니다. 한 호출에 차단 대상 명령이 있으면 도구 호출 전체를 차단합니다.

두 도구 모두 실행을 차단하고 그 이유를 표시합니다. 입력 JSON이나 필수 필드를 읽지 못한 경우에도 차단 이유를 반환합니다. 명령 원문과 인자 값은 응답이나 별도 로그에 남기지 않습니다. [Codex PreToolUse](https://learn.chatgpt.com/docs/hooks#pretooluse), [Antigravity PreToolUse](https://antigravity.google/docs/hooks#pretooluse)

## 적용 범위

지원하는 터미널 도구는 Codex의 `Bash`와 Antigravity의 `run_command`입니다. 명령 문자열에 직접 적힌 명령과 옵션을 확인합니다. 따옴표로 묶인 리터럴, 일반적인 명령 연결, `git -C`를 처리합니다. 별칭, 실행되는 스크립트 내용, 셸 변수·치환으로 생성한 명령, 이미 열린 터미널에 전송되는 입력, 다른 도구의 파일 변경까지 검사하려면 해당 실행 경로에도 별도 권한 제한이 필요합니다. 훅 실행 자체의 실패나 시간 초과 시에는 호스트 동작에 따라 명령이 통과할 수 있습니다.

정상 푸시의 실제 원격 목적지나 배포 영향은 조회하지 않습니다. 운영 DB와 Terraform 명령은 서비스 쪽 권한과 승인으로 관리하고, 보호 브랜치의 강제 푸시·삭제 제한은 원격에도 설정합니다.

## 설치 및 검증

- [macOS 설치 안내](README.macos.md)
- [Windows 설치 안내](README.windows.md)

저장소 루트에서 `node --test hooks/command-guard/command-guard.test.mjs`를 실행합니다. 테스트는 명령을 문자열로 검사하고 두 어댑터에 가짜 훅 입력을 전달합니다.
