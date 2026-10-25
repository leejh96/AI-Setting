# 추가 훅 최적화 후보: 실행기와 종료 표식

2026-10-26, 기준 커밋 `6d285e6`의 코드를 임시 폴더로 복사해 비교했다. 실행기와 전역 훅 설정은 유지하고, 종료 표식 판별의 목록 이어쓰기 검사만 제한하는 후보를 반영한다.

## 질문과 제약

- Windows 감시 준비의 PowerShell 시작 비용을 더 줄일 수 있는가?
- 종료 표식 검사에서 마지막 줄을 먼저 추출하면 비용이 줄어드는가?
- 열린 목록이 없을 때도 수행하는 이어쓰기 판별을 생략할 수 있는가?
- 감시 프로세스가 살아 있는 동안 부모의 출력 파이프가 닫혀야 한다. 창 숨김, 경로·인자·환경 전달, 변경 감지와 기존 실패 정책을 유지해야 한다.

바깥 Antigravity 실행기의 기존 최적화는 [이전 조사](../hook-launch-overhead/02-research.md)에 기록되어 있다. 이번에는 그 안에서 감시 프로세스를 띄우는 실행기를 비교했다.

## 환경과 근거

- Windows, Node.js `24.14.0`, Windows PowerShell `5.1.26100.9711`, `pwsh` `7.6.5`에서 측정했다. CLR은 `4.0.30319.42000`, .NET Framework Release 값은 `533509`였다. 설치·업그레이드는 하지 않았다.
- Context7의 `/websites/learn_microsoft_en-us_dotnet_framework`를 먼저 조회했다. 결과가 UI Automation 예제 위주여서 필요한 프로세스 실행 계약은 Microsoft API 참조로 보완했다.
- [ProcessStartInfo.UseShellExecute](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.useshellexecute?view=netframework-4.8.1): 운영체제 셸 실행과 직접 실행의 차이, 표준 입출력 리디렉션 제약을 확인했다.
- [ProcessWindowStyle](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processwindowstyle?view=net-5.0): `Hidden`과 `UseShellExecute=true`의 조합을 확인했다. 이를 .NET 8 이후의 직접 실행 시 창 스타일 지원과 혼동하지 않는다.
- [Process.Close](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.close?view=netframework-4.8.1): `Dispose`가 `Close`를 호출해 프로세스 핸들 등 관리 자원을 해제하는 계약을 확인했다. 실제 자식 프로세스의 생존은 별도 시험했다.
- [WorkingDirectory](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.workingdirectory?view=netframework-4.8.1), [Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1): 작업 폴더와 인자 문자열 전달을 비교했다.
- [PowerShell intrinsic members](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_intrinsic_members?view=powershell-7.5): `::new()`는 PowerShell 5.0부터 지원한다. .NET 후보는 현재 5.1에서 직접 실행해 확인했다.
- [Windows start](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/start): `/b`는 새 Command Prompt 창을 열지 않는 옵션이다. 출력 파이프의 독립 종료까지 보장하는 옵션으로 해석하지 않는다.

## 실제 측정

### 감시 준비

서로 다른 임시 복사본을 같은 Git 저장소에서 번갈아 실행하고 각 실행 뒤 감시를 종료했다. 아래 값은 각각 5회 중앙값이다. Git 조회, Windows 실행기, 새 감시와 준비 확인을 포함하며 모델·앱 UI의 응답 시간은 포함하지 않는다.

| 후보 | 기존 실행기 | 후보 실행기 | 판정 |
| --- | ---: | ---: | --- |
| `powershell.exe` → 설치된 `pwsh.exe` | 862.8ms | 970.7ms | 느려져 보류 |
| `Start-Process` → 같은 PowerShell의 .NET API 직접 호출 | 880.2ms | 892.3ms | 개선 근거 없음 |

.NET 후보는 `ProcessStartInfo`에 파일·인자·작업 폴더, `UseShellExecute=true`, `WindowStyle=Hidden`을 지정하고 `Process.Start(...).Dispose()`를 호출했다. 두 후보 모두 바깥 Windows PowerShell의 출력 수집 종료 후 감시가 살아 있음을 확인했다. 파이프 계약은 통과했지만 속도 이점이 없었다.

### cmd의 출력 수집

단순 ASCII 절대 경로에서 `cmd.exe /d /s /c start /b ...`로 1초 뒤 종료하는 합성 Node 프로세스를 실행했다. 출력은 부모에서 수집했다.

| 명령 | 부모 실행·출력 수집 종료 시간 | 자식 실행·종료 확인 |
| --- | ---: | --- |
| 기본 `/b` 실행 | 1122.7ms | 확인 |
| `>nul 2>&1 <nul` 추가 | 1106.6ms | 확인 |

관찰된 사실은 부모의 출력 수집이 자식 수명 동안 끝나지 않았다는 점이다. 내부 핸들의 정확한 상속 경로를 계측한 것은 아니다. 장기 감시를 띄운 뒤 부모 출력이 독립적으로 끝나야 하는 현재 계약의 대안으로 채택하지 않는다. 창을 열지 않는 옵션과 출력 파이프 독립성은 별도로 판단한다.

### 종료 표식의 마지막 줄 추출

현재의 끝에 고정된 정규식 검사 대신 `lastIndexOf('\n')`·`slice`로 마지막 줄을 추출하고 검사하는 후보를 비교했다. 공통 판별 함수를 그대로 사용했으며 입력별로 순서를 교차한 11회 측정의 중앙값이다.

