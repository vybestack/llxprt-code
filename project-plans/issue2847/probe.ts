/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Temporary preflight probe for issue #2847: runs each candidate test file
 * under Bun's native runner in an isolated process and reports pass/fail.
 *
 * Usage: bun project-plans/issue2847/probe.ts <cwd> <preload|-> <file...>
 */

const [cwd, preloadArg, ...files] = process.argv.slice(2);
const preloads = preloadArg === '-' ? [] : preloadArg.split(',');

const failures: string[] = [];
for (const file of files) {
  const args = ['test', '--max-concurrency', '1', '--timeout', '30000'];
  for (const p of preloads) {
    args.push('--preload', p);
  }
  args.push(file);
  const child = Bun.spawnSync([process.execPath, ...args], {
    cwd,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 180_000,
  });
  const out =
    new TextDecoder().decode(child.stdout ?? new Uint8Array()) +
    new TextDecoder().decode(child.stderr ?? new Uint8Array());
  const ok = child.exitCode === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file}`);
  if (!ok) {
    failures.push(file);
    const lines = out.split('\n').filter((l) => l.trim().length > 0);
    console.log(
      lines
        .slice(-25)
        .map((l) => `      ${l}`)
        .join('\n'),
    );
  }
}
console.log(`\n${files.length - failures.length}/${files.length} passed`);
if (failures.length > 0) {
  console.log('FAILED FILES:');
  for (const f of failures) console.log(`  ${f}`);
}
