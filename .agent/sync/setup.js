#!/usr/bin/env node

/**
 * .agent 폴더 셋업 스크립트
 * 
 * 기능:
 * 1. .agent → .claude, .gemini 심볼릭 링크 생성
 * 2. GEMINI.md, CLAUDE.md 컴파일 (참조 내용 임베딩)
 * 3. Copilot instructions 컴파일 (통합됨)
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
const CONFIG_FILE = path.join(AGENT_DIR, 'config.yaml');
const TEMPLATES_DIR = path.join(AGENT_DIR, 'sync', 'templates');

// Copilot 관련 경로
const GITHUB_DIR = path.join(ROOT_DIR, '.github');
const GITHUB_OUTPUT_FILE = path.join(GITHUB_DIR, 'copilot-instructions.md');
const ROOT_OUTPUT_FILE = path.join(ROOT_DIR, 'COPILOT.md');

// 디렉토리 경로 (Copilot Sync용)
const DIRS = {
  rules: path.join(AGENT_DIR, 'rules'),
  skills: path.join(AGENT_DIR, 'skills'),
  workflows: path.join(AGENT_DIR, 'workflows'),
  agents: path.join(AGENT_DIR, 'agents'),
  prompts: path.join(AGENT_DIR, 'prompts'),
};

/**
 * 간단한 YAML 파싱 (active_* 배열만 추출)
 */
