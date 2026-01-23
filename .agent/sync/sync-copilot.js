#!/usr/bin/env node

/**
 * Copilot instructions 동기화
 * 
 * .agent/ 디렉토리의 모든 구성 요소를 통합하여:
 * 1. .github/copilot-instructions.md (실제 내용)
 * 2. COPILOT.md (루트 포인터, CLAUDE.md/GEMINI.md와 동일 패턴)
 * 
 * 사용법: npm run agent:sync:copilot
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const AGENT_DIR = path.join(ROOT_DIR, '.agent');
const CONFIG_FILE = path.join(AGENT_DIR, 'config.yaml');
const GITHUB_DIR = path.join(ROOT_DIR, '.github');
const GITHUB_OUTPUT_FILE = path.join(GITHUB_DIR, 'copilot-instructions.md');
const ROOT_OUTPUT_FILE = path.join(ROOT_DIR, 'COPILOT.md');

// 디렉토리 경로
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

/**
 * 파일 내용 로드
 */
function loadContent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * 섹션 추가
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
 * 루트 포인터 파일 생성
 */
function createRootPointer() {
  const templatePath = path.join(AGENT_DIR, 'sync/templates/COPILOT.md');
  const template = loadContent(templatePath);
  
  if (!template) {
    console.error('⚠️  템플릿 파일을 찾을 수 없습니다: ' + templatePath);
    return;
  }

  fs.writeFileSync(ROOT_OUTPUT_FILE, template);
  console.log(`  ✅ COPILOT.md`);
}

function main() {
  console.log('🔄 Copilot instructions 동기화 중...\n');

  const config = parseConfig();

  // .github 폴더 생성
  if (!fs.existsSync(GITHUB_DIR)) {
    fs.mkdirSync(GITHUB_DIR, { recursive: true });
  }

  let content = '# Copilot Instructions\n\n';
  content += '> ⚠️ Auto-generated from .agent/ - Do not edit directly\n';
  content += '> Run `npm run agent:sync:copilot` to sync\n\n';

  // Rules 추가
  if (config.active_rules?.length > 0) {
    console.log('📋 Rules:');
    content = addSection(content, 'Rules', '📋', config.active_rules, 'rule');
  }

  // Skills 추가
  if (config.active_skills?.length > 0) {
    console.log('\n🎯 Skills:');
    content = addSection(content, 'Skills', '🎯', config.active_skills, 'skill');
  }

  // Workflows 추가
  if (config.active_workflows?.length > 0) {
    console.log('\n⚙️  Workflows:');
    content = addSection(content, 'Workflows', '⚙️', config.active_workflows, 'workflow');
  }

  // Agents 추가
  if (config.active_agents?.length > 0) {
    console.log('\n👤 Agents:');
    content = addSection(content, 'Agents (Personas)', '👤', config.active_agents, 'agent');
  }

  // Prompts 추가
  if (config.active_prompts?.length > 0) {
    console.log('\n💬 Prompts:');
    content = addSection(content, 'Prompts', '💬', config.active_prompts, 'prompt');
  }

  // .github/copilot-instructions.md 생성
  fs.writeFileSync(GITHUB_OUTPUT_FILE, content);
  console.log(`\n✨ 생성:`.padEnd(20));
  console.log(`  ✅ .github/copilot-instructions.md`);

  // 루트 COPILOT.md 생성
  console.log('\n📝 포인터 파일:');
  createRootPointer();

  const totalItems = [
    config.active_rules?.length || 0,
    config.active_skills?.length || 0,
    config.active_workflows?.length || 0,
    config.active_agents?.length || 0,
    config.active_prompts?.length || 0,
  ].reduce((a, b) => a + b, 0);

  console.log(`\n✨ 완료! (총 ${totalItems}개 항목 동기화)`);
}

main();
