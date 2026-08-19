/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3241: the nightly release died in "Build and push sandbox image"
 * when a transient `npm error code ECONNRESET` (mid-body connection reset on
 * the arm64 leg under QEMU) killed the single, un-retried
 * `npm install -g /tmp/*.tgz ...` layer. Nothing at any layer retried, so one
 * reset TCP connection aborted the entire release. The later
 * `npm install -g @vybestack/llxprt-ui` layer had the identical exposure.
 *
 * These tests read the repository's actual root `Dockerfile` (no fixture, no
 * mock of the artifact under test) and prove both network installs now ride
 * out transient failures:
 *
 *   - Behavioral execution: each RUN script is extracted from the Dockerfile,
 *     every `/tmp/` path is remapped into a test-owned temp directory (the
 *     tarball script's remap count is asserted to be non-zero so the test
 *     fails loudly if the Dockerfile drifts away from /tmp — the raw script
 *     must never execute because it ends in `rm -f /tmp/*.tgz`), `npm` and
 *     `sleep` are replaced via PATH shims (network and timing are
 *     infrastructure), and the remapped script is executed with `/bin/sh`
 *     exactly as the Docker build would execute it. Simulated transient
 *     failures must be retried up to three install attempts; cache clean and
 *     tarball removal must happen only on the success path; exhaustion must
 *     fail the RUN.
 *   - Static invariants: both scripts carry the attempts bound (3) and a
 *     backoff sleep; the tarball install stays ONE npm transaction holding
 *     all 12 tarball globs; the cache-clean/rm chain stays gated on a
 *     successful install.
 */

import { describe, expect, it } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const dockerfilePath = join(repoRoot, 'Dockerfile');

/**
 * POSIX sh shim that replaces `npm` during behavioral execution. Every
 * invocation is recorded in the shared shim log (`install` or `cache-clean`).
 * Install invocations simulate the transient ECONNRESET by exiting 1 while
 * the running install-attempt count is <= the fail-count held in the control
 * file, so `failFirstInstalls: 2` fails exactly the first two attempts.
 */
const NPM_SHIM = [
  '#!/bin/sh',
  'log="$SHIM_LOG"',
  'for argument in "$@"; do',
  '  if [ "$argument" = "cache" ]; then',
  '    echo cache-clean >>"$log"',
  '    exit 0',
  '  fi',
  '  if [ "$argument" = "install" ]; then',
  '    echo install >>"$log"',
  '    attempts=$(grep -c "^install$" "$log")',
  '    failAfter=$(cat "$SHIM_FAIL_CONTROL")',
  '    if [ "$attempts" -le "$failAfter" ]; then',
  '      exit 1',
  '    fi',
  '    exit 0',
  '  fi',
  'done',
  'exit 0',
].join('\n');

/**
 * POSIX sh shim that replaces `sleep` so backoff waits are recorded in the
 * log instead of actually pausing the suite (timing is infrastructure).
 */
const SLEEP_SHIM = ['#!/bin/sh', 'echo sleep >>"$SHIM_LOG"', 'exit 0'].join(
  '\n',
);

/**
 * Sentinel tarballs placed in the remapped /tmp directory before execution so
 * the tests can observe `rm -f <tmp>/*.tgz` behavior. One file per tarball
 * glob in the Dockerfile install command.
 */
const SENTINEL_TARBALLS: readonly string[] = [
  'vybestack-llxprt-code-tools-0.0.0.tgz',
  'vybestack-llxprt-code-storage-0.0.0.tgz',
  'vybestack-llxprt-code-auth-0.0.0.tgz',
  'vybestack-llxprt-code-settings-0.0.0.tgz',
  'vybestack-llxprt-code-telemetry-0.0.0.tgz',
  'vybestack-llxprt-code-ide-integration-0.0.0.tgz',
  'vybestack-llxprt-code-policy-0.0.0.tgz',
  'vybestack-llxprt-code-mcp-0.0.0.tgz',
  'vybestack-llxprt-code-core-0.0.0.tgz',
  'vybestack-llxprt-code-providers-0.0.0.tgz',
  'vybestack-llxprt-code-agents-0.0.0.tgz',
  'vybestack-llxprt-code-0.0.0.tgz',
];

/** Every tarball glob that must stay inside the single npm invocation. */
const TARBALL_GLOBS: readonly string[] = [
  '/tmp/vybestack-llxprt-code-tools-*.tgz',
  '/tmp/vybestack-llxprt-code-storage-*.tgz',
  '/tmp/vybestack-llxprt-code-auth-*.tgz',
  '/tmp/vybestack-llxprt-code-settings-*.tgz',
  '/tmp/vybestack-llxprt-code-telemetry-*.tgz',
  '/tmp/vybestack-llxprt-code-ide-integration-*.tgz',
  '/tmp/vybestack-llxprt-code-policy-*.tgz',
  '/tmp/vybestack-llxprt-code-mcp-*.tgz',
  '/tmp/vybestack-llxprt-code-core-*.tgz',
  '/tmp/vybestack-llxprt-code-providers-*.tgz',
  '/tmp/vybestack-llxprt-code-agents-*.tgz',
  '/tmp/vybestack-llxprt-code-*.tgz',
];

