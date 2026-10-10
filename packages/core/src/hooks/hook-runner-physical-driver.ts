/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HookRunner } from './hookRunner.js';
import { HookEventName, HookType } from './types.js';
import { escapeShellArg } from '../utils/shell-utils.js';

const directory = process.argv[2];
if (process.argv.length < 3) throw new Error('Missing hook project directory');
const runner = new HookRunner(
  {
    environment: { ...process.env },
    sanitization: {
      enableEnvironmentVariableRedaction: false,
      allowedEnvironmentVariables: [],
      blockedEnvironmentVariables: [],
    },
  },
  () => true,
  () => new AbortController().signal,
);
const result = await runner.executeHook(
  {
    type: HookType.Command,
    command: `exec node ${escapeShellArg(join(directory, 'feedback.mts'), 'bash')}`,
  },
  HookEventName.BeforeTool,
  {
    session_id: 'same-label',
    cwd: directory,
    transcript_path: '',
    hook_event_name: HookEventName.BeforeTool,
    timestamp: '2026-10-06T00:00:00.000Z',
  },
);
await writeFile(join(directory, 'result.json'), JSON.stringify(result));
