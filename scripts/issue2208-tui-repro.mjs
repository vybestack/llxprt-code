#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
      {
        type: 'expect',
        scope: 'scrollback',
        regex:
          'LLXPRT2208_ALPHA[\\s\\S]*Alpha paragraph one\\.[\\s\\S]*LLXPRT2208_BETA[\\s\\S]*[-*] beta item one[\\s\\S]*[-*] beta item two[\\s\\S]*LLXPRT2208_DONE',
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
  if (result.status === 0) {
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
