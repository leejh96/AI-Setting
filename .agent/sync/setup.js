#!/usr/bin/env node

/**
 * .agent 폴더 셋업 스크립트
 * 
 * 기능:
 * 1. .agent → .claude, .gemini 심볼릭 링크 생성
 * 2. GEMINI.md, CLAUDE.md 컴파일 (참조 내용 임베딩)
 * 3. Copilot instructions 컴파일
 * 
 * 사용법: npm run agent:setup
 * 
 * 지원 플랫폼: macOS, Windows, Linux
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = process.cwd();
const AGENT_DIR = path.join(ROOT_DIR, '.agent');
const TEMPLATES_DIR = path.join(AGENT_DIR, 'sync', 'templates');

// 색상 출력
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function isWindows() {
  return process.platform === 'win32';
}

/**
 * 심볼릭 링크 생성 (크로스 플랫폼)
 */
function createSymlink(source, target, isDirectory = true) {
  const absoluteSource = path.resolve(source);
  const absoluteTarget = path.resolve(target);

  // 기존 링크/폴더 있으면 처리
  if (fs.existsSync(absoluteTarget)) {
    const stats = fs.lstatSync(absoluteTarget);
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(absoluteTarget);
      log(`  기존 심볼릭 링크 제거: ${path.basename(target)}`, 'dim');
    } else {
      // 심볼릭 링크가 아닌 실제 폴더가 존재하면 백업하지 않고 경고만 (사용자 확인 필요)
      log(`  ⚠️  ${path.basename(target)} 이미 존재함 - 건너뜀`, 'yellow');
      return false;
    }
  }

  try {
    if (isWindows()) {
      // Windows: mklink /J (Junction) - 관리자 권한 불필요
      if (isDirectory) {
        execSync(`mklink /J "${absoluteTarget}" "${absoluteSource}"`, {
          shell: 'cmd.exe',
          stdio: 'pipe'
        });
      }
    } else {
      // macOS/Linux: 상대 경로 심볼릭 링크
      const relativePath = path.relative(path.dirname(absoluteTarget), absoluteSource);
      fs.symlinkSync(relativePath, absoluteTarget, isDirectory ? 'dir' : 'file');
    }
    return true;
  } catch (error) {
    log(`  ❌ 링크 생성 실패: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Markdown 파일 컴파일 (GEMINI.md, CLAUDE.md)
 * @.agent/... 참조를 실제 파일 내용으로 변환
 */
function compileMarkdownFiles() {
  const files = ['GEMINI.md', 'CLAUDE.md'];

  for (const file of files) {
    const source = path.join(TEMPLATES_DIR, file);
    const target = path.join(ROOT_DIR, file);

    if (!fs.existsSync(source)) {
      log(`  ⚠️  템플릿 없음: ${file}`, 'yellow');
      continue;
    }

    let content = fs.readFileSync(source, 'utf-8');

    // 헤더 메시지 수정
    content = content.replace(
      '이 파일은 `.agent` 폴더를 가리키는 포인터입니다',
      '이 파일은 `.agent/` 규칙이 컴파일된 결과물입니다'
    );
    content = content.replace(
      '직접 수정하지 마세요. `.agent/` 내용을 수정하세요.',
      '직접 수정하지 마세요. `.agent/` 수정 후 `npm run agent:setup`을 실행하세요.'
    );

    // 라인별로 처리하여 참조(@path) 치환
    const lines = content.split('\n');
    const processedLines = lines.map(line => {
      // 매치 패턴: "See @.agent/..." 또는 단순 "@.agent/..."
      if (!line.includes('@.agent/')) return line;

      const match = line.match(/@(\.agent\/[^\s]+)/);
      if (!match) return line;

      const relativePath = match[1].replace(/['")]$/, ''); // 끝에 붙은 따옴표나 괄호 제거
      const absolutePath = path.join(ROOT_DIR, relativePath);

      if (fs.existsSync(absolutePath)) {
        log(`    Embedding: ${relativePath}`, 'dim');
        const fileContent = fs.readFileSync(absolutePath, 'utf-8');
        // 마크다운 인용구(>) 안에 있으면 제거하거나 처리해야 하지만 일단 원본 삽입
        return `\n<!-- Content from ${relativePath} -->\n${fileContent}\n<!-- End of ${relativePath} -->\n`;
      } else {
        log(`    ⚠️  File not found: ${relativePath}`, 'yellow');
        return line;
      }
    });

    const finalContent = processedLines.join('\n');
    fs.writeFileSync(target, finalContent);
    log(`  ✅ ${file} 컴파일 완료 (컨텐츠 포함됨)`, 'green');
  }
}



/**
 * 메인 실행
 */
function main() {
  console.log('');
  log('🚀 .agent 셋업 시작', 'cyan');
  console.log('');

  // .agent 폴더 존재 확인
  if (!fs.existsSync(AGENT_DIR)) {
    log('❌ .agent 폴더가 없습니다!', 'red');
    process.exit(1);
  }

  // 1. 심볼릭 링크 생성 (선별적)
  log('📁 심볼릭 링크 생성 (sync 폴더 제외)', 'cyan');

  // 링크할 항목들 (폴더 및 파일)
  const itemsToLink = [
    'rules', 'skills', 'workflows', 'agents', 'prompts', 'mcp', 'profiles',
    'config.yaml', 'README.md'
  ];

  // 타겟 디렉토리들
  const targetDirs = ['.claude', '.gemini'];

  for (const targetDirName of targetDirs) {
    const targetDirPath = path.join(ROOT_DIR, targetDirName);

    // 1) 기존 심볼릭 링크(폴더 전체)라면 삭제, 아니면 폴더 생성
    if (fs.existsSync(targetDirPath)) {
      const stats = fs.lstatSync(targetDirPath);
      if (stats.isSymbolicLink()) {
        fs.unlinkSync(targetDirPath); // 기존 전체 링크 제거
        fs.mkdirSync(targetDirPath);  // 일반 폴더로 재생성
        log(`  🔄 ${targetDirName} (심볼릭 링크 해제 및 폴더 생성)`, 'dim');
      }
    } else {
      fs.mkdirSync(targetDirPath);
    }

    // 2) 내부 항목들 개별 링크 생성
    let linkedCount = 0;
    for (const item of itemsToLink) {
      const sourcePath = path.join(AGENT_DIR, item);
      const targetPath = path.join(targetDirPath, item);

      // 소스가 존재할 때만 링크
      if (fs.existsSync(sourcePath)) {
        const stats = fs.lstatSync(sourcePath);
        const isDirectory = stats.isDirectory();

        if (createSymlink(sourcePath, targetPath, isDirectory)) {
          linkedCount++;
        }
      }
    }
    log(`  ✅ ${targetDirName} 구성 완료 (${linkedCount}개 항목 링크)`, 'green');
  }

  console.log('');

  // 2. 파일 컴파일 (CLAUDE.md, GEMINI.md)
  log('📄 컨텍스트 파일 컴파일', 'cyan');
  compileMarkdownFiles();

  console.log('');

  // 3. Copilot instructions 동기화 (외부 스크립트 실행)
  log('📝 Copilot Instructions 동기화', 'cyan');
  try {
    execSync('node .agent/sync/sync-copilot.js', { stdio: 'inherit' });
  } catch (error) {
    log('❌ Copilot 동기화 실패', 'red');
  }

  console.log('');

  // 결과 출력
  log('='.repeat(50), 'dim');
  console.log('');
  log('✨ 셋업 완료!', 'green');
  console.log('');
  log('생성/업데이트된 파일:', 'cyan');
  log('  .claude/          → 선별적 링크 (sync 제외)', 'dim');
  log('  .gemini/          → 선별적 링크 (sync 제외)', 'dim');
  log('  GEMINI.md         → 규칙이 통합된 컨텍스트 파일', 'dim');
  log('  CLAUDE.md         → 규칙이 통합된 컨텍스트 파일', 'dim');
  log('  COPILOT.md        → 규칙이 통합된 컨텍스트 포인터', 'dim');
  log('  .github/copilot-instructions.md', 'dim');
  console.log('');
  log('이제 CLI나 AI 도구들이 이 파일들의 내용을 직접 읽을 수 있습니다.', 'reset');
  console.log('');
}

main();
