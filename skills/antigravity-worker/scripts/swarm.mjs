import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const privateFile = { flag: 'wx', mode: 0o600 };
const memberName = /^[a-z][a-z0-9-]{0,63}$/;

export class SwarmPermissionCleanupError extends Error {}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function readSwarmRequest(path, cwd) {
  if (!isAbsolute(path)) throw new Error('Pass an absolute UTF-8 JSON path for --swarm.');
  const request = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  if (!object(request) || typeof request.verifier !== 'string' || !memberName.test(request.verifier)
    || !Array.isArray(request.files) || !request.files.length) {
    throw new Error('Swarm request must specify a verifier name and a nonempty list of workspace-relative files.');
  }
  const root = realpathSync(cwd);
  const targets = request.files.map(file => {
    if (typeof file !== 'string' || /[:*?()[\]]/.test(file) || [...file].some(char => char.charCodeAt(0) < 32)) {
      throw new Error('Invalid Swarm file path.');
    }
    const parts = file.split(/[/\\]/);
    if (parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git' || /[. ]$/.test(part))) {
      throw new Error(`Expected a workspace-relative file (${file}).`);
    }
    let target = root;
    for (const part of parts.slice(0, -1)) {
      target = join(target, part);
      if (!lstatSync(target).isDirectory()) throw new Error(`Swarm file parent must be a real directory (${file}).`);
    }
    target = join(target, parts.at(-1));
    const entry = lstatSync(target, { throwIfNoEntry: false });
    if (entry && !entry.isFile()) throw new Error(`Swarm target must be a regular file (${file}).`);
    const suffix = relative(root, target);
    if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new Error(`Swarm target escaped the workspace (${file}).`);
    return target.replaceAll('\\', '/');
  });
  return { verifier: request.verifier, rules: [...new Set(targets)].map(target => `write_file(${target})`) };
}

function readConfig(path) {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry) return undefined;
  if (!entry.isFile()) throw new Error(`Swarm config must be a regular file (${path}).`);
  return readFileSync(path);
}

function parseConfig(raw) {
  return raw ? JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')) : {};
}

function getPermissionLists(config, keys, path) {
  let lists = config;
  for (const key of keys) {
    if (!object(lists)) throw new Error(`Invalid Swarm settings object (${path}).`);
    if (!Object.hasOwn(lists, key)) lists[key] = {};
    lists = lists[key];
  }
  if (!object(lists) || (Object.hasOwn(lists, 'allow') && (!Array.isArray(lists.allow) || lists.allow.some(rule => typeof rule !== 'string')))) {
    throw new Error(`Invalid Swarm permission list (${path}).`);
  }
  return lists;
}

function replaceConfig(path, previous, contents) {
  function checkCurrent() {
    const current = readConfig(path);
    if (previous ? !current?.equals(previous) : current) throw new Error(`Swarm config changed concurrently (${path}).`);
  }
  if (!contents) {
    checkCurrent();
    if (previous) unlinkSync(path);
    return;
  }
  const temporary = `${path}.codex-${randomUUID()}.tmp`;
  writeFileSync(temporary, contents, privateFile);
  try {
    checkCurrent();
    renameSync(temporary, path);
  } catch (error) {
    unlinkSync(temporary);
    throw error;
  }
}

const encodeConfig = config => Buffer.from(JSON.stringify(config, null, 2) + '\n');

export function grantSwarmFiles(profile, turn, rules) {
  if (!lstatSync(profile).isDirectory()) throw new Error(`Swarm profile must be a real directory (${profile}).`);
  const files = [
    [join(profile, 'config', 'config.json'), ['userSettings', 'globalPermissionGrants']],
    [join(profile, 'antigravity-cli', 'settings.json'), ['permissions']],
  ];
  const restores = [];
  function restore(cause) {
    const errors = [];
    for (const rollback of restores.reverse()) {
      try { rollback(); } catch (error) { errors.push(error.message); }
    }
    if (errors.length) {
      const message = `Swarm permission cleanup failed. Check ${turn}. ${errors.join(' ')}`;
      throw new SwarmPermissionCleanupError(cause ? `${cause.message} ${message}` : message, { cause });
    }
  }
  try {
    for (const [index, [path, keys]] of files.entries()) {
      if (!lstatSync(dirname(path), { throwIfNoEntry: false })) mkdirSync(dirname(path), { mode: 0o700 });
      if (!lstatSync(dirname(path)).isDirectory()) throw new Error(`Invalid Swarm settings directory (${path}).`);
      const previous = readConfig(path);
      const config = parseConfig(previous);
      const lists = getPermissionLists(config, keys, path);
      const added = rules.filter(rule => !lists.allow?.includes(rule));
      if (!added.length) continue;
      lists.allow = [...(lists.allow ?? []), ...added];
      const applied = encodeConfig(config);
      const backup = previous && join(turn, `swarm-config-${index}.bak`);
      if (backup) writeFileSync(backup, previous, privateFile);
      replaceConfig(path, previous, applied);
      restores.push(() => {
        const current = readConfig(path);
        if (current?.equals(applied)) {
          replaceConfig(path, current, previous);
        } else if (current) {
          const latest = parseConfig(current);
          const permissions = getPermissionLists(latest, keys, path);
          if (permissions.allow?.some(rule => added.includes(rule))) {
            permissions.allow = permissions.allow.filter(rule => !added.includes(rule));
            replaceConfig(path, current, encodeConfig(latest));
          }
        }
        if (backup) {
          const saved = readConfig(backup);
          if (saved && !saved.equals(previous)) throw new Error(`Swarm config backup changed (${backup}).`);
          if (saved) unlinkSync(backup);
        }
      });
    }
  } catch (error) {
    restore(error);
    throw error;
  }
  return restore;
}

export function swarmBoard(profile, sessionId) {
  if (!/^[a-z0-9_-]+$/i.test(sessionId)) throw new Error('Invalid Swarm session ID.');
  return join(profile, 'antigravity-cli', 'brain', sessionId, '.system_generated', 'swarm', 'board.jsonl');
}

function readBoard(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    }).filter(entry => Number.isSafeInteger(entry?.seq));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export const lastSwarmSequence = path => readBoard(path).at(-1)?.seq ?? 0;

export async function waitForSwarm(path, verifier, after, interruption, onPost, timeout = 15 * 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const reason = interruption();
    if (reason) return reason;
    if (Date.now() >= deadline) return 'timeout';
    for (const { seq, agent, text } of readBoard(path)) {
      if (seq <= after) continue;
      after = seq;
      onPost({ seq, agent, text });
      if (agent !== 'coordinator' && /^@coordinator\s+\[blocked\]/i.test(text)) return 'blocked';
      if (agent === verifier && /^@coordinator\s+\[done\]/i.test(text)) return 'done';
    }
    await delay(1_000);
  }
}
