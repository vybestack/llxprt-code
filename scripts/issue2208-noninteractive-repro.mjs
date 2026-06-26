#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const startScript = path.join(scriptDir, 'start.js');
const DEFAULT_PROFILES = ['gptfirst', 'gpt55high', 'opusthinking', 'glm'];
const EXPECTED =
  'LLXPRT2208_ALPHA\n\n' +
  'Alpha paragraph one.\n\n' +
  'LLXPRT2208_BETA\n\n' +
  '- beta item one\n' +
  '- beta item two\n\n' +
  'LLXPRT2208_DONE';
const PROMPT = `Return exactly this text and nothing else, preserving every line break: ${EXPECTED}`;

function parseProfiles(argv) {
  const profiles = argv.slice(2);
  return profiles.length === 0 ? DEFAULT_PROFILES : profiles;
}

function parseAssistantOutput(stdout) {
  return stdout
    .split(/\n/)
    .filter((line) => line.startsWith('{'))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((event) => event?.type === 'message' && event.role === 'assistant')
    .map((event) => event.content)
    .join('');
}

function runProfile(profile) {
  const result = spawnSync(
    process.execPath,
    [
      startScript,
      '--profile-load',
      profile,
      '--set',
      'emojifilter=allowed',
      '--output-format',
      'stream-json',
      '--prompt',
      PROMPT,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0' },
      timeout: 300_000,
    },
  );

  const assistant = parseAssistantOutput(result.stdout ?? '');
  const passed = result.status === 0 && assistant === EXPECTED;
  return { profile, result, assistant, passed };
}

function printFailure({ profile, result, assistant }) {
  console.error(`\n[${profile}] failed`);
  console.error(`exit status: ${String(result.status)}`);
  console.error(`signal: ${String(result.signal ?? 'none')}`);
  if (result.error) {
    console.error(result.error.message);
  }
  console.error('--- expected ---');
  console.error(JSON.stringify(EXPECTED));
  console.error('--- actual ---');
  console.error(JSON.stringify(assistant));
  console.error('--- stderr ---');
  console.error(result.stderr ?? '');
}

let failed = false;
for (const profile of parseProfiles(process.argv)) {
  const outcome = runProfile(profile);
  if (outcome.passed) {
    console.log(`[${profile}] preserved issue2208 line breaks`);
    continue;
  }
  failed = true;
  printFailure(outcome);
}

if (failed) {
  process.exitCode = 1;
}
