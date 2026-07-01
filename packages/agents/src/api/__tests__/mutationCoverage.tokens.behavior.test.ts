/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// @plan:PLAN-20260621-COREAPIREMED.P23
// @requirement:REQ-001,REQ-002,REQ-005
//
// Second mutation-coverage file: targets additional SURVIVING mutant clusters
// on agentImpl.ts that are observable via the public Agent surface. Each case
// asserts on a REAL causally-driven output — no mock theater, no reverse tests.
//
// Targeted clusters (agentImpl.ts):
//   - getProviderStatus keyFile winner (line 652): keyFile-only auth surfaces
//     keyFile in the status, NOT keyName.
//   - getProviderStatus baseUrl surfacing (line 655): baseUrl present → surfaced.
//   - setModel (lines 684-690): a single model change reflects on getModel and
//     preserves turn continuity.
//   - compress status mapping (lines 873-883): compress returns the real status
//     + monotonic token counts.
//   - readCompressionTokenCount / readTurnCount (lines 1062, 1080): a real turn
//     drives turnCount strictly above zero (kills the null-guard + try/catch
//     fallback mutants on the non-null path).
//   - generate (line 929): the side-channel returns the model's text.
//   - restoreChatVisibility (line 1160): after a switch, a second turn drives
//     exactly one done (the carriedHistory path preserves continuity).
//   - provider-switch model-change guard (line 1130): a differing model reflects;
//     the no-op same-model case does not error.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  type AgentEvent,
  buildAgent,
  drain,
  countType,
  isTextEvent,
} from './helpers/agentHarness.js';

// ─── getProviderStatus auth-shape divergence ────────────────────────────────

describe('mutation P23.b — getProviderStatus auth-shape divergence (REQ-002)', () => {
  it('config.auth.apiKeyFile surfaces keyFile in getProviderStatus (keyfile winner guard) (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      auth: { apiKeyFile: '/tmp/my-keyfile.pem' },
    });
    try {
      const status = agent.getProviderStatus();
      // winner === 'keyfile' guard executes: keyFile surfaces, keyName does
      // NOT. Flipping the guard (always-true) would surface keyFile even when
      // the winner is wrong; flipping to always-false drops keyFile.
      expect(status.authStatus).toBe('authenticated');
      expect(status.keyFile).toBe('/tmp/my-keyfile.pem');
      expect(status.keyName).toBeUndefined();
    } finally {
      await cleanup();
    }
  }, 30000);

  it('config.auth.baseUrl surfaces in getProviderStatus (baseUrl guard) (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      auth: { baseUrl: 'https://custom.example.com/v1' },
    });
    try {
      const status = agent.getProviderStatus();
      expect(status.baseUrl).toBe('https://custom.example.com/v1');
    } finally {
      await cleanup();
    }
  }, 30000);

  it('a keyName winner does NOT surface keyFile (winner discrimination) (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      // keyName takes precedence over keyfile; both set proves discrimination.
      auth: { keyName: 'named-key', apiKeyFile: '/tmp/other.pem' },
    });
    try {
      const status = agent.getProviderStatus();
      expect(status.authStatus).toBe('authenticated');
      expect(status.keyName).toBe('named-key');
      // keyFile is NOT surfaced because the winner is keyName, not keyfile.
      expect(status.keyFile).toBeUndefined();
    } finally {
      await cleanup();
    }
  }, 30000);

  it('PROP generate: for any non-empty input string, generate returns a string (REQ-005)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (input) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            const result = await agent.generate(input);
            return typeof result === 'string';
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);

  it('PROP getStats: for any turn, totalTokens is a non-negative number (REQ-005)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }),
        async (input) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            await drain(agent.stream(input));
            const stats = agent.getStats();
            return (
              typeof stats.totalTokens === 'number' && stats.totalTokens >= 0
            );
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);
});

// ─── compress: status mapping + token counts (lines 873-883) ────────────────

