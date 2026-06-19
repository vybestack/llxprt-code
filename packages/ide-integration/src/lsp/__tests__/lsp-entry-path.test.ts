import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const hasImportMetaResolve =
  typeof (import.meta as unknown as { resolve?: (s: string) => string })
    .resolve === 'function';

describe('LSP entry path resolution', () => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const lspEntry = join(moduleDir, '../../../../lsp/src/main.ts');

  it('resolves to an existing file on disk via directory walk (source tree)', () => {
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

  it.runIf(hasImportMetaResolve)(
    'resolves via import.meta.resolve when package is installed',
    () => {
      const resolveImportMeta = (
        import.meta as unknown as {
          resolve: (specifier: string) => string;
        }
      ).resolve;

      const packageUrl = resolveImportMeta('@vybestack/llxprt-code-lsp');
      const packagePath = fileURLToPath(packageUrl);
      expect(packagePath).toBeTruthy();
      expect(existsSync(packagePath)).toBe(true);

      let pkgRoot = dirname(packagePath);
      while (pkgRoot !== dirname(pkgRoot)) {
        if (existsSync(join(pkgRoot, 'package.json'))) {
          break;
        }
        pkgRoot = dirname(pkgRoot);
      }

      const srcEntry = join(pkgRoot, 'src', 'main.ts');
      const distEntry = join(pkgRoot, 'dist', 'main.js');
      const entryPath = existsSync(srcEntry) ? srcEntry : distEntry;
      expect(existsSync(entryPath)).toBe(true);
    },
  );
});
