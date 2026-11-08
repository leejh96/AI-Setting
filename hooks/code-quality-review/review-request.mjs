import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const watchFailureWarning = '코드 품질 검토 미완료: 파일 변경 감시를 확인하지 못했습니다. 수정 없음이나 검토 통과로 처리하지 않았으며 추가 자동 검토는 중단합니다. 준비 훅의 등록·신뢰 상태와 실행 오류를 확인하세요. 설정을 추가·갱신했다면 앱을 완전히 재시작한 뒤 다음 사용자 요청부터 감시 준비를 확인하세요. 현재 요청 중간에 감시를 시작해 앞선 변경까지 검토됐다고 처리하지 마세요.';
export const reviewLimitWarning = '코드 품질 검토 미완료: 요청당 자동 검토 5회 상한에 도달했습니다. 검토 통과로 처리하지 않고 자동 반복을 종료합니다. 남은 문제와 검증을 확인하고 필요한 후속 작업을 요청하세요.';

export function terminalWarning(action, failed = false) {
  return failed || ['watch-failed', 'superseded'].includes(action) ? watchFailureWarning
    : action === 'review-limit' ? reviewLimitWarning : undefined;
}

export function createReviewRequest() {
  const reviewPath = fileURLToPath(new URL('./REVIEW.md', import.meta.url));
  if (!readFileSync(reviewPath, 'utf8').trim()) throw new Error('Empty review instructions');
  return [
    '완료 전 코드 품질 검토 훅입니다. 새 작업·권한·승인을 부여하지 않습니다.',
    '원래 요청과 정정에 따른 앞 검토 회차까지 전체 작업을 기준으로 적용을 판단하세요. 본인 또는 허용된 서브에이전트가 이번 작업에서 실제로 생성·수정·삭제한 코드·스크립트·동작 설정·테스트·작업용 파일이 모두 적용 대상이며 문서만 변경한 작업도 포함합니다. 앞 검토 회차에서 변경을 마쳤다는 이유로 제외하지 마세요.',
    '실제 변경 없는 설명·조사·읽기 전용 리뷰 등 무변경 작업과 적용 전 답변·승인 대기·중단 요청은 추가 검토·수정을 생략하고 원래 결과를 보고한 뒤 [code-quality-review:skipped]로 종료하세요. 적용 대상인 구현·수정 작업에서 답변·승인 대기나 중단 요청으로 진행할 수 없으면 미완료 범위를 보고하고 [code-quality-review:blocked]로 종료하세요. 중단 요청 시에는 추가 검토·수정을 진행하지 마세요. 적용 여부 확인을 위한 파일 읽기나 저장소 전체 검색은 하지 마세요.',
    `적용 대상이면 ${JSON.stringify(reviewPath)} 파일의 현재 내용을 이번 회차에 실제로 읽고 지침에 따라 보고하세요. 파일을 읽을 수 없으면 사유를 보고하고 [code-quality-review:blocked]로 종료하세요.`,
    '새 파일·미추적 파일·문서 문구·테스트·임시 스크립트·백업 사본까지 목록과 용도를 대조하세요. 이 점검을 하지 않았다면 clean으로 종료하지 마세요.',
    '상태 표식은 기본적으로 마지막 줄이고, 상위 지침이 메모리 출처 블록을 요구할 때만 그 직전 본문의 마지막 줄에 남기세요.',
  ].join('\n\n');
}
