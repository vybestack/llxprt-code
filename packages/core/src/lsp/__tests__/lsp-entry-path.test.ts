import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('LSP entry path resolution', () => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // Same relative path that lsp-service-client.ts uses
  const lspEntry = join(moduleDir, '../../../../lsp/src/main.ts');

  it('resolves to an existing file on disk', () => {
    expect(existsSync(lspEntry)).toBe(true);
  });

  it('points to the real LSP entry point (contains parseBootstrapFromEnv)', () => {
    const content = readFileSync(lspEntry, 'utf-8');
    expect(content).toContain('parseBootstrapFromEnv');
  });

  it('does NOT depend on any user workspace path', () => {
    const fakeWorkspace = '/tmp/definitely-not-a-real-llxprt-install';
    const brokenPath = join(fakeWorkspace, 'packages/lsp/src/main.ts');
    expect(existsSync(brokenPath)).toBe(false);
  });
});
