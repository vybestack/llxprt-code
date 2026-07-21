'use strict';

/**
 * Startup benchmark for issue #2603.
 *
 * Compares the direct POSIX launcher (packages/cli/bin/llxprt) against a
 * simulated "old Node relay" baseline (node spawning Bun on the same entry).
 * Outputs median, iterations, and ratio. There is NO pass/fail threshold —
 * this is a measurement tool, not a gate, to avoid flaky timing assertions.
 *
 * Usage: node scripts/tests/issue-2603-startup-benchmark.cjs [repoRoot] [iterations]
 *
 * Default iterations: 15 (enough for a stable median without excessive CI time)
 */

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const repoRoot = resolve(process.argv[2] || process.cwd());

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
const launcher = join(repoRoot, 'packages', 'cli', 'bin', 'llxprt');
const repoBun = join(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe');
const entry = join(repoRoot, 'packages', 'cli', 'index.ts');

/**
 * Cross-platform Bun discovery. The bun npm package installs bun at
 * node_modules/bun/bin/bun.exe on all platforms (Windows, macOS, Linux) —
 * the .exe suffix is part of the filename regardless of OS. On POSIX,
 * .bun/bin/bun is also checked as a fallback for alternate installers.
 */
function resolveBun() {
  if (existsSync(repoBun)) return repoBun;
  const tool = process.platform === 'win32' ? 'where' : 'which';
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
  const found = r.stdout.trim().split('\n')[0];
  if (!found) {
    throw new Error(`'${tool} bun' produced no output.`);
  }
  return found;
}

function timeDirectLauncher() {
  // The production launcher: resolves package-local Bun and execs the entry.
  // Use stdio 'inherit' to match the relay baseline so the comparison
  // measures startup overhead, not I/O plumbing differences.
  const r = spawnSync(launcher, ['--version'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: 'inherit',
    env: { ...process.env },
  });
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
  const relayScript = `
    const { spawnSync } = require('child_process');
    const bunExe = process.argv[1];
    const entry = process.argv[2];
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
    env: { ...process.env },
  });
  if (r.error) {
    throw new Error(`node relay spawn failed: ${r.error.message}`);
  }
  // Never coerce a null/signal/timeout status to 0. A null status means the
  // relay child was killed by a signal or timed out; surface it as a failure.
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
  try {
    fn();
  } catch (e) {
    console.error(`Warmup failed for ${label}: ${e.message}`);
    return null;
  }
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    try {
      fn();
    } catch (e) {
      console.error(`${label} iteration ${i} failed: ${e.message}`);
      return null;
    }
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6); // ms
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const min = samples[0];
  const max = samples[samples.length - 1];
  return { median, min, max, samples };
}

function main() {
  if (!existsSync(launcher)) {
    console.error(`Launcher not found: ${launcher}`);
    process.exit(1);
  }
  const bunExe = resolveBun();

  console.log(`Startup benchmark (issue #2603)`);
  console.log(`  iterations: ${iterations}`);
  console.log(`  launcher:   ${launcher}`);
  console.log(`  bun:        ${bunExe}`);
  console.log('');

  const direct = measure(timeDirectLauncher, 'direct-launcher');
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
    const fs = require('fs');
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
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
}

main();
