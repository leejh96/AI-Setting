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
  commands: path.join(AGENT_DIR, 'commands'),
};

/**
 * 디렉토리에서 항목 목록 추출
 * @param {string} dirPath - 디렉토리 경로
 * @param {boolean} isDir - 디렉토리만 찾을지 여부 (Skills 등)
 * @returns {Array} 항목 이름 배열 (확장자 제외)
 */
function getListFromDir(dirPath, isDir = false) {
  if (!fs.existsSync(dirPath)) return [];

  return fs.readdirSync(dirPath)
    .filter(file => {
      // 숨김 파일 제외
      if (file.startsWith('.')) return false;

      const fullPath = path.join(dirPath, file);
      try {
        const stats = fs.statSync(fullPath);
        if (isDir) {
          // 디렉토리 모드: 디렉토리이면서 내부에 SKILL.md 등이 있는지 확인
          return stats.isDirectory();
        } else {
          // 파일 모드: .md 파일만 대상
          return stats.isFile() && file.endsWith('.md');
        }
      } catch (e) {
        return false;
      }
    })
    .map(file => path.parse(file).name)
    .sort(); // 알파벳순 정렬
}

/**
 * 설정 로드 (파일 시스템 우선)
 */
function parseConfig() {
  const defaults = {
    active_rules: [],
    active_skills: [],
    active_workflows: [],
    active_agents: [],
    active_commands: [],
  };

  try {
    // 1. 파일 시스템에서 동적 탐색 (Source of Truth)
    const dynamicConfig = {
      active_rules: getListFromDir(DIRS.rules),
      active_skills: getListFromDir(DIRS.skills, true), // Skills는 디렉토리
      active_workflows: getListFromDir(DIRS.workflows),
      active_agents: getListFromDir(DIRS.agents),
      active_commands: getListFromDir(DIRS.commands),
    };

    // 2. config.yaml에서 추가 설정(ignore 등)이 있다면 읽을 수 있겠지만,
    // 현재 요구사항은 "삭제할거 삭제했으니 반영해달라"이므로 파일 시스템이 우선.

    // 로깅
    // console.log('Detected configuration:');
    // console.log(dynamicConfig);

    return { ...defaults, ...dynamicConfig };
  } catch (e) {
    log('⚠️  설정 탐색 실패 - 기본값 사용', 'yellow');
    log(`   오류: ${e.message}`, 'dim');
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
  const files = ['GEMINI.md', 'CLAUDE.md', 'AGENTS.md'];

  for (const file of files) {
    const source = path.join(TEMPLATES_DIR, file);
    const target = path.join(ROOT_DIR, file);

    if (!fs.existsSync(source)) {
      log(`  ⚠️  템플릿 없음: ${file}`, 'yellow');
      continue;
    }

    let content = fs.readFileSync(source, 'utf-8');

    // 1. Placeholder 치환 (Config 기반)
    // 1. Placeholder 치환 (Config 기반)
    if (config) {
      // 1) Rules: 내용 직접 임베딩 (@구문 사용 -> Source of Truth인 .agent 사용)
      // (@로 시작하면 아래 로직에서 파일 내용을 읽어와 교체함)
      const embedRules = (list) => (list || []).map(r => `### ${r}\n\n@.agent/rules/${r}.md`).join('\n\n');
      content = content.replace('{{RULES}}', embedRules(config.active_rules));

      // 2) Others: 경로만 링크 (각 환경별 심볼릭 링크 폴더 사용)
      let linkPrefix = '.agent';
      if (file === 'GEMINI.md') linkPrefix = '.gemini';
      else if (file === 'CLAUDE.md') linkPrefix = '.claude';
      else if (file === 'AGENTS.md') linkPrefix = '.opencode';

      const listSkills = (list) => (list || []).map(s => `- **${s}**: ${linkPrefix}/skills/${s}/SKILL.md`).join('\n');
      const listWorkflows = (list) => (list || []).map(w => `- **${w}**: ${linkPrefix}/workflows/${w}.md`).join('\n');
      const listAgents = (list) => (list || []).map(a => `- **${a}**: ${linkPrefix}/agents/${a}.md`).join('\n');
      const listCommands = (list) => (list || []).map(c => `- **${c}**: ${linkPrefix}/commands/${c}.md`).join('\n');

      content = content.replace('{{SKILLS}}', listSkills(config.active_skills));
      content = content.replace('{{WORKFLOWS}}', listWorkflows(config.active_workflows));
      content = content.replace('{{AGENTS}}', listAgents(config.active_agents));
      content = content.replace('{{COMMANDS}}', listCommands(config.active_commands));
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
        .replace(/^\.claude\//, '.agent/') // .claude/rules/...
        .replace(/^\.opencode\//, '.agent/'); // .opencode/rules/...

      // config.yaml 등에서 .claude/ 로 참조하는 경우 대응
      if (realPath.includes('.claude')) realPath = realPath.replace('.claude', '.agent');
      if (realPath.includes('.gemini')) realPath = realPath.replace('.gemini', '.agent');
      if (realPath.includes('.opencode')) realPath = realPath.replace('.opencode', '.agent');

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
    } else if (itemType === 'command') {
      // .md 또는 .toml 확인
      const mdPath = path.join(DIRS.commands, `${itemName}.md`);
      const tomlPath = path.join(DIRS.commands, `${itemName}.toml`);
      if (fs.existsSync(mdPath)) filePath = mdPath;
      else if (fs.existsSync(tomlPath)) filePath = tomlPath;
      else filePath = mdPath; // 기본값
    } else {
      // rule
      filePath = path.join(DIRS.rules, `${itemName}.md`);
    }

    const itemContent = loadContent(filePath);
    if (itemContent) {
      content += `\n---\n\n${itemContent}\n`;
      log(`  ✅ ${itemName}`, 'green');
    } else {
      log(`  ⚠️  ${itemName} (파일 없음)`, 'yellow');
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
    log('⚠️  템플릿 파일을 찾을 수 없습니다: ' + templatePath, 'yellow');
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

  // Commands 추가
  if (config.active_commands?.length > 0) {
    console.log('\n  💬 Commands:');
    content = addSection(content, 'Commands', '💬', config.active_commands, 'command');
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
    config.active_commands?.length || 0,
  ].reduce((a, b) => a + b, 0);

  log(`  ✅ Copilot 동기화 완료 (총 ${totalItems}개 항목)`, 'green');
}

/**
 * MCP 설정 동기화
 * .agent/mcp/server.json -> .mcp.json (Claude), .gemini/settings.json, opencode.json
 */
function syncMcpSettings() {
  const mcpSourcePath = path.join(AGENT_DIR, 'mcp', 'servers.json');
  if (!fs.existsSync(mcpSourcePath)) {
    log('  ⚠️  MCP 설정 원본이 없습니다 (.agent/mcp/servers.json) - 건너뜀', 'yellow');
    return;
  }

  const mcpConfig = JSON.parse(fs.readFileSync(mcpSourcePath, 'utf-8'));
  const mcpServers = mcpConfig.mcpServers || {};

  // 1. Claude (.mcp.json at root)
  // Claude uses { "mcpServers": { ... } } format directly
  const claudeConfigPath = path.join(ROOT_DIR, '.mcp.json');
  fs.writeFileSync(claudeConfigPath, JSON.stringify({ mcpServers }, null, 2));
  log('  ✅ Claude MCP 설정 (.mcp.json)', 'green');

  // 2. OpenCode (opencode.json at root)
  const opencodeConfigPath = path.join(ROOT_DIR, 'opencode.json');
  // OpenCode requires a specific format transformation
  const opencodeMcp = {};

  Object.entries(mcpServers).forEach(([name, config]) => {
    opencodeMcp[name] = {
      type: 'local',
      command: [config.command, ...(config.args || [])],
      environment: config.env || {},
      enabled: true,
    };
  });

  const opencodeConfig = {
    "$schema": "https://opencode.ai/config.json",
    mcp: opencodeMcp
  };

  fs.writeFileSync(opencodeConfigPath, JSON.stringify(opencodeConfig, null, 2));
  log('  ✅ OpenCode MCP 설정 (opencode.json) - 변환 완료', 'green');

  // 3. Gemini (.gemini/settings.json)
  // Gemini uses { "mcpServers": { ... } } but inside settings.json which might have other things
  // Note: Previous file content check showed only mcpServers, so we can overwrite or merge.
  // Ideally merge if exists, but for now we basically enforcing agent config.
  // Let's assume we want to manage it via .agent, but preserve other keys if they exist.
  const geminiConfigPath = path.join(ROOT_DIR, '.gemini', 'settings.json');
  let geminiConfig = {};

  if (fs.existsSync(geminiConfigPath)) {
    try {
      geminiConfig = JSON.parse(fs.readFileSync(geminiConfigPath, 'utf-8'));
    } catch (e) {
      log('  ⚠️  기존 Gemini 설정 파싱 실패 - 새로 작성', 'yellow');
    }
  }

  geminiConfig.mcpServers = mcpServers;

  // Ensure .gemini dir exists (handled by main loop but double check)
  if (!fs.existsSync(path.dirname(geminiConfigPath))) {
    fs.mkdirSync(path.dirname(geminiConfigPath), { recursive: true });
  }

  fs.writeFileSync(geminiConfigPath, JSON.stringify(geminiConfig, null, 2));
  log('  ✅ Gemini MCP 설정 (.gemini/settings.json)', 'green');
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
  // commands, prompts는 별도 처리 또는 제거됨
  const itemsToLink = [
    'rules', 'skills', 'workflows', 'agents', 'profiles',
    'config.yaml'
  ];

  // .agent/README.md 삭제 (사용자 요청)
  const agentReadme = path.join(AGENT_DIR, 'README.md');
  if (fs.existsSync(agentReadme)) {
    try { fs.unlinkSync(agentReadme); } catch (e) { }
  }


  // 타겟 디렉토리들
  const targetDirs = ['.claude', '.gemini', '.opencode'];

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

    // README.md 강제 삭제 (사용자 요청: 폴더 내 README 제거)
    // fs.existsSync는 Broken Symlink에 대해 false를 반환하므로 lstat을 사용해야 함
    const readmeTarget = path.join(targetDirPath, 'README.md');
    try {
      // 존재 여부 확인 (Broken Symlink 포함)
      fs.lstatSync(readmeTarget);
      // 존재하면 삭제
      fs.unlinkSync(readmeTarget);
      log(`  🗑️  ${targetDirName}/README.md 제거됨`, 'dim');
    } catch (e) {
      // 파일이 없으면 무시
      if (e.code !== 'ENOENT') {
        log(`  ⚠️  ${targetDirName}/README.md 제거 실패: ${e.message}`, 'dim');
      }
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

    // 3) Commands 폴더 별도 처리 (파일 단위 선별 링크)
    const commandsSourceDir = path.join(AGENT_DIR, 'commands');
    const commandsTargetDir = path.join(targetDirPath, 'commands');

    if (fs.existsSync(commandsSourceDir)) {
      // 확실한 동기화를 위해 기존 commands 폴더 삭제 후 재생성
      if (fs.existsSync(commandsTargetDir)) {
        fs.rmSync(commandsTargetDir, { recursive: true, force: true });
      }
      fs.mkdirSync(commandsTargetDir);

      const commandFiles = fs.readdirSync(commandsSourceDir);
      let commandCount = 0;

      for (const file of commandFiles) {
        const ext = path.extname(file);
        let shouldLink = false;

        if (targetDirName === '.gemini') {
          // Gemini: .toml 파일만
          if (ext === '.toml') shouldLink = true;
        } else {
          // Claude/OpenCode: .md 파일만 (단, claude.md는 .claude에서 제외)
          if (ext === '.md') {
            if (targetDirName === '.claude' && file === 'claude.md') {
              shouldLink = false;
            } else {
              shouldLink = true;
            }
          }
        }

        if (shouldLink) {
          createSymlink(
            path.join(commandsSourceDir, file),
            path.join(commandsTargetDir, file),
            false // isDirectory = false (파일 링크)
          );
          commandCount++;
        }
      }
      log(`  ✅ ${targetDirName}/commands 구성 완료 (${commandCount}개 파일)`, 'dim');
    }

    log(`  ✅ ${targetDirName} 구성 완료 (${linkedCount}개 항목 링크)`, 'green');
  }

  console.log('');

  // 2. 파일 컴파일 (CLAUDE.md, GEMINI.md, AGENTS.md)
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

  // 4. MCP 설정 동기화
  log('🔌 MCP 설정 동기화', 'cyan');
  try {
    syncMcpSettings();
  } catch (error) {
    log(`❌ MCP 동기화 실패: ${error.message}`, 'red');
    console.error(error);
  }

  console.log('');
  log('=.'.repeat(25), 'dim');
  console.log('');
  log('✨ 셋업 완료!', 'green');
  console.log('');
  log('생성/업데이트된 파일:', 'cyan');
  log('  .claude/          → 선별적 링크 (sync 제외)', 'dim');
  log('  .gemini/          → 선별적 링크 (sync 제외)', 'dim');
  log('  GEMINI.md         → 규칙이 통합된 컨텍스트 파일', 'dim');
  log('  CLAUDE.md         → 규칙이 통합된 컨텍스트 파일', 'dim');
  log('  AGENTS.md         → 규칙이 통합된 컨텍스트 파일 (OpenCode)', 'dim');
  log('  COPILOT.md        → 규칙이 통합된 컨텍스트 포인터', 'dim');
  log('  .mcp.json         → Claude용 MCP 설정', 'dim');
  log('  opencode.json     → OpenCode용 MCP 설정', 'dim');
  log('  .gemini/settings.json → Gemini용 MCP 설정', 'dim');
  log('  .github/copilot-instructions.md', 'dim');
}

main();