describe('mutation P23.b — compress status + token counts (REQ-005)', () => {
  it('compress on a live session returns status compressed with monotonic token counts (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await drain(agent.stream('a turn to populate history'));
      const result = await agent.compress();
      // The status mapping executes: a successful compression yields
      // 'compressed' with numeric, monotonic (original >= new) counts.
      expect(result.status).toBe('compressed');
      expect(typeof result.originalTokenCount).toBe('number');
      expect(typeof result.newTokenCount).toBe('number');
      expect(result.originalTokenCount).toBeGreaterThanOrEqual(
        result.newTokenCount ?? 0,
      );
      expect(typeof result.promptId).toBe('string');
      expect(result.promptId.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('a custom promptId is echoed in the compress result (promptId fallback) (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await drain(agent.stream('a turn'));
      const result = await agent.compress({ promptId: 'custom-prompt-xyz' });
      expect(result.promptId).toBe('custom-prompt-xyz');
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── readTurnCount / readCompressionTokenCount non-null path (1062, 1080) ───

describe('mutation P23.b — stats turnCount reflects real history (REQ-005)', () => {
  it('after a turn, getStats turnCount is strictly positive (readTurnCount non-null path) (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      expect(agent.getStats().turnCount).toBe(0);
      await drain(agent.stream('one'));
      // readTurnCount executes its non-null path: the HistoryService is live,
      // so getStatistics().totalMessages > 0. The null-guard mutant (false)
      // and the try/catch-fallback mutant are both killed because turnCount
      // is strictly positive from a real read.
      expect(agent.getStats().turnCount).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('getStats returns a fully-numeric SessionStats shape with a positive turnCount after a turn (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await drain(agent.stream('a prompt with some tokens'));
      const s = agent.getStats();
      // projectStats returns a populated numeric snapshot on every field;
      // turnCount is strictly positive from the real readTurnCount path.
      expect(typeof s.promptTokens).toBe('number');
      expect(typeof s.candidateTokens).toBe('number');
      expect(typeof s.totalTokens).toBe('number');
      expect(typeof s.cachedTokens).toBe('number');
      expect(typeof s.contextWindowSize).toBe('number');
      expect(typeof s.contextWindowUsed).toBe('number');
      expect(s.turnCount).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── generate: side-channel text (line 929) ─────────────────────────────────

describe('mutation P23.b — generate side-channel (REQ-002)', () => {
  it('generate returns the model response text from a real drive (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const text = await agent.generate('hello');
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
      expect(text).toBe('a plain text reply');
    } finally {
      await cleanup();
    }
  }, 30000);

  it('generate with an explicit promptId does not error and returns text (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const text = await agent.generate('hello', { promptId: 'gen-xyz' });
      expect(text.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── restoreChatVisibility: switch continuity (line 1160) ───────────────────

describe('mutation P23.b — restoreChatVisibility switch continuity (REQ-005)', () => {
  it('after a provider+model switch, a second turn produces real text + one done (carriedHistory path) (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent(
      'provider-switch-two-turn.jsonl',
    );
    try {
      const e1: AgentEvent[] = await drain(agent.stream('turn one'));
      expect(countType(e1, 'done')).toBe(1);
      await agent.setProvider('newprov', 'newmodel');
      // The carriedHistory.length > 0 path executes (history was populated by
      // turn one); the switch rebinds the client and startChat carries history.
      const e2: AgentEvent[] = await drain(agent.stream('turn two'));
      expect(e2.filter(isTextEvent).length).toBeGreaterThanOrEqual(1);
      expect(countType(e2, 'done')).toBe(1);
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── Property-based (>=30% ratio) ───────────────────────────────────────────

describe('mutation P23.b — property cases @plan:PLAN-20260621-COREAPIREMED.P23 @requirement:REQ-005', () => {
  it('PROP setModel: for any model string, setModel reflects it and preserves continuity (REQ-005)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 40 })
          .filter((id) => id.trim() !== ''),
        async (model) => {
          const { agent, cleanup } = await buildAgent(
            'provider-switch-two-turn.jsonl',
          );
          try {
            await drain(agent.stream('turn one'));
            await agent.setModel(model);
            const continuity =
              countType(await drain(agent.stream('turn two')), 'done') === 1;
            return agent.getModel() === model && continuity;
          } finally {
            await cleanup();
          }
        },
      ),
      { numRuns: 8 },
    );
  }, 30000);

  it('PROP setModelParam/clear: for any string key + json value, round-trips through getModelParams (REQ-005)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 30 })
          .filter((k) => k !== '__proto__' && k !== 'constructor'),
        fc.jsonValue(),
        async (key, value) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            agent.setModelParam(key, value);
            const afterSet = agent.getModelParams()[key];
            agent.clearModelParam(key);
            const afterClear = key in agent.getModelParams();
            // JSON values round-trip via strict equality; compare structurally.
            const roundTripped =
              JSON.stringify(afterSet) === JSON.stringify(value);
            return roundTripped && !afterClear;
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);

  it('PROP keyFile auth: for any non-empty keyFile path, getProviderStatus surfaces it (keyfile guard) (REQ-002)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 60 }),
        async (keyFile) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
            auth: { apiKeyFile: keyFile },
          });
          try {
            const status = agent.getProviderStatus();
            return (
              status.authStatus === 'authenticated' &&
              status.keyFile === keyFile &&
              status.keyName === undefined
            );
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);

  it('PROP compress: for any custom promptId string, compress echoes it (REQ-005)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 40 })
          .filter((id) => id.trim() !== ''),
        async (promptId) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            await drain(agent.stream('turn'));
            const result = await agent.compress({ promptId });
            return result.promptId === promptId;
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);
});
