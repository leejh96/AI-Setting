#!/usr/bin/env node
/**
 * Agent Environment Setup Script
 * Usage: npm run setup:[all|copilot|claude|gemini|opencode|codex]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Configuration ---

const ROOT = process.cwd();
const PATHS = {
  agent: path.join(ROOT, '.agent'),
  github: path.join(ROOT, '.github'),
  vscode: path.join(ROOT, '.vscode'),
  templates: path.join(ROOT, '.agent', 'sync', 'templates'),
};

const SUBDIRS = {
  rules: path.join(PATHS.agent, 'rules'),
  skills: path.join(PATHS.agent, 'skills'),
  workflows: path.join(PATHS.agent, 'workflows'),
  agents: path.join(PATHS.agent, 'agents'),
  commands: path.join(PATHS.agent, 'commands'),
  mcp: path.join(PATHS.agent, 'mcp'),
};

// Setup Modes Configuration
const MODES = {
  copilot: {
    targets: ['.github'],
    contextFiles: ['AGENTS.md'],
    mcpFiles: ['.vscode/mcp.json'],
    prefix: '.github',
    agentConfig: { type: 'copy', ext: '.agent.md', frontmatter: true },
  },
  claude: {
    targets: ['.claude'],
    contextFiles: ['CLAUDE.md'],
    mcpFiles: ['.mcp.json'],
    prefix: '.claude',
    agentConfig: { type: 'copy', ext: '.md', frontmatter: true, extraFields: { name: true } },
  },
  gemini: {
    targets: ['.gemini'],
    contextFiles: ['GEMINI.md'],
    mcpFiles: ['.gemini/settings.json'],
    prefix: '.gemini',
    agentConfig: { type: 'link', ext: '.md' },
  },
  opencode: {
    targets: ['.opencode'],
    contextFiles: ['AGENTS.md'],
    mcpFiles: ['opencode.json'],
    prefix: '.opencode',
    agentConfig: { type: 'link', ext: '.md' },
  },
  codex: {
    targets: ['.codex'],
    contextFiles: ['AGENTS.md'],
    mcpFiles: ['.codex/config.toml'],
    prefix: '.codex',
    agentConfig: { type: 'link', ext: '.md' },
  },
  // 'all' aggregates targets but doesn't have specific agent logic itself
  all: {
    targets: ['.claude', '.gemini', '.opencode', '.codex', '.github'],
    contextFiles: ['CLAUDE.md', 'GEMINI.md', 'AGENTS.md'],
    mcpFiles: ['.mcp.json', 'opencode.json', '.gemini/settings.json', '.codex/config.toml', '.vscode/mcp.json'],
    prefix: '.agent',
  },
};

const SYMLINKS = ['skills', 'workflows', 'profiles', 'config.yaml']; // 'agents' handled separately based on config

// --- Utilities ---

const log = (msg, color = '\x1b[0m') => console.log(`${color}${msg}\x1b[0m`);
const readFile = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '');
const writeFile = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
const removeFile = (p) => { if (fs.existsSync(p)) try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch (e) { return false; } };
const removeDirIfEmpty = (p) => { try { if (fs.existsSync(p) && fs.readdirSync(p).length === 0) { fs.rmdirSync(p); return true; } } catch (e) { } return false; };
const makeDir = (p) => { removeFile(p); fs.mkdirSync(p, { recursive: true }); };
const listFiles = (dir, filterFn = () => true) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.') && filterFn(f)).map((f) => path.parse(f).name).sort() : [];

const createLink = (src, tgt, isDir = true) => {
  if (fs.existsSync(tgt)) removeFile(tgt);
  try {
    process.platform === 'win32'
      ? (isDir ? execSync(`mklink /J "${tgt}" "${src}"`, { stdio: 'ignore' }) : fs.copyFileSync(src, tgt))
      : fs.symlinkSync(path.relative(path.dirname(tgt), src), tgt, isDir ? 'dir' : 'file');
  } catch (e) { }
};

const processMarkdownFiles = (srcDir, tgtDir, nameFn, transformFn) => {
  if (!fs.existsSync(srcDir)) return;
  fs.readdirSync(srcDir).filter((f) => f.endsWith('.md')).forEach((f) => {
    try {
      let content = readFile(path.join(srcDir, f));
      if (transformFn) content = transformFn(f, content);
      writeFile(path.join(tgtDir, nameFn(f)), content);
    } catch (e) { }
  });
};

const addFrontmatter = (name, content, type = 'agent', extra = {}) => {
  if (content.trim().startsWith('---')) return content;
  let fm = '---\n';
  if (extra && extra.name) fm += `name: '${name}'\n`;
  fm += `description: '${name} ${type}'\n`;
  fm += `---\n\n${content}`;
  return fm;
};

// --- Core Logic ---

function setupAgent(agentName, activeTargets) {
  const targetDir = path.join(ROOT, agentName);
  const modeKey = agentName.replace('.', '');
  const config = MODES[modeKey]; // Note: 'all' mode doesn't call this directly, it iterates targets

  if (activeTargets.includes(agentName) && config) {
    makeDir(targetDir);

    // 1. Symlinks (Common)
    SYMLINKS.forEach(item => {
      const src = path.join(PATHS.agent, item);
      if (fs.existsSync(src)) createLink(src, path.join(targetDir, item), fs.statSync(src).isDirectory());
    });

    // 2. Agents (Configurable)
    if (config.agentConfig) {
      if (config.agentConfig.type === 'link') {
        const src = path.join(PATHS.agent, 'agents');
        if (fs.existsSync(src)) createLink(src, path.join(targetDir, 'agents'), true);
      } else {
        const agentsDir = path.join(targetDir, 'agents');
        makeDir(agentsDir);
        processMarkdownFiles(SUBDIRS.agents, agentsDir,
          (f) => `${path.parse(f).name}${config.agentConfig.ext}`,
          (f, c) => config.agentConfig.frontmatter ? addFrontmatter(path.parse(f).name, c, 'agent', config.agentConfig.extraFields) : c
        );
      }
    }

    // 3. Commands (Filter)
    if (fs.existsSync(SUBDIRS.commands)) {
      const cmdTarget = path.join(targetDir, 'commands');
      fs.mkdirSync(cmdTarget);
      fs.readdirSync(SUBDIRS.commands).forEach((f) => {
        const ext = path.extname(f);
        const isAllowed = agentName === '.gemini' ? ext === '.toml' : ext === '.md' && !(agentName === '.claude' && f === 'claude.md');
        if (isAllowed) createLink(path.join(SUBDIRS.commands, f), path.join(cmdTarget, f), false);
      });
    }
    log(`  ✅ ${agentName}`, '\x1b[32m');
  } else {
    // Handling removal for non-active agents
    if (agentName !== '.github') { // .github handled by setupCopilot
      if (removeFile(targetDir)) log(`  🗑️  ${agentName}`, '\x1b[2m');
    }
  }
}

function setupCopilot(activeTargets) {
  log('🤖 Copilot Setup...', '\x1b[36m');
  const copilotInstrFile = path.join(PATHS.github, 'copilot-instructions.md');

  if (activeTargets.includes('.github')) {
    if (!fs.existsSync(PATHS.github)) fs.mkdirSync(PATHS.github);

    // 1. Symlinks
    ['skills', 'workflows'].forEach(item => {
      const src = path.join(PATHS.agent, item);
      if (fs.existsSync(src)) createLink(src, path.join(PATHS.github, item), true);
    });

    // 2. Agents (via Config) - Reusing logic? Or explicit?
    // Copilot is .github, mapped to MODES['copilot']
    const config = MODES.copilot;
    const agentsDir = path.join(PATHS.github, 'agents');
    makeDir(agentsDir);
    processMarkdownFiles(SUBDIRS.agents, agentsDir,
      (f) => `${path.parse(f).name}${config.agentConfig.ext}`,
      (f, c) => config.agentConfig.frontmatter ? addFrontmatter(path.parse(f).name, c, 'agent') : c
    );

    // 3. Instructions
    const instrDir = path.join(PATHS.github, 'instructions');
    makeDir(instrDir);
    processMarkdownFiles(SUBDIRS.rules, instrDir, (f) => `${path.parse(f).name}.instructions.md`, (f, c) => {
      if (c.trim().startsWith('---')) c = c.replace(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---\s*[\r\n]*/, '').trim();
      return `---\napplyTo: "**"\n---\n\n${c}`;
    });

    // 4. Prompts
    const promptsDir = path.join(PATHS.github, 'prompts');
    makeDir(promptsDir);
    processMarkdownFiles(SUBDIRS.commands, promptsDir, (f) => `${path.parse(f).name}.prompt.md`, (f, c) => addFrontmatter(path.parse(f).name, c, 'prompt'));

    log(`  ✅ .github`, '\x1b[32m');
  } else {
    ['agents', 'instructions', 'prompts', 'skills', 'workflows'].forEach(d => removeFile(path.join(PATHS.github, d)));
    removeFile(copilotInstrFile);
    if (removeDirIfEmpty(PATHS.github)) log(`  🗑️  .github`, '\x1b[2m');
  }
}

