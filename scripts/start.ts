/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { spawn, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  devLocalStorageFile,
  prepareDevNodeOptions,
} from './lib/node-options.ts';
import {
  isErrnoException,
  messageOf,
  propertyValue,
} from './utils/error-guards.ts';

interface PackageJson {
  version: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf-8'),
) as PackageJson;

/**
 * Prepare NODE_OPTIONS for child processes in DEV mode.
 * - Removes any existing --localstorage-file flags (with or without values)
 * - Adds --localstorage-file with a valid temp path to prevent warnings from
 *   react-devtools-core when it tries to access localStorage
 *
 * The implementation lives in ./lib/node-options.ts and is shared verbatim
 * with the memory launcher; this wrapper only pins start.ts's local-storage
 * path so behavior is identical.
 */
function prepareNodeOptionsForDev(nodeOptions: string | undefined): string {
  return prepareDevNodeOptions(nodeOptions, devLocalStorageFile());
}

const nodeArgs: string[] = [];
let sandboxCommand: string | undefined;
try {
  const output = execFileSync('bun', ['./scripts/sandbox_command.ts'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
  sandboxCommand = output || undefined;
} catch (error) {
  if (isErrnoException(error, 'ENOENT')) {
    console.error(
      'Bun runtime was not found. Install Bun (>=1.3.0) and ensure it is on PATH.',
    );
    process.exit(1);
  }
  const expectedNoSandbox = propertyValue(error, 'status') === 1;
  if (!expectedNoSandbox) {
    console.error(
      `Warning: sandbox command discovery failed: ${messageOf(error)}`,
    );
  }
}
// if debugging is enabled and sandboxing is disabled, use --inspect-brk flag
// note with sandboxing this flag is passed to the binary inside the sandbox
// inside sandbox SANDBOX should be set and sandbox_command.ts should fail
const isInDebugMode = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

if (isInDebugMode && !sandboxCommand) {
  if (process.env.SANDBOX) {
    const port = process.env.DEBUG_PORT || '9229';
    nodeArgs.push(`--inspect-brk=0.0.0.0:${port}`);
  } else {
    nodeArgs.push('--inspect-brk');
  }
}

// Check if --experimental-ui flag is present
const args = process.argv.slice(2);
const experimentalUi = args.includes('--experimental-ui');

// In development (running via this script), use bun for UI
if (experimentalUi) {
  // In development, launch UI with bun directly since it exports TypeScript
  const uiArgs = ['run', join(root, 'packages/ui/src/main.tsx')];
  // Filter out --experimental-ui and pass remaining args
  const filteredArgs = args.filter((a) => a !== '--experimental-ui');
  uiArgs.push(...filteredArgs);

  const uiEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CLI_VERSION: pkg.version,
    DEV: 'true',
    NODE_OPTIONS: prepareNodeOptionsForDev(process.env.NODE_OPTIONS),
  };

  if (!uiEnv.LLXPRT_DEBUG_SESSION_ID && uiEnv.LLXPRT_DEBUG) {
    uiEnv.LLXPRT_DEBUG_SESSION_ID = `${process.pid}`;
  }
  const uiChild = spawn('bun', uiArgs, {
    stdio: 'inherit',
    env: uiEnv,
    cwd: join(root, 'packages/ui'),
  });

  uiChild.on('error', (error) => {
    console.error(`Failed to spawn bun for UI: ${messageOf(error)}`);
    process.exit(1);
  });
  uiChild.on('close', (code) => {
    process.exit(code ?? 1);
  });
} else {
  // Standard CLI dev path: launch Bun directly on the TypeScript entry point.
  // The dev script (`npm run start`) is a development convenience; the
  // installed command (issue #2603) uses packages/cli/bin/llxprt, a POSIX sh
  // launcher that resolves the package-bundled Bun and execs the entry. Here
  // we do the equivalent for dev mode — spawn Bun directly on the source.
  // nodeArgs may carry --inspect-brk flags (Bun-compatible) that must precede
  // the entry path.
  const bunArgs = [...nodeArgs, './packages/cli/index.ts', ...args];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLI_VERSION: pkg.version,
    DEV: 'true',
    NODE_OPTIONS: prepareNodeOptionsForDev(process.env.NODE_OPTIONS),
  };

  if (!env.LLXPRT_DEBUG_SESSION_ID && env.LLXPRT_DEBUG) {
    env.LLXPRT_DEBUG_SESSION_ID = `${process.pid}`;
  }

  const child = spawn('bun', bunArgs, { stdio: 'inherit', env });

  child.on('error', (error) => {
    console.error(`Failed to spawn bun: ${messageOf(error)}`);
    process.exit(1);
  });
  child.on('close', (code) => {
    process.exit(code ?? 1);
  });
}