/**
 * A collapsed Dockerfile RUN instruction: the backslash continuations joined
 * into the single logical line whose shell script is asserted on and executed.
 */
interface RunInstruction {
  readonly collapsed: string;
}

/** What a behavioral execution observed, read back after the child exits. */
interface ScriptExecution {
  readonly exitCode: number | null;
  readonly log: readonly string[];
  readonly remainingTarballs: readonly string[];
  readonly tmpRemapCount: number;
}

function readDockerfile(): string {
  return readFileSync(dockerfilePath, 'utf8');
}

/**
 * Joins Dockerfile backslash-continuation lines into one logical line per
 * instruction (modeled on the issue #2903 collapse helper) and returns every
 * RUN instruction in collapsed form.
 */
function extractRunInstructions(dockerfile: string): readonly RunInstruction[] {
  const instructions: RunInstruction[] = [];
  let insideInstruction = false;
  let collapsed = '';

  const flush = (): void => {
    if (!insideInstruction) {
      return;
    }
    const instruction = { collapsed: collapsed.trim() };
    insideInstruction = false;
    collapsed = '';
    if (/^RUN(\s|$)/.test(instruction.collapsed)) {
      instructions.push(instruction);
    }
  };

  for (const line of dockerfile.split(/\r?\n/)) {
    if (!insideInstruction && /^\s*#/.test(line)) {
      continue; // comment lines never start an instruction
    }
    const trimmedEnd = line.trimEnd();
    const continued = trimmedEnd.endsWith('\\');
    insideInstruction = true;
    collapsed += ' ' + (continued ? trimmedEnd.slice(0, -1) : line.trim());
    if (!continued) {
      flush();
    }
  }
  flush();
  return instructions;
}

/**
 * Finds the first RUN instruction whose collapsed script satisfies `matches`,
 * failing loudly (never returning undefined) when the Dockerfile drifts.
 */
function findRunInstruction(
  dockerfile: string,
  matches: (collapsed: string) => boolean,
  description: string,
): RunInstruction {
  const found = extractRunInstructions(dockerfile).find(({ collapsed }) =>
    matches(collapsed),
  );
  if (!found) {
    throw new Error(`Dockerfile has no RUN instruction that ${description}`);
  }
  return found;
}

function tarballInstallRun(dockerfile: string): RunInstruction {
  return findRunInstruction(
    dockerfile,
    (collapsed) =>
      collapsed.includes('npm install -g') &&
      collapsed.includes('/tmp/vybestack-llxprt-code-tools-*.tgz'),
    'installs the release tarballs with npm',
  );
}

function uiInstallRun(dockerfile: string): RunInstruction {
  return findRunInstruction(
    dockerfile,
    (collapsed) =>
      collapsed.includes('npm install -g') &&
      collapsed.includes('@vybestack/llxprt-ui'),
    'installs @vybestack/llxprt-ui with npm',
  );
}