function parseConfig() {
  const defaults = {
    active_rules: ['coding-conventions', 'response-style', 'project-context'],
    active_skills: ['backend-development', 'code-review', 'backend-testing', 'nestjs-expert'],
    active_workflows: ['feature-development', 'bug-fix', 'pr-review', 'refactoring'],
    active_agents: ['senior-backend', 'code-reviewer', 'tech-writer'],
    active_prompts: ['commit-message', 'pr-description', 'api-documentation'],
  };

  try {
    if (!fs.existsSync(CONFIG_FILE)) return defaults;
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = {};

    // active_rules 추출
    const rulesMatch = content.match(/active_rules:\s*\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
    if (rulesMatch) {
      config.active_rules = rulesMatch[1]
        .match(/- (\w+-\w+)/g)
        ?.map(m => m.replace('- ', '')) || defaults.active_rules;
    }

    // active_skills 추출
    const skillsMatch = content.match(/active_skills:\s*\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
    if (skillsMatch) {
      config.active_skills = skillsMatch[1]
        .match(/- (\w+-\w+)/g)
        ?.map(m => m.replace('- ', '')) || defaults.active_skills;
    }

    // active_workflows 추출
    const workflowsMatch = content.match(/active_workflows:\s*\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
    if (workflowsMatch) {
      config.active_workflows = workflowsMatch[1]
        .match(/- (\w+-\w+)/g)
        ?.map(m => m.replace('- ', '')) || defaults.active_workflows;
    }

    // active_agents 추출
    const agentsMatch = content.match(/active_agents:\s*\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
    if (agentsMatch) {
      config.active_agents = agentsMatch[1]
        .match(/- (\w+-\w+)/g)
        ?.map(m => m.replace('- ', '')) || defaults.active_agents;
    }

    // active_prompts 추출
    const promptsMatch = content.match(/active_prompts:\s*\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
    if (promptsMatch) {
      config.active_prompts = promptsMatch[1]
        .match(/- (\w+-\w+)/g)
        ?.map(m => m.replace('- ', '')) || defaults.active_prompts;
    }

    return { ...defaults, ...config };
  } catch (e) {
    return defaults;
  }
}

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
 * 1. 템플릿 로드
 * 2. config.yaml 기반으로 {{PLACEHOLDER}} 치환
 * 3. @.agent/... 참조를 실제 파일 내용으로 변환
 */
function compileMarkdownFiles(config) {
  const files = ['GEMINI.md', 'CLAUDE.md'];

  for (const file of files) {
    const source = path.join(TEMPLATES_DIR, file);
    const target = path.join(ROOT_DIR, file);

    if (!fs.existsSync(source)) {
      log(`  ⚠️  템플릿 없음: ${file}`, 'yellow');
      continue;
    }

    let content = fs.readFileSync(source, 'utf-8');

    // 1. Placeholder 치환 (Config 기반)
    if (config) {
      if (file === 'GEMINI.md') {
        // Gemini 스타일 (단순 경로 나열, 임베딩 X)
        content = content.replace('{{RULES}}', (config.active_rules || []).map(r => `- **${r}**: .gemini/rules/${r}.md`).join('\n'));
        content = content.replace('{{SKILLS}}', (config.active_skills || []).map(s => `- **${s}**: .gemini/skills/${s}/SKILL.md`).join('\n'));
        content = content.replace('{{WORKFLOWS}}', (config.active_workflows || []).map(w => `- **${w}**: .gemini/workflows/${w}.md`).join('\n'));
        content = content.replace('{{AGENTS}}', (config.active_agents || []).map(a => `- **${a}**: .gemini/agents/${a}.md`).join('\n'));
        content = content.replace('{{PROMPTS}}', (config.active_prompts || []).map(p => `- **${p}**: .gemini/prompts/${p}.md`).join('\n'));
      } else if (file === 'CLAUDE.md') {
        // Claude 스타일 (Markdown list)
        content = content.replace('{{RULES}}', (config.active_rules || []).map(r => `- **${r}**: .claude/rules/${r}.md`).join('\n'));
        content = content.replace('{{SKILLS}}', (config.active_skills || []).map(s => `- **${s}**: .claude/skills/${s}/SKILL.md`).join('\n'));
        content = content.replace('{{WORKFLOWS}}', (config.active_workflows || []).map(w => `- **${w}**: .claude/workflows/${w}.md`).join('\n'));
        content = content.replace('{{AGENTS}}', (config.active_agents || []).map(a => `- **${a}**: .claude/agents/${a}.md`).join('\n'));
        content = content.replace('{{PROMPTS}}', (config.active_prompts || []).map(p => `- **${p}**: .claude/prompts/${p}.md`).join('\n'));
      }
    }

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
      // .gemini/ 나 .claude/ 로 시작하는 경로도 처리 (심볼릭 링크)
      if (!line.includes('@') || !line.includes('/')) return line;

      // 정규식: @로 시작하고 파일 경로가 이어지는 패턴 추출
      // 예: @./.gemini/rules/project-context.md
      const match = line.match(/@([\.\/\w\-\d]+\.md)/);
      if (!match) return line;

      let relativePath = match[1];

      // 심볼릭 링크 경로(.gemini, .claude)를 .agent로 변환하여 실제 파일 찾기
      let realPath = relativePath
        .replace(/^\.\/\.gemini\//, '.agent/')
        .replace(/^[git ]*\.claude\//, '.agent/')
        .replace(/^\.claude\//, '.agent/'); // .claude/rules/...

      // config.yaml 등에서 .claude/ 로 참조하는 경우 대응
      if (realPath.includes('.claude')) realPath = realPath.replace('.claude', '.agent');
      if (realPath.includes('.gemini')) realPath = realPath.replace('.gemini', '.agent');

      const absolutePath = path.join(ROOT_DIR, realPath);

      if (fs.existsSync(absolutePath)) {
        // line 전체를 교체하지 않고, @path 부분만 교체하거나
        // GEMINI.md 처럼 라인 전체가 @path인 경우 전체 교체
        if (line.trim().startsWith('@')) {
          log(`    Embedding: ${realPath}`, 'dim');
          const fileContent = fs.readFileSync(absolutePath, 'utf-8');
          return `\n<!-- Content from ${realPath} -->\n${fileContent}\n<!-- End of ${realPath} -->\n`;
        } else {
          // CLAUDE.md 처럼 "- **Rule**: @path" 형태인 경우
          return line.replace(match[0], `(file://${absolutePath})`);
        }
      } else {
        // 기존 로직 복원 및 개선:
        return line;
      }
    });

    // 다시 작성: (기존 map 로직 중복 실행 방지 위해 위에서 처리한 것 사용)
    const finalContent = processedLines.join('\n');
    fs.writeFileSync(target, finalContent);
    log(`  ✅ ${file} 컴파일 완료`, 'green');
  }
}

/**
 * 파일 내용 로드 (Copilot용 Helper)
 */
function loadContent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * 섹션 추가 (Copilot용 Helper)
 */
function addSection(content, title, emoji, items, itemType) {
  if (!items || items.length === 0) return content;

  content += `\n---\n\n`;
  content += `# ${emoji} ${title}\n\n`;

  for (const itemName of items) {
    let filePath;

    if (itemType === 'skill') {
      filePath = path.join(DIRS.skills, itemName, 'SKILL.md');
    } else if (itemType === 'workflow') {
      filePath = path.join(DIRS.workflows, `${itemName}.md`);
    } else if (itemType === 'agent') {
      filePath = path.join(DIRS.agents, `${itemName}.md`);
    } else if (itemType === 'prompt') {
      filePath = path.join(DIRS.prompts, `${itemName}.md`);
    } else {
      // rule
      filePath = path.join(DIRS.rules, `${itemName}.md`);
    }

    const itemContent = loadContent(filePath);
    if (itemContent) {
      content += `\n---\n\n${itemContent}\n`;
      console.log(`  ✅ ${itemName}`);
    } else {
      console.log(`  ⚠️  ${itemName} (파일 없음)`);
    }
  }

  return content;
}

/**
 * 루트 포인터 파일 생성 (Copilot.md)
 */
function createRootPointer(config) {
  const templatePath = path.join(AGENT_DIR, 'sync/templates/COPILOT.md');
  const template = loadContent(templatePath);

  if (!template) {
    console.error('⚠️  템플릿 파일을 찾을 수 없습니다: ' + templatePath);
    return;
  }

  // 1. Placeholder 치환 (Config 기반) - 사용자가 요청한 내용 (Copilot.md 요약)
  // 현재 템플릿에는 placeholder가 없지만, 향후 추가된다면 여기서 처리 가능
  // 지금은 단순 포인터 파일이므로 그대로 생성

  fs.writeFileSync(ROOT_OUTPUT_FILE, template);
  console.log(`  ✅ COPILOT.md`);
}

/**
 * Copilot Instructions 동기화 실행
 */
function syncCopilotInstructions(config) {
  log('🔄 Copilot instructions 동기화 중...', 'dim');

  // .github 폴더 생성
  if (!fs.existsSync(GITHUB_DIR)) {
    fs.mkdirSync(GITHUB_DIR, { recursive: true });
  }

  let content = '# Copilot Instructions\n\n';
  content += '> ⚠️ Auto-generated from .agent/ - Do not edit directly\n';
  content += '> Run `npm run agent:setup` to sync\n\n';

  // Rules 추가
  if (config.active_rules?.length > 0) {
    console.log('  📋 Rules:');
    content = addSection(content, 'Rules', '📋', config.active_rules, 'rule');
  }

  // Skills 추가
  if (config.active_skills?.length > 0) {
    console.log('\n  🎯 Skills:');
    content = addSection(content, 'Skills', '🎯', config.active_skills, 'skill');
  }

  // Workflows 추가
  if (config.active_workflows?.length > 0) {
    console.log('\n  ⚙️  Workflows:');
    content = addSection(content, 'Workflows', '⚙️', config.active_workflows, 'workflow');
  }

  // Agents 추가
  if (config.active_agents?.length > 0) {
    console.log('\n  👤 Agents:');
    content = addSection(content, 'Agents (Personas)', '👤', config.active_agents, 'agent');
  }

  // Prompts 추가
  if (config.active_prompts?.length > 0) {
    console.log('\n  💬 Prompts:');
    content = addSection(content, 'Prompts', '💬', config.active_prompts, 'prompt');
  }

  // .github/copilot-instructions.md 생성
  fs.writeFileSync(GITHUB_OUTPUT_FILE, content);
  console.log(`\n  ✨ 생성: .github/copilot-instructions.md`);

  // 루트 COPILOT.md 생성
  createRootPointer(config);

  const totalItems = [
    config.active_rules?.length || 0,
    config.active_skills?.length || 0,
    config.active_workflows?.length || 0,
    config.active_agents?.length || 0,
    config.active_prompts?.length || 0,
  ].reduce((a, b) => a + b, 0);

  log(`  ✅ Copilot 동기화 완료 (총 ${totalItems}개 항목)`, 'green');
}

/**
 * 메인 실행
 */
function main() {
  console.log('');
  log('🚀 .agent 셋업 시작', 'cyan');
  console.log('');

  // config 로드
  const config = parseConfig();


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
  compileMarkdownFiles(config);

  console.log('');

  // 3. Copilot instructions 동기화 (내부 함수 호출)
  log('📝 Copilot Instructions 동기화', 'cyan');
  try {
    syncCopilotInstructions(config);
  } catch (error) {
    log(`❌ Copilot 동기화 실패: ${error.message}`, 'red');
    console.error(error);
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
