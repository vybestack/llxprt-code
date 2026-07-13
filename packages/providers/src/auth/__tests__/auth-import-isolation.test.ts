/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2417: Importing the providers auth entry point must NOT transitively
 * load any tool implementation modules from @vybestack/llxprt-code-tools.
 *
 * Before the fix, the import chain was:
 *   auth.js -> provider-registry.ts -> @vybestack/llxprt-code-core (barrel)
 *   -> config.ts -> ActivateSkillTool -> ast-grep native addons
 *
 * After the fix, provider-registry.ts imports DebugLogger from a deep path
 * (@vybestack/llxprt-code-core/debug/DebugLogger.js), and config.ts no longer
 * imports ActivateSkillTool (the registration is inverted via a hook).
 *
 * This test verifies the isolation by mocking the specific tool implementation
 * modules with factories that track whether they were loaded, then dynamically
 * importing the auth index. If any tool implementation is transitively loaded,
 * the corresponding spy will have been called.
 *
 * Note: we intentionally do NOT mock the tools barrel itself, because the auth
 * import graph legitimately reaches utility functions (e.g.
 * canonicalizeToolName) that are exported from the barrel but do not load any
 * tool implementations or native addons. The acceptance criteria is "loads
 * zero tool implementations," not "zero contact with the tools package."
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

describe('auth import isolation @issue:2417', () => {
  afterEach(() => {
    vi.doUnmock('@vybestack/llxprt-code-tools/tools/activate-skill.js');
    vi.doUnmock('@ast-grep/napi');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('importing auth index does not load ActivateSkillTool or ast-grep native modules', async () => {
    const activateSkillSpy = vi.fn(() => {
      throw new Error(
        'ActivateSkillTool module was loaded during auth import — import isolation broken (#2417)',
      );
    });
    vi.doMock(
      '@vybestack/llxprt-code-tools/tools/activate-skill.js',
      activateSkillSpy,
    );

    const napiSpy = vi.fn(() => {
      throw new Error(
        '@ast-grep/napi was loaded during auth import — import isolation broken (#2417)',
      );
    });
    vi.doMock('@ast-grep/napi', napiSpy);

    vi.resetModules();

    // Dynamically import the auth entry from source (not dist) to verify
    // the source-level import graph does not reach tool implementations.
    const authModule = await import('../index.js');

    // Sanity: the auth module actually loaded.
    expect(authModule).toBeDefined();
    expect(typeof authModule.ProviderRegistry).toBe('function');

    expect(activateSkillSpy).not.toHaveBeenCalled();
    expect(napiSpy).not.toHaveBeenCalled();
  });
});