| 입력 | 기존 | 후보 |
| --- | ---: | ---: |
| 짧은 정상 표식 | 0.003136ms | 0.002706ms |
| 긴 정상 표식 | 0.790559ms | 0.825242ms |
| 긴 revised 응답 | 0.000040ms | 0.000082ms |
| 긴 무표식 응답 | 0.000037ms | 0.000079ms |
| 1MiB 단일 줄의 revised 응답 | 0.000044ms | 0.312477ms |

아주 작은 시간 값은 실행 환경·타이머 해상도에 민감하다. 정규식 엔진의 내부 최적화는 조사하지 않았다. 관찰상 기존의 거부 경로가 충분히 저렴하며 새 줄 탐색은 긴 단일 줄에서 비용을 늘렸다. 이 후보도 적용하지 않는다.

### 목록 밖에서의 이어쓰기 판별

이어쓰기 여부는 기존 목록의 들여쓰기 경계를 처리하는 `while`에서만 사용한다. 열린 목록이 없거나 현재 줄의 들여쓰기가 기존 목록 이상이면 해당 `while`에 진입하지 않는다. 이때는 `interruptsParagraph`의 정규식·코드 펜스 검사를 호출하지 않아도 이후의 목록 시작·펜스 판정과 문단 상태는 그대로 계산된다. 해당 함수들은 상태를 변경하지 않는다.

먼저 `listIndents.length > 0` 조건만 추가한 후보를 비교했다. 각 입력은 순서를 교차한 11회 측정의 중앙값이며 실행기·모델 시간은 포함하지 않는다.

| 입력 | 기존 | 후보 |
| --- | ---: | ---: |
| 일반 문단 2만 줄 | 0.796ms | 0.799ms |
| 목록 밖 들여쓴 문단 2만 줄 | 8.938ms | 6.297ms |
| 목록 밖 강조 문단 2만 줄 | 7.407ms | 5.018ms |
| 설명·코드 블록 3천 묶음 | 1.707ms | 1.508ms |
| 목록·이어쓰기 1만 묶음 | 9.104ms | 9.150ms |

일반 문단과 목록 내부의 차이는 작고, 목록 밖 특수 문장의 반복에서는 개선이 관찰됐다. 이어서 `indent < listIndents.at(-1)`도 검사해, 목록 내부에서 들여쓰기 경계를 벗어나지 않는 줄의 불필요한 계산을 생략했다.

| 입력 | 기존 | 목록 조건만 추가 | 목록·들여쓰기 조건 추가 |
| --- | ---: | ---: | ---: |
| 목록·이어쓰기 1만 묶음 | 9.523ms | 9.804ms | 8.349ms |
| 목록 밖 들여쓴 문단 2만 줄 | 8.459ms | 6.312ms | 6.265ms |
| 중첩 목록·문단 전환 3천 묶음 | 5.979ms | 4.952ms | 4.080ms |

최종 후보는 목록·들여쓰기 조건을 함께 적용한다. 원래 `while`에 진입하는 경우에는 기존 계산을 그대로 하고, 진입하지 않는 경우에만 사용하지 않을 계산을 생략한다. 문단 뒤의 `1.`·`2.` 목록 시작, 빈 줄 이후의 목록, 열린·닫힌 펜스와 세 종료 표식의 판정을 회귀 검사한다.

## 검증

- 최종 공통 판별 테스트 14개가 통과했다. 긴 들여쓰기·강조 문단 뒤의 `1.`·`2.` 목록, 빈 줄, 열린·닫힌 코드 펜스와 세 종료 상태를 검사했다.
- 기준 커밋과 최종 목록·들여쓰기 조건의 LF·CRLF·중첩 목록·인용·펜스·손상 표식 등 253,009가지 입력 비교에서 종료 판정이 같았다.
- Codex·Antigravity 어댑터 전체 실행은 53개 통과, OS 조건의 2개 제외였다. 최종 조건 조정 뒤에는 두 실제 훅의 펜스 종료 통합 테스트 2개를 추가로 재실행해 통과했다.
- 기존 감시·실행기·전역 등록을 수정하지 않았다. 변경 범위와 `git diff --check`도 확인했다.

## 결론과 남은 범위

- 실행기 교체 세 후보와 마지막 줄 추출 후보는 반영하지 않는다. 목록 이어쓰기 판별의 적용 조건만 제한한다.
- 실행기·전역 설정·코드리뷰 정책·지원 버전은 유지한다. 임시 복사본과 합성 입력은 정리했다. cmd 인자 실험 뒤의 확인에서 해당 실험용 고유 임시 경로를 참조하는 프로세스는 0개였다.
- 실제 Codex·Antigravity UI, 새 모델 대화, 다른 Windows 버전, macOS·Linux는 이번 실험 범위가 아니다. API 문서만으로 실제 앱의 핸들 상속을 확인했다고 주장하지 않는다.
- 다음 조사는 다른 반복 I/O·할당 비용을 대상으로 한다. 같은 실행기 후보는 새로운 근거가 생기기 전까지 반복하지 않는다.

리뷰어 판단 기준: 단순 API 교체나 새 실행기 선택만으로 성능 개선을 가정하지 않는다. 실행기 후보는 보류하고, 목록이 있을 때의 이어쓰기 계산과 실제 펜스·종료 판정은 유지한다.
