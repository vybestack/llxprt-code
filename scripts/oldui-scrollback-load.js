#!/usr/bin/env node
/**
 * Emits a predictable stream of lines over time (used by old Ink UI harnesses).
 *
 * Example:
 *   node scripts/oldui-scrollback-load.js --total 60 --interval-ms 250
 */

function parseArgs(argv) {
  const args = [...argv];
  const opts = {
    total: 60,
    intervalMs: 250,
    prefix: 'SCROLLTEST LINE',
  };

  const takeValue = (flag) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const value = args[idx + 1];
    if (!value || value.startsWith('-')) {
      throw new Error(`Missing value for ${flag}`);
    }
    args.splice(idx, 2);
    return value;
  };

  const total = takeValue('--total');
  if (total !== null) opts.total = Number(total);

  const intervalMs = takeValue('--interval-ms');
  if (intervalMs !== null) opts.intervalMs = Number(intervalMs);

  const prefix = takeValue('--prefix');
  if (prefix !== null) opts.prefix = prefix;

  if (args.length > 0) {
    throw new Error(`Unknown args: ${args.join(' ')}`);
  }

  if (!Number.isFinite(opts.total) || opts.total <= 0) {
    throw new Error(`Invalid --total: ${opts.total}`);
  }
  if (!Number.isFinite(opts.intervalMs) || opts.intervalMs <= 0) {
    throw new Error(`Invalid --interval-ms: ${opts.intervalMs}`);
  }

  return opts;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  for (let i = 1; i <= opts.total; i += 1) {
    const n = String(i).padStart(4, '0');
    process.stdout.write(`${opts.prefix} ${n}\n`);
    if (i < opts.total) {
      await sleep(opts.intervalMs);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
