/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import type { ProviderActivationIntent } from '../config-types.js';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { drain, countType } from './helpers/agentHarness.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

describe('preflight agent-owned runtime factory assembly @plan:ISSUE-3222 @requirement:REQ-3222-AC2', () => {
  useFakeResponsesReplay('tool-call-then-answer.jsonl');

  it('installs absent client and task defaults before activation and executes an adopted tool turn', async () => {
    const route = await openRouteBPreflight({
      config: { interactive: true },
    });
    let agent: Agent | undefined;
    try {
      await route.prepare();
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'auto',
      };
      const result = await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');
      if (!result.token) throw new Error('Missing preflight token');
      agent = await AgentProfilePreflight.createForegroundAgent(
        route.preflight,
        result.token,
        intent,
        {},
      );
      const events = await drain(agent.stream('read package metadata'));
      expect(countType(events, 'tool-result')).toBeGreaterThan(0);
      expect(countType(events, 'done')).toBe(1);
      expect(agent.tools.get('task')?.name).toBe('task');
    } finally {
      await agent?.dispose();
      await route.close();
    }
  });

  it('preserves caller client factory and adopted scheduler handle lifetime after preflight', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'factory-preservation-')),
    );
    let created = 0;
    let active = 0;
    let agent: Agent | undefined;
    try {
      agent = await createAgent({
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        interactive: true,
        harness: { forceConfirmations: false },
        activation: {
          provider: 'fake',
          cliOverrides: { key: 'caller-preflight-key' },
          authMode: 'auto',
        },
        toolSchedulerFactory: () => {
          created += 1;
          active += 1;
          return {
            dispose: () => {
              active -= 1;
            },
          };
        },
      });
      const events = await drain(agent.stream('read package metadata'));
      expect(countType(events, 'tool-result')).toBeGreaterThan(0);
      expect(created).toBeGreaterThan(0);
      expect(active).toBe(created);
      await agent.dispose();
      expect(active).toBe(0);
    } finally {
      await agent?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
