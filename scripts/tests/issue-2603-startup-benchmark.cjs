'use strict';

/**
 * Startup benchmark for issue #2603.
 *
 * Compares the direct native launcher against a simulated "old Node relay"
 * baseline (node spawning Bun on the same entry). Outputs median, iterations,
 * and ratio. There is NO pass/fail threshold — this is a measurement tool,
 * not a gate, to avoid flaky timing assertions.
 *
 * Platform behavior:
 *   POSIX: the source launcher (packages/cli/bin/llxprt) is a POSIX shell
 *     script that exec's bun.exe directly. It is benchmarked as-is.
 *   Windows: the source launcher is a POSIX shell script that cannot be spawned
 *     directly by Node. Instead, the benchmark resolves the REAL installed
 *     .cmd launcher (produced by install-native-launchers / npm cmd-shim) via
 *     the release-pack smoke replica, and invokes it through `cmd /c`. This
 *     measures the actual Windows production path. The Node-relay baseline
 *     spawns node -> bun.exe on both platforms so the comparison is fair.
 *
 * Usage: node scripts/tests/issue-2603-startup-benchmark.cjs [repoRoot] [iterations]
 *
 * Default iterations: 15 (enough for a stable median without excessive CI time)
 */

const { spawnSync } = require('node:child_process');
const { existsSync, appendFileSync, mkdirSync } = require('node:fs');
const { join, resolve, dirname } = require('node:path');

const repoRoot = resolve(process.argv[2] || process.cwd());
const isWindows = process.platform === 'win32';

/**
 * Validates that the iterations argument is a finite positive integer.
 * A non-numeric, non-integer, or non-positive value would produce NaN/0 sample
 * counts and a meaningless median. Fail with an actionable message instead.
 */
function parseIterations(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(
      `iterations must be a finite positive integer (got ${JSON.stringify(raw)}). ` +
        'Usage: node scripts/tests/issue-2603-startup-benchmark.cjs [repoRoot] [iterations]',
    );
  }
  return n;
}

