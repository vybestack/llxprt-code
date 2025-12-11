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
// Unless required by applicable law_or_agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { spawn, execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { parseBootstrapArgs } from '../packages/cli/dist/src/config/profileBootstrap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const bootstrapSnapshot = parseBootstrapArgs();

// check build status, write warnings to file for app to display if needed
execSync('node ./scripts/check-build-status.js', {
  stdio: 'inherit',
  cwd: root,
});

const nodeArgs = [];
let sandboxCommand = undefined;
try {
  sandboxCommand = execSync('node scripts/sandbox_command.js', {
    cwd: root,
  })
    .toString()
    .trim();
} catch {
  // ignore
}
// if debugging is enabled and sandboxing is disabled, use --inspect-brk flag
// note with sandboxing this flag is passed to the binary inside the sandbox
// inside sandbox SANDBOX should be set and sandbox_command.js should fail
if (process.env.DEBUG && !sandboxCommand) {
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

  const uiChild = spawn('bun', uiArgs, {
    stdio: 'inherit',
    env: { ...process.env, CLI_VERSION: pkg.version, DEV: 'true' },
    cwd: root,
  });

  uiChild.on('close', (code) => {
    process.exit(code);
  });
} else {
  // Standard CLI path
  nodeArgs.push('./packages/cli');
  nodeArgs.push(...args);

  const env = {
    ...process.env,
    CLI_VERSION: pkg.version,
    DEV: 'true',
  };

  if (bootstrapSnapshot.bootstrapArgs.profileName) {
    env.LLXPRT_BOOTSTRAP_PROFILE = bootstrapSnapshot.bootstrapArgs.profileName;
  }
  if (bootstrapSnapshot.bootstrapArgs.providerOverride) {
    env.LLXPRT_BOOTSTRAP_PROVIDER =
      bootstrapSnapshot.bootstrapArgs.providerOverride;
  }

  if (process.env.DEBUG) {
    // If this is not set, the debugger will pause on the outer process rather
    // than the relaunched process making it harder to debug.
    env.LLXPRT_CODE_NO_RELAUNCH = 'true';
  }
  const child = spawn('node', nodeArgs, { stdio: 'inherit', env });

  child.on('close', (code) => {
    process.exit(code);
  });
}
