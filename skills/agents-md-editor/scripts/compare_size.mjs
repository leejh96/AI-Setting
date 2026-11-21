import console from 'node:console';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import process from 'node:process';
import { parseArgs, TextDecoder } from 'node:util';

const description = 'Compare UTF-8 instruction file sizes without modifying or printing content.';
const usage = 'Usage: node compare_size.mjs <before> <after>';
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const lineEndings = new Set(['\n', '\r', '\v', '\f', '\u001c', '\u001d', '\u001e', '\u0085', '\u2028', '\u2029']);

function countText(text) {
  let characters = 0;
  let lines = 0;
  let previous = '';
  for (const character of text) {
    characters++;
    if (lineEndings.has(character) && (character !== '\n' || previous !== '\r')) lines++;
    previous = character;
  }
  if (previous && !lineEndings.has(previous)) lines++;
  return { characters, lines };
}

function measure(path) {
  const raw = readFileSync(path);
  return {
    path: realpathSync(path),
    sha256: createHash('sha256').update(raw).digest('hex'),
    utf8_bytes: raw.length,
    ...countText(decoder.decode(raw)),
  };
}

function changePercent(delta, original) {
  if (original === 0) return null;
  const percent = delta / original * 100;
  const magnitude = Math.abs(percent);
  // Exact .125 and .625 ties round toward the lower even cent, as in Python.
  if (magnitude % 0.5 === 0.125) return Math.sign(percent) * Math.floor(magnitude * 100) / 100;
  return Number(percent.toFixed(2));
}

function compare(before, after) {
  const changes = {};
  for (const metric of ['utf8_bytes', 'characters', 'lines']) {
    const original = before[metric];
    const delta = after[metric] - original;
    changes[metric] = { delta, change_percent: changePercent(delta, original) };
  }
  return {
    before, after, changes,
    limits: 'File sizes only; not token counts, semantic checks, or performance measurements.',
  };
}

function main(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { help: { type: 'boolean', short: 'h' } } });
  } catch (error) {
    console.error(`${usage}\n${error.message}`);
    return 2;
  }

  if (parsed.values.help) {
    console.log(`${usage}\n\n${description}`);
    return 0;
  }
  if (parsed.positionals.length !== 2) {
    console.error(usage);
    return 2;
  }

  const [before, after] = parsed.positionals;
  try {
    const report = compare(measure(before), measure(after));
    console.log(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    console.error(`Cannot compare UTF-8 files (${error.code ?? error.name}).`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
