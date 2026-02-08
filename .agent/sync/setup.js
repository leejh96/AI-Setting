#!/usr/bin/env node

/**
 * .agent 폴더 셋업 스크립트 (Refactored)
 * 
 * 기능:
 * 1. 에이전트 환경 동기화 (.claude, .gemini, .opencode, .codex)
 * 2. Copilot 환경 동기화 (.github)
 * 3. 컨텍스트 파일 컴파일 (GEMINI.md, CLAUDE.md)
 * 4. MCP 설정 동기화
 * 
 * 특징:
 * - Clean Setup: 타겟 폴더를 매번 재생성하여 잉여 데이터를 남기지 않음
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const ROOT_DIR = process.cwd();
const AGENT_DIR = path.join(ROOT_DIR, '.agent');
const TEMPLATES_DIR = path.join(AGENT_DIR, 'sync', 'templates');
const GITHUB_DIR = path.join(ROOT_DIR, '.github');
const COPILOT_INSTRUCTIONS_FILE = path.join(GITHUB_DIR, 'copilot-instructions.md');

// Target Agents
const TARGET_AGENTS = ['.claude', '.gemini', '.opencode', '.codex'];

// Items to link directly to agent folders
const STANDARD_LINKS = ['skills', 'workflows', 'agents', 'profiles', 'config.yaml'];

// Source Directories
const DIRS = {
  rules: path.join(AGENT_DIR, 'rules'),
  skills: path.join(AGENT_DIR, 'skills'),
  workflows: path.join(AGENT_DIR, 'workflows'),
  agents: path.join(AGENT_DIR, 'agents'),
  commands: path.join(AGENT_DIR, 'commands'),
};

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------
const colors = { reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', dim: '\x1b[2m' };

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function forceRemove(targetPath) {
  if (fs.existsSync(targetPath)) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return true;
    } catch (e) {
      log(`  ⚠️  Remove Failed: ${path.basename(targetPath)}`, 'yellow');
      return false;
    }
  }
  return false;
}

function ensureCleanDir(targetPath) {
  forceRemove(targetPath);
  fs.mkdirSync(targetPath, { recursive: true });
}

function createSymlink(source, target, isDirectory = true) {
  const absSource = path.resolve(source);
  const absTarget = path.resolve(target);

  if (fs.existsSync(absTarget)) forceRemove(absTarget);

  try {
    if (process.platform === 'win32') {
      if (isDirectory) {
        execSync(`mklink /J "${absTarget}" "${absSource}"`, { shell: 'cmd.exe', stdio: 'pipe' });
      } else {
        fs.copyFileSync(absSource, absTarget);
      }
    } else {
      const relative = path.relative(path.dirname(absTarget), absSource);
      fs.symlinkSync(relative, absTarget, isDirectory ? 'dir' : 'file');
    }
    return true;
  } catch (e) {
    log(`  ❌ Link Failed: ${path.basename(target)} (${e.message})`, 'red');
    return false;
  }
}

function getListFromDir(dirPath, isDir = false) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter(file => {
      if (file.startsWith('.')) return false;
      try {
        const stats = fs.statSync(path.join(dirPath, file));
        return isDir ? stats.isDirectory() : (stats.isFile() && file.endsWith('.md'));
      } catch { return false; }
    })
    .map(file => path.parse(file).name).sort();
}

// -----------------------------------------------------------------------------
// Action: Setup Agent Directories
// -----------------------------------------------------------------------------
function setupAgentDirectories() {
  log('📁 Agent Directories (.claude, .gemini...)', 'cyan');

  TARGET_AGENTS.forEach(agentName => {
    const targetDir = path.join(ROOT_DIR, agentName);
    ensureCleanDir(targetDir);

    // 1. Link Standard Items
    let linkCount = 0;
    STANDARD_LINKS.forEach(item => {
      const src = path.join(AGENT_DIR, item);
      const tgt = path.join(targetDir, item);
      if (fs.existsSync(src)) {
        if (createSymlink(src, tgt, fs.lstatSync(src).isDirectory())) linkCount++;
      }
    });

    // 2. Link Commands
    let cmdCount = 0;
    const cmdSrc = DIRS.commands;
    const cmdTgt = path.join(targetDir, 'commands');

    if (fs.existsSync(cmdSrc)) {
      fs.mkdirSync(cmdTgt);
      fs.readdirSync(cmdSrc).forEach(file => {
        const ext = path.extname(file);
        let link = false;

        if (agentName === '.gemini') {
          if (ext === '.toml') link = true;
        } else {
          // Others: Link .md, skip claude.md for .claude
          if (ext === '.md') {
            link = !(agentName === '.claude' && file === 'claude.md');
          }
        }

        if (link) {
          createSymlink(path.join(cmdSrc, file), path.join(cmdTgt, file), false);
          cmdCount++;
        }
      });
    }

    log(`  ✅ ${agentName}: ${linkCount} items, ${cmdCount} commands`, 'green');
  });
}

// -----------------------------------------------------------------------------
// Action: Setup Copilot Directory
// -----------------------------------------------------------------------------
function setupCopilotDirectory() {
  log('📁 Copilot Directory (.github)', 'cyan');

  if (!fs.existsSync(GITHUB_DIR)) fs.mkdirSync(GITHUB_DIR);

  // 1. Link Skills & Workflows
  ['skills', 'workflows'].forEach(item => {
    const src = path.join(AGENT_DIR, item);
    const tgt = path.join(GITHUB_DIR, item);
    if (fs.existsSync(src)) createSymlink(src, tgt, true);
  });

  // 2. Agents (*.agent.md)
  const agentsTgt = path.join(GITHUB_DIR, 'agents');
  ensureCleanDir(agentsTgt);
  if (fs.existsSync(DIRS.agents)) {
    let cnt = 0;
    fs.readdirSync(DIRS.agents).forEach(file => {
      if (file.endsWith('.md')) {
        createSymlink(path.join(DIRS.agents, file), path.join(agentsTgt, `${path.parse(file).name}.agent.md`), false);
        cnt++;
      }
    });
    log(`  ✅ Agents: ${cnt}`, 'dim');
  }

  // 3. Instructions (*.instructions.md + clean headers)
  const instrTgt = path.join(GITHUB_DIR, 'instructions');
  ensureCleanDir(instrTgt);
  if (fs.existsSync(DIRS.rules)) {
    let cnt = 0;
    fs.readdirSync(DIRS.rules).forEach(file => {
      if (file.endsWith('.md')) {
        try {
          const srcPath = path.join(DIRS.rules, file);
          let content = fs.readFileSync(srcPath, 'utf-8');
          // Remove existing frontmatter
          if (content.trim().startsWith('---')) {
            content = content.replace(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---\s*[\r\n]*/, '').trim();
          }
          // Add new header
          fs.writeFileSync(path.join(instrTgt, `${path.parse(file).name}.instructions.md`), `---\napplyTo: "**"\n---\n\n${content}`);
          cnt++;
        } catch (e) { }
      }
    });
    log(`  ✅ Instructions: ${cnt}`, 'dim');
  }

  // 4. Prompts (*.prompt.md + description only)
  const promptsTgt = path.join(GITHUB_DIR, 'prompts');
  ensureCleanDir(promptsTgt);
  if (fs.existsSync(DIRS.commands)) {
    let cnt = 0;
    fs.readdirSync(DIRS.commands).forEach(file => {
      if (file.endsWith('.md')) {
        try {
          let content = fs.readFileSync(path.join(DIRS.commands, file), 'utf-8');
          if (!content.trim().startsWith('---')) {
            content = `---\ndescription: '${path.parse(file).name} prompt'\n---\n\n${content}`;
          }
          fs.writeFileSync(path.join(promptsTgt, `${path.parse(file).name}.prompt.md`), content);
          cnt++;
        } catch (e) { }
      }
    });
    log(`  ✅ Prompts: ${cnt}`, 'dim');
  }
}

