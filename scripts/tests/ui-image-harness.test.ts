import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const harnessPath = path.join(repoRoot, 'packages/ui/scripts/image-harness.ts');
const forceHarness =
  process.env.LLXPRT_FORCE_IMAGE_HARNESS === '1' ||
  process.env.LLXPRT_FORCE_IMAGE_HARNESS === 'true';
const skipVar = process.env.LLXPRT_SKIP_IMAGE_HARNESS;
const harnessMissing = !fs.existsSync(harnessPath);
const skipRequested = skipVar === '1' || skipVar === 'true';
const isLinuxCI = process.platform === 'linux' && process.env.CI === 'true';
const isCI = process.env.CI === 'true';
const shouldSkipUnlessForced =
  harnessMissing || isCI || skipRequested || isLinuxCI;
const shouldSkipHarness = !forceHarness && shouldSkipUnlessForced;

if (shouldSkipHarness) {
  console.warn(
    'Skipping ui-image-harness (missing harness or linux CI/libspng instability; see #816).',
  );
}

const runTest = shouldSkipHarness ? test.skip : test;

runTest('ui image harness', () => {
  const result = spawnSync(
    'bun',
    ['run', 'packages/ui/scripts/image-harness.ts'],
    {
      cwd: repoRoot,
      env: { ...process.env, OTUI_IMAGE_TRACE: 'false' },
      encoding: 'utf8',
      timeout: 30000,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    throw new Error(
      `image harness failed (exit ${result.status})\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    );
  }
});
