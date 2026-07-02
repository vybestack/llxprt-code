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
import { tmpdir } from 'os';
import { parseBootstrapArgs } from '../packages/cli/dist/src/config/profileBootstrap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const bootstrapSnapshot = parseBootstrapArgs();

/**
 * Prepare NODE_OPTIONS for child processes in DEV mode.
 * - Removes any existing --localstorage-file flags (with or without values)
 * - Adds --localstorage-file with a valid temp path to prevent warnings from
 *   react-devtools-core when it tries to access localStorage
 */
function prepareNodeOptionsForDev(nodeOptions) {
  // Remove any existing --localstorage-file flags (with or without values).
  // This faithfully reproduces the original regex semantics:
  //   /\s*--localstorage-file(?:(?:\s*=\s*|\s+)(?!-)\S+)?/g
  // (leading whitespace, optional value via '=' or a whitespace separator, and
  // a value is only consumed when it does not start with '-'). A manual scanner
  // avoids the catastrophic-backtracking risk of the regex while covering the
  // same inputs, including whitespace around '=' and tab separators.
  function skipWhitespace(options, i) {
    while (i < options.length && /\s/.test(options[i])) {
      i += 1;
    }
    return i;
  }
  function skipNonWhitespace(options, i) {
    while (i < options.length && !/\s/.test(options[i])) {
      i += 1;
    }
    return i;
  }
  // Given the index right after a flag token, return the index after any value
  // that should be consumed, or the unchanged flagEnd when no value is taken.
  function indexOfValueEnd(options, flagEnd) {
    const peek = skipWhitespace(options, flagEnd);
    const hadSeparator = peek > flagEnd;
    if (peek >= options.length) {
      return flagEnd;
    }
    if (options[peek] === '=') {
      const valueStart = skipWhitespace(options, peek + 1);
      if (valueStart >= options.length || options[valueStart] === '-') {
        return flagEnd;
      }
      return skipNonWhitespace(options, valueStart);
    }
    if (hadSeparator && options[peek] !== '-') {
      return skipNonWhitespace(options, peek);
    }
    return flagEnd;
  }
  function removeLocalStorageFlag(options) {
    if (!options) return '';
    const token = '--localstorage-file';
    let result = '';
    let cursor = 0;
    let searchFrom = options.indexOf(token);
    while (searchFrom !== -1) {
      // Consume leading whitespace immediately before the flag (the original
      // regex's leading \s*) so removing the flag does not leave a double space.
      let start = searchFrom;
      while (start > cursor && /\s/.test(options[start - 1])) {
        start -= 1;
      }
      result += options.slice(cursor, start);
      cursor = indexOfValueEnd(options, searchFrom + token.length);
      searchFrom = options.indexOf(token, cursor);
    }
    result += options.slice(cursor);
    return result;
  }
  const sanitized = removeLocalStorageFlag(nodeOptions)
    .replace(/\s+/g, ' ')
    .trim();

  // Add --localstorage-file with a valid path for DEV mode
  // This prevents warnings from react-devtools-core accessing localStorage
  const localStoragePath = join(tmpdir(), 'llxprt-dev-localstorage');
  const localStorageFlag = `--localstorage-file=${localStoragePath}`;

  return sanitized ? `${sanitized} ${localStorageFlag}` : localStorageFlag;
}

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

  const uiEnv = {
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
    NODE_OPTIONS: prepareNodeOptionsForDev(process.env.NODE_OPTIONS),
  };

  if (!env.LLXPRT_DEBUG_SESSION_ID && env.LLXPRT_DEBUG) {
    env.LLXPRT_DEBUG_SESSION_ID = `${process.pid}`;
  }

  if (bootstrapSnapshot.bootstrapArgs.profileName) {
    env.LLXPRT_BOOTSTRAP_PROFILE = bootstrapSnapshot.bootstrapArgs.profileName;
  }
  if (bootstrapSnapshot.bootstrapArgs.providerOverride) {
    env.LLXPRT_BOOTSTRAP_PROVIDER =
      bootstrapSnapshot.bootstrapArgs.providerOverride;
  }

  if (isInDebugMode) {
    // If this is not set, the debugger will pause on the outer process rather
    // than the relaunched process making it harder to debug.
    env.LLXPRT_CODE_NO_RELAUNCH = 'true';
  }
  const child = spawn('node', nodeArgs, { stdio: 'inherit', env });

  child.on('close', (code) => {
    process.exit(code);
  });
}
