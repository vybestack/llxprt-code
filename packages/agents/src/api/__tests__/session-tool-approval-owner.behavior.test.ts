/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { fromConfig } from '../fromConfig.js';
import { CONFIRMATION_FORCING_SOURCE } from '../confirmationForcing.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { startCatalogFixture } from './helpers/workspace-catalog-http-fixture.js';

async function approve(details: unknown): Promise<void> {
  if (
    typeof details !== 'object' ||
    details === null ||
    !('onConfirm' in details) ||
    typeof details.onConfirm !== 'function'
  )
    throw new Error('Missing public confirmation callback');
  await details.onConfirm(ToolConfirmationOutcome.ProceedAlwaysTool);
}

describe('shared workspace session approval ownership', () => {
  it('keeps peer confirmation required after a session grant and peer closure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'session-approval-'));
    const server = await startCatalogFixture(directory);
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      workingDir: directory,
      folderTrust: true,
      policy: { defaultDecision: PolicyDecision.ASK_USER },
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpServers: { physical: { httpUrl: server.url, trust: false } },
    });
    built.mcpRuntime.policyOwner.session.confirmation.removeRulesBySource(
      CONFIRMATION_FORCING_SOURCE,
    );
    const adopt = () =>
      fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        config: built.config,
        providerManager: built.providerManager,
        mcpRuntime: built.mcpRuntime,
      });
    const first = await adopt();
    const second = await adopt();
    const signal = new AbortController().signal;
    try {
      await built.mcpRuntime.awaitDiscovery();
      const declared = first.tools
        .list()
        .find((tool) => tool.serverToolName === 'multiply');
      if (!declared) throw new Error('Missing physical MCP tool');
      const a = first.tools.get(declared.name);
      const b = second.tools.get(declared.name);
      if (!a || !b) throw new Error('Missing physical execution handles');
      const grant = await a.build({ factor: 3 }).shouldConfirmExecute(signal);
      expect(grant).toMatchObject({ type: 'mcp', toolName: 'multiply' });
      await approve(grant);
      expect(await a.build({ factor: 3 }).shouldConfirmExecute(signal)).toBe(
        false,
      );
      await a.build({ factor: 3 }).execute(signal);
      expect(await readFile(join(directory, 'product'), 'utf8')).toBe('21');
      const peerGrant = await b
        .build({ factor: 4 })
        .shouldConfirmExecute(signal);
      expect(peerGrant).toMatchObject({ type: 'mcp', toolName: 'multiply' });
      await first.dispose();
      expect(
        await b.build({ factor: 5 }).shouldConfirmExecute(signal),
      ).toMatchObject({ type: 'mcp', toolName: 'multiply' });
      await b.build({ factor: 5 }).execute(signal);
      expect(await readFile(join(directory, 'product'), 'utf8')).toBe('35');
      const closing = second.dispose();
      await expect(approve(peerGrant)).rejects.toThrow('closed');
      await closing;
    } finally {
      await first.dispose();
      await second.dispose();
      await built.cleanup();
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