const iterations = parseIterations(process.argv[3] || '15');
const posixLauncher = join(repoRoot, 'packages', 'cli', 'bin', 'llxprt');
const repoBun = join(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe');
// POSIX alternate: some installers place bun at node_modules/.bun/bin/bun.
const repoBunPosix = join(repoRoot, 'node_modules', '.bun', 'bin', 'bun');
const entry = process.env.LLXPRT_BENCH_ENTRY
  ? resolve(process.env.LLXPRT_BENCH_ENTRY)
  : join(repoRoot, 'packages', 'cli', 'index.ts');

/**
 * Cross-platform Bun discovery. The bun npm package installs bun at
 * node_modules/bun/bin/bun.exe on all platforms (Windows, macOS, Linux) —
 * the .exe suffix is part of the filename regardless of OS. On POSIX,
 * node_modules/.bun/bin/bun is also checked as a fallback for alternate
 * installers before falling back to a global lookup.
 */
function resolveBun() {
  // SMOKE HANDOFF: reuse the exact bun.exe the smoke validated (PE + version).
  const envBun = process.env.LLXPRT_BENCH_BUN;
  if (envBun && existsSync(envBun)) {
    validateExecutable(envBun);
    return envBun;
  }
  if (existsSync(repoBun)) {
    validateExecutable(repoBun);
    return repoBun;
  }
  if (!isWindows && existsSync(repoBunPosix)) {
    validateExecutable(repoBunPosix);
    return repoBunPosix;
  }
  const tool = isWindows ? 'where' : 'which';
  const r = spawnSync(tool, ['bun'], { encoding: 'utf8' });
  if (r.error) {
    throw new Error(
      `Could not discover bun via '${tool}': ${r.error.message}. ` +
        'Ensure Bun is installed and on PATH.',
    );
  }
  if (r.status !== 0) {
    throw new Error(
      `'${tool} bun' exited ${r.status}: ${r.stderr || r.stdout}. ` +
        'Ensure Bun is installed and on PATH.',
    );
  }
  const found = r.stdout.trim().split(/\r?\n/)[0];
  if (!found) {
    throw new Error(`'${tool} bun' produced no output.`);
  }
  validateExecutable(found);
  return found;
}

/**
 * Validates that a resolved Bun path is actually executable (exists and has
 * execute permission on POSIX). A non-executable file would produce a confusing
 * spawn failure.
 */
function validateExecutable(bunPath) {
  if (!existsSync(bunPath)) {
    throw new Error(`Resolved bun path does not exist: ${bunPath}`);
  }
  if (!isWindows) {
    try {
      const { accessSync, constants } = require('node:fs');
      accessSync(bunPath, constants.X_OK);
    } catch {
      throw new Error(`Resolved bun path is not executable: ${bunPath}`);
    }
  }
}

/**
 * On Windows, resolves the real installed .cmd launcher. Two modes:
 *   - SMOKE HANDOFF (preferred): when LLXPRT_BENCH_LAUNCHER is set (by the
 *     smoke orchestrator), use it directly. This avoids repacking/reinstalling
 *     — the smoke already proved the install, so the benchmark reuses it.
 *   - STANDALONE: when run directly by the workflow, pack+install a replica
 *     from the release-pack helper. This is the fallback for when the
 *     benchmark runs as a separate workflow step.
 * Returns {command, args} for spawnSync. On POSIX, returns the source launcher
 * path for direct exec.
 */
function resolveDirectLauncherInvocation() {
  if (!isWindows) {
    return { command: posixLauncher, baseArgs: [] };
  }
  // SMOKE HANDOFF: reuse the installed launcher the smoke already built.
  const envLauncher = process.env.LLXPRT_BENCH_LAUNCHER;
  if (envLauncher && existsSync(envLauncher)) {
    return { command: 'cmd', baseArgs: ['/c', envLauncher] };
  }
  // STANDALONE: use the real installed .cmd launcher from the smoke replica.
  // The release-pack helper produces a release-like tarball whose postinstall
  // generates llxprt.cmd. We resolve it from the smoke replica's global prefix.
  const releasePackHelper = join(
    repoRoot,
    'scripts',
    'tests',
    'issue-2603-release-pack.cjs',
  );
  const { packReleaseLikeCli } = require(releasePackHelper);
  const { replicaTarball } = packReleaseLikeCli(repoRoot);

  // Install into a temp prefix to get the generated .cmd launcher.
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-bench-'));
  const prefix = join(tempDir, 'prefix');
  mkdirSync(prefix, { recursive: true });

  const { npmInvocation } = require('../lib/npm-command.cjs');
  const { command: npmCmd, args: npmArgs } = npmInvocation([
    'install',
    '--global',
    '--prefix',
    prefix,
    '--cache',
    join(tempDir, 'cache'),
    '--loglevel',
    'error',
    replicaTarball,
  ]);
  const installResult = spawnSync(npmCmd, npmArgs, {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (installResult.error) {
    throw new Error(
      `benchmark replica install spawn failed: ${installResult.error.message}`,
    );
  }
  if (installResult.status !== 0) {
    throw new Error(
      `benchmark replica install failed (exit ${installResult.status}): ${installResult.stderr}`,
    );
  }

  const cmdLauncher = join(prefix, 'llxprt.cmd');
  if (!existsSync(cmdLauncher)) {
    throw new Error(`Installed .cmd launcher not found at ${cmdLauncher}`);
  }
  // The .cmd launcher lives inside tempDir, so cleanup must wait until the
  // process exits. Register an exit handler to remove the temp install dir
  // so a standalone benchmark run does not leak it.
  const tempDirRef = tempDir;
  const cleanup = () => {
    try {
      rmSync(tempDirRef, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  };
  process.on('exit', cleanup);
  return { command: 'cmd', baseArgs: ['/c', cmdLauncher] };
}

function timeDirectLauncher(launcherInvocation) {
  // The production launcher: resolves package-local Bun and execs the entry.
  // Use stdio 'inherit' to match the relay baseline so the comparison
  // measures startup overhead, not I/O plumbing differences.
  const r = spawnSync(
    launcherInvocation.command,
    [...launcherInvocation.baseArgs, '--version'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30_000,
      stdio: 'inherit',
      env: { ...process.env },
    },
  );
  if (r.error) {
    throw new Error(`direct launcher spawn failed: ${r.error.message}`);
  }
  // Never coerce a null/signal/timeout status to 0. A null status means the
  // child was killed by a signal or timed out; surface it as a failure.
  if (r.status === null) {
    throw new Error(
      `direct launcher did not exit normally (signal=${r.signal ?? 'none'}): ${r.stderr}`,
    );
  }
  if (r.status !== 0) {
    throw new Error(`direct launcher exited ${r.status}: ${r.stderr}`);
  }
  return r.status;
}

function timeNodeRelayBaseline(bunExe) {
  // Simulates the OLD relay path: node starts, locates Bun, then spawns Bun
  // on the entry. We pass bun/entry as argv to the relay script rather than
  // interpolating them into the generated source, so there is no string
  // injection surface (the values are never reparsed as code).
  // stdio 'inherit' matches the direct launcher for a fair comparison.
  const relayScript = `
    const { spawnSync } = require('child_process');
    // When Node runs 'node -e <script> <arg1> <arg2>', process.argv is:
    //   [0] = node path, [1] = inline script source, [2] = arg1, [3] = arg2
    // So bunExe is argv[2] and entry is argv[3], NOT argv[1]/[2].
    const bunExe = process.argv[2];
    const entry = process.argv[3];
    const r = spawnSync(bunExe, [entry, '--version'], {
      stdio: 'inherit',
      env: process.env,
    });
    if (r.error) {
      console.error('relay spawn failed:', r.error.message);
      process.exit(1);
    }
    if (r.status === null) {
      console.error('relay child killed by signal:', r.signal || 'none');
      process.exit(1);
    }
    process.exit(r.status);
  `;
  const r = spawnSync('node', ['-e', relayScript, bunExe, entry], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: 'inherit',
    env: { ...process.env },
  });
  if (r.error) {
    throw new Error(`node relay spawn failed: ${r.error.message}`);
  }
  if (r.status === null) {
    throw new Error(
      `node relay did not exit normally (signal=${r.signal ?? 'none'}): ${r.stderr}`,
    );
  }
  if (r.status !== 0) {
    throw new Error(`node relay exited ${r.status}: ${r.stderr}`);
  }
  return r.status;
}

function measure(fn, label) {
  const samples = [];
  // Warmup run (not counted) to stabilize FS cache.
  const warmupStatus = (() => {
    try {
      return fn();
    } catch (e) {
      console.error(`Warmup failed for ${label}: ${e.message}`);
      return null;
    }
  })();
  if (warmupStatus === null) return null;
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    let status;
    try {
      status = fn();
    } catch (e) {
      console.error(`${label} iteration ${i} failed: ${e.message}`);
      return null;
    }
    const t1 = process.hrtime.bigint();
    // A nonzero status is a meaningful failure: don't silently include it as
    // a valid sample. Surface it so the benchmark result is trustworthy.
    if (status !== 0) {
      console.error(`${label} iteration ${i} exited ${status}, not 0`);
      return null;
    }
    samples.push(Number(t1 - t0) / 1e6); // ms
  }
  samples.sort((a, b) => a - b);
  // True median: for odd-length arrays, the middle element; for even-length,
  // the average of the two middle elements. The default iteration count is 15
  // (odd), so this only changes behavior for a user-specified even count.
  const mid = Math.floor(samples.length / 2);
  const median =
    samples.length % 2 === 1
      ? samples[mid]
      : (samples[mid - 1] + samples[mid]) / 2;
  const min = samples[0];
  const max = samples[samples.length - 1];
  return { median, min, max, samples };
}

function main() {
  // POSIX: validate the source launcher exists. Windows: the real launcher is
  // resolved from the installed replica at benchmark time.
  if (!isWindows && !existsSync(posixLauncher)) {
    console.error(`Launcher not found: ${posixLauncher}`);
    process.exit(1);
  }
  const bunExe = resolveBun();
  if (!existsSync(entry)) {
    console.error(`Benchmark entry not found: ${entry}`);
    process.exit(1);
  }

  console.log(`Startup benchmark (issue #2603)`);
  console.log(`  platform:  ${process.platform}`);
  console.log(`  iterations: ${iterations}`);
  if (!isWindows) {
    console.log(`  launcher:   ${posixLauncher}`);
  } else {
    console.log(
      `  launcher:   ${process.env.LLXPRT_BENCH_LAUNCHER ? '(smoke handoff)' : '(installed .cmd from replica)'}`,
    );
  }
  console.log(`  bun:        ${bunExe}`);
  console.log(`  entry:      ${entry}`);
  console.log('');

  const launcherInvocation = resolveDirectLauncherInvocation();
  const direct = measure(
    () => timeDirectLauncher(launcherInvocation),
    'direct-launcher',
  );
  const relay = measure(() => timeNodeRelayBaseline(bunExe), 'node-relay');

  function fmt(r) {
    if (!r) return 'FAILED';
    return `median=${r.median.toFixed(1)}ms min=${r.min.toFixed(1)}ms max=${r.max.toFixed(1)}ms`;
  }

  console.log(`  direct-launcher: ${fmt(direct)}`);
  console.log(`  node-relay:      ${fmt(relay)}`);

  if (direct && relay && direct.median > 0) {
    const ratio = relay.median / direct.median;
    console.log(
      `  ratio (relay/direct median): ${ratio.toFixed(2)}x ` +
        `(relay is ${ratio > 1 ? 'slower' : 'faster'})`,
    );
  }

  // Output a GitHub Actions step-summary table if available.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summaryDir = dirname(process.env.GITHUB_STEP_SUMMARY);
    // Ensure the summary parent directory exists before appending.
    try {
      mkdirSync(summaryDir, { recursive: true });
    } catch {
      // best-effort; appendFileSync may still succeed if the dir exists.
    }
    const lines = [
      '### Startup Benchmark (issue #2603)',
      '',
      '| Path | Median (ms) | Min (ms) | Max (ms) |',
      '|---|---|---|---|',
    ];
    if (direct) {
      lines.push(
        `| direct-launcher | ${direct.median.toFixed(1)} | ${direct.min.toFixed(1)} | ${direct.max.toFixed(1)} |`,
      );
    }
    if (relay) {
      lines.push(
        `| node-relay | ${relay.median.toFixed(1)} | ${relay.min.toFixed(1)} | ${relay.max.toFixed(1)} |`,
      );
    }
    if (direct && relay && direct.median > 0) {
      lines.push(
        `| ratio (relay/direct) | ${(relay.median / direct.median).toFixed(2)}x | - | - |`,
      );
    }
    // Best-effort step-summary write: a failure here (locked file, disk full,
    // permissions) must not mask a successful benchmark run.
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
    } catch (e) {
      console.warn(`Could not append to GITHUB_STEP_SUMMARY: ${e.message}`);
    }
  }
}

// Export the pure resolver helpers so unit tests can validate the env-handoff
// behavior (LLXPRT_BENCH_LAUNCHER / LLXPRT_BENCH_BUN) without spawning the
// full benchmark. Only run main() when invoked directly as a script.
module.exports = {
  resolveBun,
  resolveDirectLauncherInvocation,
  parseIterations,
  validateExecutable,
};

if (require.main === module) {
  main();
}
