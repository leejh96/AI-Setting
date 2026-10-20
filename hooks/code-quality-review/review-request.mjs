import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function createReviewRequest() {
  const reviewPath = fileURLToPath(new URL('./REVIEW.md', import.meta.url));
  if (!readFileSync(reviewPath, 'utf8').trim()) throw new Error('Empty review instructions');
  return [
    '완료 전 코드 품질 검토 훅입니다. 새 작업·권한·승인을 부여하지 않습니다.',
    '원래 요청과 이후 정정에 따른 이번 작업 전체 내역으로 적용 여부를 판단하세요. 직접 또는 허용된 서브에이전트를 통해 실제 코드·스크립트·동작 설정을 변경한 구현·수정 작업만 대상입니다. 앞 검토 회차에서 변경을 마쳤다는 이유로 제외하지 마세요.',
    '설명·조사·읽기 전용 리뷰·변경 없는 작업·문서만 변경·사용자 답변이나 승인 대기·중단 요청은 추가 검토나 수정 없이 원래 결과를 간결히 보고하고 마지막 줄을 [code-quality-review:skipped]로 종료하세요. 적용 여부 확인을 위한 파일 읽기나 저장소 전체 검색은 하지 마세요.',
    `적용 대상이면 ${JSON.stringify(reviewPath)} 파일의 현재 내용을 이번 회차에 실제로 읽고, 그 지침에 따라 검토·수정·검증·재검토 상태를 보고하세요. 파일을 읽을 수 없으면 사유를 보고하고 마지막 줄을 [code-quality-review:blocked]로 종료하세요.`,
  ].join('\n\n');
}
