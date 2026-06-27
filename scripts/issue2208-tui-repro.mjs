#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

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

function validateProfile(profile) {
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) {
    throw new Error(`Invalid profile name: ${profile}`);
  }
}

function normalizeCapturedLine(line) {
  return line
    .replace(/█/g, '')
    .replace(/^\s*│\s?/, '')
    .trimEnd();
}

function normalizeCapturedAssistantText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(normalizeCapturedLine)
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function extractAssistantOutput(scrollback) {
  const normalized = normalizeCapturedAssistantText(scrollback);
  const alphaIndex = normalized.lastIndexOf('LLXPRT2208_ALPHA');
  if (alphaIndex < 0) {
    throw new Error('Captured scrollback did not contain LLXPRT2208_ALPHA');
  }
  const doneIndex = normalized.indexOf('LLXPRT2208_DONE', alphaIndex);
  if (doneIndex < 0) {
    throw new Error(
      'Captured scrollback did not contain LLXPRT2208_DONE after LLXPRT2208_ALPHA',
    );
  }
  return normalized.slice(alphaIndex, doneIndex + 'LLXPRT2208_DONE'.length);
}

function validateCapturedOutput(profile, outDir) {
  const captureFile = readdirSync(outDir).find((fileName) =>
    fileName.endsWith(`-issue2208-newlines-${profile}-scrollback.txt`),
  );
  if (!captureFile) {
    throw new Error(`Missing issue2208 capture file in ${outDir}`);
  }
  const actual = extractAssistantOutput(
    readFileSync(path.join(outDir, captureFile), 'utf8'),
  );
  if (actual !== EXPECTED) {
    console.error(`[${profile}] captured assistant output mismatch`);
    console.error('--- expected ---');
    console.error(JSON.stringify(EXPECTED));
    console.error('--- actual ---');
    console.error(JSON.stringify(actual));
    return false;
  }
  return true;
}

function createScenario(profile) {
  validateProfile(profile);
  return {
    tmux: {
      cols: 72,
      rows: 32,
      historyLimit: 20000,
      scrollbackLines: 3000,
      initialWaitMs: 6000,
    },
    startCommand: [
      `env CI=0 CONTINUOUS_INTEGRATION=0 NODE_OPTIONS= LLXPRT_CODE_NO_RELAUNCH=true LLXPRT_CODE_SKIP_TERMINAL_CAPABILITY_DETECTION=true LLXPRT_CODE_SUPPRESS_STATIC_HEADER=true node scripts/start.js --profile-load ${profile} --set emojifilter=allowed`,
    ],
    yolo: false,
    steps: [
      {
        type: 'waitFor',
        scope: 'screen',
        contains: 'Type your message',
        timeoutMs: 60000,
      },
      {
        type: 'line',
        text: PROMPT,
        submitKeys: ['Enter'],
        postTypeMs: 1000,
      },
      {
        type: 'waitFor',
        scope: 'scrollback',
        contains: 'LLXPRT2208_DONE',
        timeoutMs: 180000,
      },
      {
        type: 'capture',
        label: `issue2208-newlines-${profile}`,
        scope: 'scrollback',
      },
      { type: 'key', key: 'Escape' },
      { type: 'key', key: 'C-c' },
      { type: 'key', key: 'C-c' },
      { type: 'line', text: '/quit', submitKeys: ['Enter'] },
      { type: 'waitForExit', timeoutMs: 15000 },
    ],
  };
}

function runProfile(profile) {
  validateProfile(profile);
  const outDir = mkdtempSync(
    path.join(tmpdir(), `llxprt-issue2208-tui-${profile}-`),
  );
  const scriptPath = path.join(outDir, 'scenario.json');
  writeFileSync(scriptPath, JSON.stringify(createScenario(profile), null, 2));

  const result = spawnSync(
    process.execPath,
    [
      'scripts/tmux-harness.js',
      '--script',
      scriptPath,
      '--out-dir',
      outDir,
      '--assert',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'inherit',
      timeout: 300_000,
    },
  );

  if (result.error) {
    console.error(`[${profile}] ${result.error.message}`);
  }
  if (result.status === null && result.signal) {
    console.error(`[${profile}] timed out or was terminated: ${result.signal}`);
  }
  if (result.status === 0 && validateCapturedOutput(profile, outDir)) {
    console.log(`[${profile}] TUI preserved issue2208 line breaks`);
    rmSync(outDir, { recursive: true, force: true });
    return true;
  }
  console.error(`[${profile}] TUI repro failed; artifacts: ${outDir}`);
  return false;
}

let failed = false;
for (const profile of parseProfiles(process.argv)) {
  if (!runProfile(profile)) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}
