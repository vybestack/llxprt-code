/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P07
 *
 * Build-order determinism regression guard.
 *
 * The agents API tests must exercise the current source tree rather than stale
 * package dist artifacts. These tests assert the package-level alias config maps
 * the public root to source and that the public root import exposes newly added
 * runtime surfaces that stale dist artifacts would omit.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createAgent } from '@vybestack/llxprt-code-agents';
import { fixturesDir } from './helpers/agentHarness.js';

describe('agents API build-order determinism @plan:PLAN-20260626-RUNTIMEBOUNDARY.P07', () => {
  it('vitest aliases the public root to package source rather than dist @requirement:build-order @given:the package vitest config @when:its workspace alias plugin mapping is inspected @then:the public root maps to index.ts', async () => {
    const configPath = resolve(
      fileURLToPath(new URL('../../..', import.meta.url)),
      'vitest.config.ts',
    );
    const config = await readFile(configPath, 'utf8');
    expect(config).toContain('workspaceAliasPlugin');
    expect(config).toContain("new URL('./index.ts', import.meta.url)");
  });

  it('the new surface types are present at runtime via createAgent output @requirement:build-order @given:an agent built via the public root @when:its new readonly controls are accessed @then:memory, skills, workspace, and lsp are defined objects (proves the source build includes the new controls)', async () => {
    const prev = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = resolve(
      fixturesDir,
      'plain-text.jsonl',
    );
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: fixturesDir,
    });
    try {
      expect(agent.memory).toBeDefined();
      expect(agent.skills).toBeDefined();
      expect(agent.workspace).toBeDefined();
      expect(agent.lsp).toBeDefined();
    } finally {
      await agent.dispose();
      if (prev === undefined) {
        delete process.env.LLXPRT_FAKE_RESPONSES;
      } else {
        process.env.LLXPRT_FAKE_RESPONSES = prev;
      }
    }
  });
});