// -----------------------------------------------------------------------------
// Action: Compile Markdown
// -----------------------------------------------------------------------------
function compileMarkdownFiles(config) {
  log('📄 Compile Context Files', 'cyan');

  ['template-GEMINI.md', 'template-CLAUDE.md', 'template-AGENTS.md'].forEach(tpl => {
    const src = path.join(TEMPLATES_DIR, tpl);
    if (!fs.existsSync(src)) return;

    const outFile = tpl.replace('template-', '');
    let content = fs.readFileSync(src, 'utf-8');

    if (config) {
      // Embed Rules
      const rules = (config.active_rules || []).map(r => `### ${r}\n\n@.agent/rules/${r}.md`).join('\n\n');
      content = content.replace('{{RULES}}', rules);

      // Links
      let prefix = outFile === 'GEMINI.md' ? '.gemini' : (outFile === 'CLAUDE.md' ? '.claude' : '.opencode');
      const genLinks = (list, type, ext) => (list || []).map(i => `- **${i}**: ${prefix}/${type}/${i}${ext}`).join('\n');

      content = content
        .replace('{{SKILLS}}', genLinks(config.active_skills, 'skills', '/SKILL.md'))
        .replace('{{WORKFLOWS}}', genLinks(config.active_workflows, 'workflows', '.md'))
        .replace('{{AGENTS}}', genLinks(config.active_agents, 'agents', '.md'))
        .replace('{{COMMANDS}}', (config.active_commands || []).map(c => `- **${c}**: ${prefix}/commands/${c}.md`).join('\n'));
    }

    // Process @embeds
    content = content.split('\n').map(line => {
      const match = line.match(/@([\.\/\w\-\d]+\.md)/);
      if (!match) return line;

      // Normalize path to .agent/
      const realPath = match[1].replace(/^\.\/\.(gemini|opencode|claude)\//, '.agent/').replace(/^\.(gemini|opencode|claude)\//, '.agent/');
      const absPath = path.join(ROOT_DIR, realPath);

      if (fs.existsSync(absPath)) {
        return line.trim().startsWith('@')
          ? `\n<!-- Content from ${realPath} -->\n${fs.readFileSync(absPath, 'utf-8')}\n<!-- End of ${realPath} -->\n`
          : line.replace(match[0], `(file://${absPath})`);
      }
      return line;
    }).join('\n');

    fs.writeFileSync(path.join(ROOT_DIR, outFile), content);
    log(`  ✅ ${outFile}`, 'dim');
  });
}

// -----------------------------------------------------------------------------
// Action: Sync Configs
// -----------------------------------------------------------------------------
function parseConfig() {
  return {
    active_rules: getListFromDir(DIRS.rules),
    active_skills: getListFromDir(DIRS.skills, true),
    active_workflows: getListFromDir(DIRS.workflows),
    active_agents: getListFromDir(DIRS.agents),
    active_commands: getListFromDir(DIRS.commands),
  };
}

function syncCopilotInstructions(config) {
  log('📝 Sync Copilot Instructions', 'cyan');

  if (fs.existsSync(path.join(ROOT_DIR, 'COPILOT.md'))) try { fs.unlinkSync(path.join(ROOT_DIR, 'COPILOT.md')); } catch (e) { }

  let content = '# Copilot Instructions\n\n> ⚠️ Auto-generated from .agent/\n\n';
  content += 'You use the following project context and rules from `.github/`.\n\n';

  if (config.active_rules.length) {
    content += '## 📋 Core Rules\n';
    config.active_rules.forEach(r => content += `- **${r}**: \`.github/instructions/${r}.instructions.md\`\n`);
    content += '\n';
  }

  const linkSection = (title, list, pathFn) => {
    if (!list.length) return;
    content += `## ${title}\n`;
    list.forEach(i => content += `- **${i}**: \`${pathFn(i)}\`\n`);
    content += '\n';
  };

  linkSection('🎯 Skills', config.active_skills, s => `.github/skills/${s}/SKILL.md`);
  linkSection('👤 Personas', config.active_agents, a => `.github/agents/${a}.agent.md`);
  linkSection('💬 Prompts', config.active_commands, c => `.github/prompts/${c}.prompt.md`);

  fs.writeFileSync(COPILOT_INSTRUCTIONS_FILE, content);
  log(`  ✅ .github/copilot-instructions.md`, 'green');
}

function syncMcpSettings() {
  log('🔌 Sync MCP', 'cyan');
  const src = path.join(AGENT_DIR, 'mcp', 'servers.json');
  if (!fs.existsSync(src)) return;

  const servers = JSON.parse(fs.readFileSync(src, 'utf-8')).mcpServers || {};

  // 1. Claude
  fs.writeFileSync(path.join(ROOT_DIR, '.mcp.json'), JSON.stringify({ mcpServers: servers }, null, 2));

  // 2. OpenCode
  const opencode = { "$schema": "https://opencode.ai/config.json", mcp: {} };
  Object.entries(servers).forEach(([k, v]) => {
    opencode.mcp[k] = { type: 'local', command: [v.command, ...(v.args || [])], environment: v.env || {}, enabled: true };
  });
  fs.writeFileSync(path.join(ROOT_DIR, 'opencode.json'), JSON.stringify(opencode, null, 2));

  // 3. Gemini
  const geminiPath = path.join(ROOT_DIR, '.gemini', 'settings.json');
  ensureCleanDir(path.dirname(geminiPath));
  let gemini = {};
  if (fs.existsSync(geminiPath)) try { gemini = JSON.parse(fs.readFileSync(geminiPath)); } catch { }
  gemini.mcpServers = servers;
  fs.writeFileSync(geminiPath, JSON.stringify(gemini, null, 2));

  // 4. Codex
  const codexDir = path.join(ROOT_DIR, '.codex');
  ensureCleanDir(codexDir);
  let toml = '# Auto-generated\n\n';
  Object.entries(servers).forEach(([k, v]) => {
    const key = k.includes('-') ? `"${k}"` : k;
    toml += `[mcp_servers.${key}]\ncommand = "${v.command}"\n`;
    if (v.args) toml += `args = [${v.args.map(a => `"${a}"`).join(', ')}]\n`;
    if (v.env) {
      toml += `[mcp_servers.${key}.env]\n`;
      Object.entries(v.env).forEach(([ek, ev]) => toml += `${ek} = "${ev}"\n`);
    }
    toml += '\n';
  });
  fs.writeFileSync(path.join(codexDir, 'config.toml'), toml);
  log('  ✅ MCP Settings Synced', 'green');
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
function main() {
  console.log('\n🚀 Agent Sync Started...\n');
  if (!fs.existsSync(AGENT_DIR)) {
    log('❌ .agent folder missing', 'red');
    process.exit(1);
  }

  // 0. Cleanup
  ['.agents', '.copilot'].forEach(d => forceRemove(path.join(ROOT_DIR, d)));

  // 1. Config
  const config = parseConfig();

  // 2. Setup
  setupAgentDirectories();
  setupCopilotDirectory();

  // 3. Sync
  compileMarkdownFiles(config);
  syncCopilotInstructions(config);
  syncMcpSettings();

  console.log('\n✨ Done!\n');
}

main();
