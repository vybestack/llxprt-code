/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Prepares the cheap subagents for the issue #4084 scenario H tmux runs: two
 * profiles copied from the user's `haiku` profile, one with code mode off and
 * one with it on, and a gatherer subagent for each. Existing files with these
 * names are overwritten; nothing else in the config directory is touched.
 *
 * Usage: bun scripts/issue4084-subagent-setup.ts [--base-profile haiku]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-storage';

const GATHERER_PROMPT =
  'You gather facts from the repository for the agent that called you. Answer the goal with exact counts and file paths, and say how you got them.';

export interface SubagentSetup {
  readonly profiles: readonly string[];
  readonly subagents: readonly string[];
}

export function writeCodeModeSubagents(
  configDir: string,
  baseProfile: string,
): SubagentSetup {
  const base = JSON.parse(
    readFileSync(
      path.join(configDir, 'profiles', `${baseProfile}.json`),
      'utf8',
    ),
  ) as { ephemeralSettings?: Record<string, unknown> };
  mkdirSync(path.join(configDir, 'subagents'), { recursive: true });
  const now = new Date().toISOString();
  const written: { profiles: string[]; subagents: string[] } = {
    profiles: [],
    subagents: [],
  };
  for (const mode of ['off', 'on'] as const) {
    const profile = `issue4084-${baseProfile}-code-${mode}`;
    const subagent = `issue4084-gatherer-${mode}`;
    writeFileSync(
      path.join(configDir, 'profiles', `${profile}.json`),
      `${JSON.stringify(
        {
          ...base,
          ephemeralSettings: { ...base.ephemeralSettings, 'code-mode': mode },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      path.join(configDir, 'subagents', `${subagent}.json`),
      `${JSON.stringify(
        {
          name: subagent,
          profile,
          systemPrompt: GATHERER_PROMPT,
          createdAt: now,
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
    );
    written.profiles.push(profile);
    written.subagents.push(subagent);
  }
  return written;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--base-profile');
  const baseProfile = index < 0 ? 'haiku' : argv[index + 1];
  const result = writeCodeModeSubagents(
    Storage.getGlobalConfigDir(),
    baseProfile,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
