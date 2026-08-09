/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Invariant and subprocess tests proving that every workspace bunfig.toml
 * carries the browser-launch-guard preload, and that raw `bun test` from both
 * the repo root and a workspace directory marks the process and fails closed
 * for browser launches even when NODE_ENV is overridden to production.
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const GUARD_PRELOAD_FRAGMENT = 'browser-launch-guard.ts';
const GUARD_PRELOAD_PATH = '../../scripts/tests/browser-launch-guard.ts';

interface RootPackageJson {
  readonly workspaces: string[];
}

const rootPackageJson = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
) as RootPackageJson;
const WORKSPACE_PATHS = [...rootPackageJson.workspaces].sort();

function readWorkspaceBunfig(workspacePath: string): string {
  return readFileSync(join(repoRoot, workspacePath, 'bunfig.toml'), 'utf8');
}

describe('workspace bunfig browser-launch-guard invariant', () => {
  it.each(WORKSPACE_PATHS)(
    '%s/bunfig.toml includes the browser-launch-guard preload',
    (workspacePath: string) => {
      const bunfig = readWorkspaceBunfig(workspacePath);
      expect(bunfig).toContain(GUARD_PRELOAD_PATH);
    },
  );

  it('root bunfig.toml includes the browser-launch-guard preload', () => {
    const bunfig = readFileSync(join(repoRoot, 'bunfig.toml'), 'utf8');
    expect(bunfig).toContain(GUARD_PRELOAD_FRAGMENT);
  });
});

const launcherSourceUrl = pathToFileURL(
  join(
    repoRoot,
    'packages',
    'core',
    'src',
    'utils',
    'secure-browser-launcher.ts',
  ),
).href;

const BROWSER_COMMANDS = [
  'open',
  'xdg-open',
  'gnome-open',
  'kde-open',
  'firefox',
  'firefox-esr',
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
  'chrome.exe',
  'firefox.exe',
  'powershell.exe',
];

interface BrowserSafeFixture {
  readonly tempDir: string;
  readonly commandLog: string;
  readonly environment: NodeJS.ProcessEnv;
}

interface SubprocessResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly browserCommandAttempts: string;
}

function createBrowserSafeFixture(prefix: string): BrowserSafeFixture {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  const stubDirectory = join(tempDir, 'browser-command-stubs');
  const commandLog = join(tempDir, 'browser-command-attempts.log');
  mkdirSync(stubDirectory);

  // Windows probes intentionally get an empty PATH: unlike POSIX scripts, a
  // harmless executable stub cannot be created without shipping a binary.
  // This makes PowerShell resolution fail instead of risking a real launch.
  if (process.platform !== 'win32') {
    for (const command of BROWSER_COMMANDS) {
      const stubPath = join(stubDirectory, command);
      writeFileSync(
        stubPath,
        '#!/bin/sh\nprintf \'%s\\n\' "${0##*/}" >> "$LLXPRT_BROWSER_STUB_LOG"\n',
        'utf8',
      );
      chmodSync(stubPath, 0o755);
    }
  }

  const environment = { ...process.env };
  delete environment.PATH;
  delete environment.Path;
  delete environment.LLXPRT_RUNNING_TESTS;
  environment.PATH = stubDirectory;
  environment.LLXPRT_BROWSER_STUB_LOG = commandLog;
  environment.LLXPRT_ALLOW_BROWSER_LAUNCH_IN_TESTS = '';
  environment.NODE_ENV = 'production';

  return { tempDir, commandLog, environment };
}

function readBrowserCommandAttempts(commandLog: string): string {
  return existsSync(commandLog) ? readFileSync(commandLog, 'utf8') : '';
}

/**
 * Spawn a raw `bun test` from the requested directory. Browser commands are
 * shadowed by harmless stubs, so a guard regression records an attempt instead
 * of opening the operating system browser.
 */
function spawnRawBunTest(cwd?: string): SubprocessResult {
  const fixture = createBrowserSafeFixture('llxprt-guard-subprocess-');
  const tempTestFile = join(fixture.tempDir, 'guard-subprocess.test.ts');
  writeFileSync(
    tempTestFile,
    `import { test, expect } from 'bun:test';
import { openBrowserSecurely } from ${JSON.stringify(launcherSourceUrl)};

test('process is marked and browser launch fails closed', async () => {
  expect(process.env.LLXPRT_RUNNING_TESTS).toBe('true');
  await expect(openBrowserSecurely('https://example.com')).rejects.toThrow(
    'Browser launch is disabled during tests',
  );
});
`,
    'utf8',
  );

  try {
    const result = spawnSync(
      process.execPath,
      ['test', '--timeout', '15000', tempTestFile],
      {
        cwd: cwd ?? fixture.tempDir,
        encoding: 'utf8',
        env: fixture.environment,
        timeout: 60_000,
      },
    );
    return {
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      browserCommandAttempts: readBrowserCommandAttempts(fixture.commandLog),
    };
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
}

function spawnSourceFirstProbe(): SubprocessResult {
  const fixture = createBrowserSafeFixture('llxprt-source-first-');
  fixture.environment.LLXPRT_RUNNING_TESTS = '';
  const probe = `const { openBrowserSecurely } = await import(${JSON.stringify(
    launcherSourceUrl,
  )});
process.env = { ...process.env, LLXPRT_RUNNING_TESTS: 'true' };
let blocked = false;
try {
  await openBrowserSecurely('https://example.com');
} catch (error) {
  if (error instanceof Error && error.message.includes('Browser launch is disabled during tests')) {
    blocked = true;
  } else {
    throw error;
  }
}
if (!blocked) {
  throw new Error('Cached public launcher did not fail closed');
}
`;

  try {
    const result = spawnSync(process.execPath, ['--eval', probe], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: fixture.environment,
      timeout: 60_000,
    });
    return {
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      browserCommandAttempts: readBrowserCommandAttempts(fixture.commandLog),
    };
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
}

function expectSafeSubprocessSuccess(result: SubprocessResult): void {
  expect(
    result.status,
    `error: ${result.error ?? 'none'}\nsignal: ${result.signal ?? 'none'}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  ).toBe(0);
  expect(result.browserCommandAttempts).toBe('');
}

describe('raw bun test subprocess browser-launch guard', () => {
  it('fails its marker assertion without a root or workspace bunfig preload', () => {
    const result = spawnRawBunTest();

    expect(result.status).not.toBe(0);
    expect(result.browserCommandAttempts).toBe('');
  });

  it('marks the process and fails closed when run from the repo root', () => {
    expectSafeSubprocessSuccess(spawnRawBunTest(repoRoot));
  });

  it('marks the process and fails closed from a workspace with existing test configuration', () => {
    expectSafeSubprocessSuccess(
      spawnRawBunTest(join(repoRoot, 'packages', 'core')),
    );
  });

  it('marks the process and fails closed from a workspace that needs only the browser guard', () => {
    expectSafeSubprocessSuccess(
      spawnRawBunTest(join(repoRoot, 'packages', 'settings')),
    );
  });

  it('blocks after the public launcher was cached before the test marker was set', () => {
    expectSafeSubprocessSuccess(spawnSourceFirstProbe());
  });
});