/** Strips the leading `RUN ` from a collapsed instruction. */
function runScript(instruction: RunInstruction): string {
  return instruction.collapsed.replace(/^RUN\s+/, '');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function logEntryCount(log: readonly string[], entry: string): number {
  return log.filter((line) => line === entry).length;
}

/**
 * Executes a Dockerfile RUN script with `/bin/sh`, remapping `/tmp/` into a
 * test-owned temp directory, shimming `npm` and `sleep` via PATH, and
 * (optionally) staging sentinel tarballs. The work directory is removed after
 * everything observable has been captured.
 */
function executeRunScript(options: {
  readonly script: string;
  readonly failFirstInstalls: number;
  readonly withSentinelTarballs: boolean;
}): ScriptExecution {
  const workdir = mkdtempSync(join(tmpdir(), 'issue3241-run-'));
  let execution: ScriptExecution;
  try {
    const remappedTmp = join(workdir, 'remapped-tmp');
    const binDir = join(workdir, 'bin');
    mkdirSync(remappedTmp);
    mkdirSync(binDir);

    const tmpRemapCount = countOccurrences(options.script, '/tmp/');
    const script = options.script.replaceAll('/tmp/', `${remappedTmp}/`);

    if (options.withSentinelTarballs) {
      for (const name of SENTINEL_TARBALLS) {
        writeFileSync(join(remappedTmp, name), 'sentinel');
      }
    }

    writeFileSync(join(binDir, 'npm'), NPM_SHIM);
    writeFileSync(join(binDir, 'sleep'), SLEEP_SHIM);
    chmodSync(join(binDir, 'npm'), 0o755);
    chmodSync(join(binDir, 'sleep'), 0o755);

    const logPath = join(workdir, 'shim.log');
    const controlPath = join(workdir, 'fail-after');
    writeFileSync(logPath, '');
    writeFileSync(controlPath, String(options.failFirstInstalls));

    const result = Bun.spawnSync({
      cmd: ['/bin/sh', '-c', script],
      cwd: workdir,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        SHIM_LOG: logPath,
        SHIM_FAIL_CONTROL: controlPath,
      },
    });

    const log = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    const remainingTarballs = readdirSync(remappedTmp).filter((name) =>
      name.endsWith('.tgz'),
    );

    execution = {
      exitCode: result.exitCode,
      log,
      remainingTarballs,
      tmpRemapCount,
    };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
  return execution;
}

const dockerfile = readDockerfile();
const tarballScript = runScript(tarballInstallRun(dockerfile));
const uiScript = runScript(uiInstallRun(dockerfile));

/**
 * The behavioral suites execute the extracted RUN scripts through /bin/sh
 * with POSIX PATH shims; stock Windows has neither. The nightly runs this
 * shard on windows-latest, so gate the execution suites (the static
 * invariant suites below still run everywhere). Mirrors the
 * describePosixOnly idiom in issue-2978-oven-fallback.bun.test.ts.
 */
const describePosixOnly =
  process.platform === 'win32' ? describe.skip : describe;

describePosixOnly(
  'issue #3241: Dockerfile tarball install RUN behavior',
  () => {
    it('recovers from two transient npm failures, cleans the cache, and removes the tarballs', () => {
      const result = executeRunScript({
        script: tarballScript,
        failFirstInstalls: 2,
        withSentinelTarballs: true,
      });

      // Remap guard: if the Dockerfile stops using /tmp, the script would run
      // against the real /tmp (it ends in `rm -f /tmp/*.tgz`) and the test
      // would silently prove nothing. Fail loudly instead.
      expect(
        result.tmpRemapCount,
        'tarball install RUN should reference /tmp paths that get remapped',
      ).toBeGreaterThan(0);

      expect(result.exitCode).toBe(0);
      expect(logEntryCount(result.log, 'install')).toBe(3);
      expect(logEntryCount(result.log, 'cache-clean')).toBe(1);
      expect(logEntryCount(result.log, 'sleep')).toBeGreaterThanOrEqual(2);
      expect(result.remainingTarballs).toEqual([]);
    });

    it('fails the build after three failed npm attempts without cleaning the cache or removing the tarballs', () => {
      const result = executeRunScript({
        script: tarballScript,
        failFirstInstalls: 99,
        withSentinelTarballs: true,
      });

      expect(result.tmpRemapCount).toBeGreaterThan(0);

      expect(result.exitCode).toBe(1);
      expect(logEntryCount(result.log, 'install')).toBe(3);
      expect(logEntryCount(result.log, 'cache-clean')).toBe(0);
      expect(result.remainingTarballs.length).toBe(SENTINEL_TARBALLS.length);
    });
  },
);

describePosixOnly(
  'issue #3241: Dockerfile @vybestack/llxprt-ui install RUN behavior',
  () => {
    // The ui install references no /tmp paths, so there is no remap-count guard
    // here; the install-count assertions below are what keep this from testing
    // nothing. The remap in executeRunScript still applies defensively in case
    // the script ever gains /tmp references.
    it('recovers from two transient npm failures and cleans the cache', () => {
      const result = executeRunScript({
        script: uiScript,
        failFirstInstalls: 2,
        withSentinelTarballs: false,
      });

      expect(result.exitCode).toBe(0);
      expect(logEntryCount(result.log, 'install')).toBe(3);
      expect(logEntryCount(result.log, 'cache-clean')).toBe(1);
      expect(logEntryCount(result.log, 'sleep')).toBeGreaterThanOrEqual(2);
    });

    it('fails the build after three failed npm attempts without cleaning the cache', () => {
      const result = executeRunScript({
        script: uiScript,
        failFirstInstalls: 99,
        withSentinelTarballs: false,
      });

      expect(result.exitCode).toBe(1);
      expect(logEntryCount(result.log, 'install')).toBe(3);
      expect(logEntryCount(result.log, 'cache-clean')).toBe(0);
    });
  },
);

describe('issue #3241: Dockerfile npm install retry invariants', () => {
  it('wraps both installs in a bounded retry of three attempts with backoff sleep', () => {
    // Structural, not literal: the behavioral suites pin the observable
    // contract (exactly 3 installs, sleeps between retries, exit 1 on
    // exhaustion) via shims, but they are skipped on Windows — this static
    // suite is what proves the retry structure exists there. Whitespace-
    // tolerant regexes keep semantically equivalent refactors green.
    for (const script of [tarballScript, uiScript]) {
      expect(script).toMatch(/attempts=\$\(\(attempts \+ 1\)\)/);
      expect(script).toMatch(/\[ \\?"\$attempts\\?" -ge 3 \]/);
      expect(script).toMatch(/sleep [0-9]+/);
      expect(script).toContain('exit 1');
    }
  });

  it('installs all 12 release tarballs in a single npm invocation', () => {
    for (const glob of TARBALL_GLOBS) {
      expect(tarballScript).toContain(glob);
    }
    expect(countOccurrences(tarballScript, 'npm install -g')).toBe(1);
  });

  it('gates cache clean and tarball removal on a successful install', () => {
    expect(tarballScript).toMatch(
      /done\s*&&\s*npm cache clean --force\s*&&\s*rm -f \S+\/\*\.tgz/,
    );
    expect(uiScript).toMatch(/done\s*&&\s*npm cache clean --force/);
  });
});
