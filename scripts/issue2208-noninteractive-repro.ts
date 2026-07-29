#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const startScript = path.join(scriptDir, 'start.ts');
const DEFAULT_PROFILES = ['gptfirst', 'gpt55high', 'opusthinking', 'glm'];
const EXPECTED = [
  'LLXPRT2208_ALPHA',
  '',
  'Alpha paragraph one.',
  '',
  'LLXPRT2208_BETA',
  '',
  '- beta item one',
  '- beta item two',
  '',
  'LLXPRT2208_DONE',
].join('\n');
const PROMPT = `Return exactly this text and nothing else, preserving every line break: ${EXPECTED}`;

interface StreamJsonEvent {
  type: string;
  role: string;
  content: string;
}

interface ProfileResult {
  profile: string;
  result: SpawnSyncReturns<string>;
  assistant: string;
  passed: boolean;
}

function parseProfiles(argv: string[]): string[] {
  const profiles = argv.slice(2);
  return profiles.length === 0 ? DEFAULT_PROFILES : profiles;
}

function parseAssistantOutput(stdout: string): string {
  return stdout
    .split(/\n/)
    .filter((line: string) => line.startsWith('{'))
    .map((line: string) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Failed to parse stream-json line: ${line}\n${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })
    .filter(
      (event: StreamJsonEvent) =>
        event.type === 'message' && event.role === 'assistant',
    )
    .map((event: StreamJsonEvent) => event.content)
    .join('');
}

function runProfile(profile: string): ProfileResult {
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

function printFailure({ profile, result, assistant }: ProfileResult): void {
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
