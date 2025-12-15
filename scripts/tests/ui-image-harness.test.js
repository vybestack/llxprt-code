import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('ui image harness', () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '../..');
  const result = spawnSync(
    'bun',
    ['run', 'packages/ui/scripts/image-harness.ts'],
    {
      cwd: repoRoot,
      env: { ...process.env, OTUI_IMAGE_TRACE: 'false' },
      encoding: 'utf8',
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
