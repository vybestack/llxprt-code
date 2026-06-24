/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-001
 * @requirement:REQ-017
 *
 * Provider-by-name one-call bootstrap contract (RED). This RED file must exist
 * BEFORE P15. Behavioral integration tests against the public Agent API only.
 * Tests FAIL NATURALLY — stub methods throw NYI; no mock theater, only value
 * assertions.
 *
 * Covers:
 * - T25 provider-by-name one-call bootstrap; shared runtimeId/SettingsService
 *       behavior; post-auth client binding; static discovery; no deep imports.
 */

import { describe, it, expect } from 'vitest';
import type { ProviderInfo, ToolInfo } from '@vybestack/llxprt-code-agents';
import { buildAgent } from './helpers/agentHarness.js';

describe('Provider bootstrap @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-001 @requirement:REQ-017', () => {
  it('T25 one-call bootstrap — createAgent wires the named provider and the live agent reflects it @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-001', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      model: 'gpt-4o',
    });
    try {
      // one createAgent call bootstrapped the named provider; getProvider /
      // getModel reflect the bootstrap config without further calls.
      expect(agent.getProvider()).toBe('openai');
      expect(agent.getModel()).toBe('gpt-4o');
    } finally {
      await cleanup();
    }
  });

  it('T25 shared runtimeId/SettingsService behavior — two agents over the same fake provider are independent but both resolve @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-001', async () => {
    const first = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      model: 'gpt-4o',
    });
    const second = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    });
    try {
      // both agents resolve their own provider/model independently
      expect(first.agent.getProvider()).toBe('openai');
      expect(second.agent.getProvider()).toBe('anthropic');
      expect(first.agent.getModel()).toBe('gpt-4o');
      expect(second.agent.getModel()).toBe('claude-3-5-sonnet');

      // they are distinct instances (no shared mutable runtime state)
      expect(first.agent).not.toBe(second.agent);
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });

  it('T25 post-auth client binding — after auth the agent delegates to the bound client via a successful turn @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-001', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: { apiKey: 'sk-bootstrap' },
    });
    try {
      // after bootstrap + auth, the client is bound — observable via a turn
      // that completes with text + done (the client is reachable).
      const result = await agent.chat('post-auth turn');
      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.finishReason).toBe('stop');
    } finally {
      await cleanup();
    }
  });

  it('T25 modelParams bootstrap — configured modelParams seed the live provider state verbatim and an unconfigured agent starts with an empty map @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-001', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      modelParams: { temperature: 0.7, max_tokens: 256 },
    });
    try {
      // createAgent seeds providerState.modelParams from config.modelParams
      // (rs.modelParams ?? {}). getModelParams() surfaces the SAME values
      // verbatim. A LogicalOperator mutant collapsing the seed to {} would
      // surface an empty map here.
      const params = agent.getModelParams();
      expect(params.temperature).toBe(0.7);
      expect(params.max_tokens).toBe(256);
    } finally {
      await cleanup();
    }
  });

  it('T25 modelParams bootstrap — an agent with no configured modelParams starts with an empty parameter map @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-001', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      // The `?? {}` fallback yields an empty map when no params are configured.
      // (The live map is a null-prototype object, so assert on its key set.)
      expect(Object.keys(agent.getModelParams())).toStrictEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('T25 static discovery — listProviders/listTools return concrete arrays (no runtime discovery required for the bootstrap) @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-017', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      // static discovery surfaces are callable immediately after bootstrap
      const providers: readonly ProviderInfo[] = agent.listProviders();
      expect(Array.isArray(providers)).toBe(true);

      const tools: readonly ToolInfo[] = agent.listTools();
      expect(Array.isArray(tools)).toBe(true);

      // every provider/tool info has the expected structural shape
      for (const p of providers) {
        expect(typeof p.name).toBe('string');
        expect(typeof p.configured).toBe('boolean');
      }
      for (const t of tools) {
        expect(typeof t.name).toBe('string');
        expect(typeof t.source).toBe('string');
        expect(typeof t.enabled).toBe('boolean');
      }
    } finally {
      await cleanup();
    }
  });
});