function generateContextFiles(config, mode) {
  log('📄 Context Files...', '\x1b[36m');
  const ctxData = {
    rules: listFiles(SUBDIRS.rules),
    skills: listFiles(SUBDIRS.skills, (f) => fs.statSync(path.join(SUBDIRS.skills, f)).isDirectory()),
    workflows: listFiles(SUBDIRS.workflows),
    agents: listFiles(SUBDIRS.agents),
    commands: listFiles(SUBDIRS.commands, (f) => f.endsWith('.md')),
  };

  const generateFile = (tplName, outFile) => {
    let content = readFile(path.join(PATHS.templates, tplName));
    if (!content) return;

    let prefix = config.prefix || '.agent';
    if (mode === 'all') {
      if (outFile === 'GEMINI.md') prefix = '.gemini';
      else if (outFile === 'CLAUDE.md') prefix = '.claude';
      else if (outFile === 'AGENTS.md') prefix = '.agent';
    }

    const replaceLink = (items, dir, ext) => items.map((i) => `- **${i}**: ${prefix}/${dir}/${i}${ext}`).join('\n');

    // Determine Agent Link Extension based on mode
    let agentExt = '.md';
    if (mode === 'copilot') agentExt = '.agent.md';
    // Claude uses .md (original) so default is fine

    content = content
      .replace(/{{PREFIX}}/g, prefix)
      .replace('{{RULES}}', ctxData.rules.map((r) => `### ${r}\n\n@.agent/rules/${r}.md`).join('\n\n'))
      .replace('{{SKILLS}}', replaceLink(ctxData.skills, 'skills', '/SKILL.md'))
      .replace('{{WORKFLOWS}}', replaceLink(ctxData.workflows, 'workflows', '.md'))
      .replace('{{AGENTS}}', replaceLink(ctxData.agents, 'agents', agentExt))
      .replace('{{COMMANDS}}', ctxData.commands.map((c) => {
        const dir = mode === 'copilot' ? 'prompts' : 'commands';
        const ext = mode === 'copilot' ? '.prompt.md' : '.md';
        return `- **${c}**: ${prefix}/${dir}/${c}${ext}`;
      }).join('\n'));

    if (mode === 'copilot') content = content.replace('## Commands', '## Prompts');

    // Embed Content
    content = content.split('\n').map((line) => {
      const match = line.match(/@([\.\/\w\-\d]+\.md)/);
      if (!match) return line;
      const relPath = match[1].replace(/^\.\/(\.[a-z]+)\//, '.agent/').replace(/^\.([a-z]+)\//, '.agent/');
      const absPath = path.join(ROOT, relPath);
      return fs.existsSync(absPath) ? (line.trim().startsWith('@') ? `\n<!-- Content: ${relPath} -->\n${readFile(absPath)}\n<!-- End -->\n` : line.replace(match[0], `(file://${absPath})`)) : line;
    }).join('\n');

    writeFile(path.join(ROOT, outFile), content);
    log(`  ✅ ${outFile} (${prefix})`, '\x1b[2m');
  };

  ['CLAUDE.md', 'GEMINI.md', 'AGENTS.md'].forEach((f) => {
    config.contextFiles.includes(f) ? generateFile(`template-${f}`, f) : (removeFile(path.join(ROOT, f)) && log(`  🗑️  ${f}`, '\x1b[2m'));
  });

  return ctxData;
}

function generateCopilotInstructions(ctxData, activeTargets) {
  if (!activeTargets.includes('.github')) return;
  const copilotInstrFile = path.join(PATHS.github, 'copilot-instructions.md');
  let content = '# Copilot Instructions\n\n';
  if (ctxData.rules.length) content += '## 📋 Core Rules\n' + ctxData.rules.map(r => `- **${r}**: \`.github/instructions/${r}.instructions.md\``).join('\n') + '\n\n';
  const addSection = (t, i, f) => i.length && (content += `## ${t}\n` + i.map(x => `- **${x}**: \`${f(x)}\``).join('\n') + '\n\n');
  addSection('🎯 Skills', ctxData.skills, s => `.github/skills/${s}/SKILL.md`);
  addSection('👤 Personas', ctxData.agents, a => `.github/agents/${a}.agent.md`);
  addSection('💬 Prompts', ctxData.commands, p => `.github/prompts/${p}.prompt.md`);
  writeFile(copilotInstrFile, content);
}

function setupMcp(config) {
  log('🔌 MCP Config...', '\x1b[36m');
  let mcpServerConfig = {};
  try { mcpServerConfig = JSON.parse(readFile(path.join(SUBDIRS.mcp, 'servers.json'))).mcpServers || {}; } catch (e) { }
  const targets = config.mcpFiles;

  // 1. Claude
  const claudeMcp = path.join(ROOT, '.mcp.json');
  targets.includes('.mcp.json') ? (writeFile(claudeMcp, JSON.stringify({ mcpServers: mcpServerConfig }, null, 2)) || log('  ✅ .mcp.json', '\x1b[2m')) : removeFile(claudeMcp);

  // 2. OpenCode
  const openCodeMcp = path.join(ROOT, 'opencode.json');
  if (targets.includes('opencode.json')) {
    const oc = { "$schema": "https://opencode.ai/config.json", mcp: {} };
    Object.entries(mcpServerConfig).forEach(([k, v]) => oc.mcp[k] = { type: 'local', command: [v.command, ...(v.args || [])], environment: v.env || {}, enabled: true });
    writeFile(openCodeMcp, JSON.stringify(oc, null, 2)); log('  ✅ opencode.json', '\x1b[2m');
  } else removeFile(openCodeMcp);

  // 3. VS Code
  const vscodeMcp = path.join(PATHS.vscode, 'mcp.json');
  if (targets.includes('.vscode/mcp.json')) {
    const cleanFn = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => { const n = { ...v }; if (n.env && !Object.keys(n.env).length) delete n.env; return [k, n]; }));
    writeFile(vscodeMcp, JSON.stringify({ servers: cleanFn(mcpServerConfig) }, null, 2)); log('  ✅ .vscode/mcp.json', '\x1b[2m');
  } else { removeFile(vscodeMcp); if (removeDirIfEmpty(PATHS.vscode)) log('  🗑️  .vscode', '\x1b[2m'); }

  // 4. Gemini & Codex (Internal)
  if (config.targets.includes('.gemini') && fs.existsSync(path.join(ROOT, '.gemini'))) {
    const p = path.join(ROOT, '.gemini', 'settings.json'); let g = {}; try { g = JSON.parse(readFile(p)); } catch (e) { } g.mcpServers = mcpServerConfig; writeFile(p, JSON.stringify(g, null, 2));
  }
  if (config.targets.includes('.codex') && fs.existsSync(path.join(ROOT, '.codex'))) {
    let t = '# Auto-generated\n\n';
    Object.entries(mcpServerConfig).forEach(([k, v]) => {
      const key = k.includes('-') ? `"${k}"` : k;
      t += `[mcp_servers.${key}]\ncommand = "${v.command}"\n` + (v.args ? `args = [${v.args.map(a => `"${a}"`).join(', ')}]\n` : '') + (v.env ? `[mcp_servers.${key}.env]\n` + Object.entries(v.env).map(([x, y]) => `${x} = "${y}"\n`).join('') : '') + '\n';
    });
    writeFile(path.join(ROOT, '.codex', 'config.toml'), t);
  }
}

// --- Main ---

(function main() {
  const mode = process.argv[2] || 'all';
  if (!MODES[mode]) { console.error(`❌ Unknown mode: ${mode}`); process.exit(1); }
  const config = mode === 'all' ? MODES.all : MODES[mode];
  log(`\n🚀 Setup: ${mode.toUpperCase()}`, '\x1b[33m');

  if (!fs.existsSync(PATHS.agent)) { log('❌ .agent missing', '\x1b[31m'); process.exit(1); }
  ['.agents', '.copilot'].forEach(d => removeFile(path.join(ROOT, d))); // Cleanup legacy

  try {
    ['.claude', '.gemini', '.opencode', '.codex'].forEach(agent => setupAgent(agent, config.targets));
    setupCopilot(config.targets);
    const ctx = generateContextFiles(config, mode);
    generateCopilotInstructions(ctx, config.targets);
    setupMcp(config);
    log('\n✨ Done!\n', '\x1b[32m');
  } catch (e) { console.error('\n❌ Error:', e); process.exit(1); }
})();
