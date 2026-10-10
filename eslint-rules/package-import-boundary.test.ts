/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const linter = new ESLint({ cwd: root });
const coreFile = `${root}packages/core/src/adapters/IStreamAdapter.ts`;
const providerFile = `${root}packages/providers/src/BaseProvider.ts`;

async function ruleIds(source: string, filePath: string): Promise<string[]> {
  const [result] = await linter.lintText(source, { filePath });
  return result.messages.map((message) => message.ruleId ?? 'unknown');
}

describe('package import boundaries', () => {
  it('permits a deep same-package relative import with emitted JavaScript', async () => {
    expect(
      await ruleIds("import '../services/history/IContent.js';", coreFile),
    ).toEqual([]);
  });

  it('permits a deep same-package relative import without emitted JavaScript', async () => {
    expect(
      await ruleIds("import '../services/ClipboardService.test.js';", coreFile),
    ).toEqual([]);
  });

  it('retains existing cross-package checks in other packages', async () => {
    expect(
      await ruleIds(
        "import '../../core/src/adapters/IStreamAdapter.ts';",
        providerFile,
      ),
    ).toContain('import/no-relative-packages');
  });

  it('rejects cross-package imports to emitted JavaScript from core', async () => {
    expect(
      await ruleIds(
        "import '../../../mcp/src/auth/oauth-provider.js';",
        coreFile,
      ),
    ).toContain('custom/package-import-boundary');
  });

  it('rejects cross-package relative imports when JavaScript is absent', async () => {
    expect(
      await ruleIds(
        "import '../../../providers/src/BaseProvider.js';",
        coreFile,
      ),
    ).toContain('custom/package-import-boundary');
  });

  it('rejects cross-package relative imports to TypeScript sources', async () => {
    expect(
      await ruleIds(
        "import '../../../providers/src/BaseProvider.ts';",
        coreFile,
      ),
    ).toContain('custom/package-import-boundary');
  });

  it('rejects cross-package re-exports without resolver output', async () => {
    expect(
      await ruleIds(
        "export * from '../../../providers/src/BaseProvider.js';",
        coreFile,
      ),
    ).toContain('custom/package-import-boundary');
  });

  it('rejects cross-package dynamic imports without resolver output', async () => {
    expect(
      await ruleIds(
        "void import('../../../providers/src/BaseProvider.js');",
        coreFile,
      ),
    ).toContain('custom/package-import-boundary');
  });

  it('retains the ban on external package internals', async () => {
    expect(
      await ruleIds(
        "import 'eslint-plugin-import/lib/rules/no-relative-packages.js';",
        coreFile,
      ),
    ).toContain('import/no-internal-modules');
  });
});
