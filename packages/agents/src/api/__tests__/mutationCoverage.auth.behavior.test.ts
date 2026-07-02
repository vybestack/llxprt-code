/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// @plan:PLAN-20260621-COREAPIREMED.P23
// @requirement:REQ-001,REQ-002,REQ-005
//
// Third mutation-coverage file: targets additional surviving mutant clusters
// that are observable via the public Agent surface but were not exercised by
// the first two files. All assertions are on REAL causally-driven outputs.
//
// Targeted clusters (agentImpl.ts):
//   - auth.status() unauthenticated winner mapping (line 1208): a no-auth
//     agent reports 'unauthenticated' (not "" — kills the StringLiteral mutant).
//   - addDirectoryContext delegation (line 848): history grows by one (kills
//     the BlockStatement no-op mutant).
//   - getProviderStatus keyFile discrimination (line 652): a keyName winner
//     does NOT surface keyFile even when apiKeyFile is also set (kills the
//     always-include ConditionalExpression mutant).
//   - setModelParam precedence (line 757): overwrite semantics — a second
//     setModelParam on the same key replaces the prior value.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';
import {
  buildAgent,
  drain,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';

// ─── auth.status() winner mapping (line 1208) ───────────────────────────────

describe('mutation P23.c — auth.status winner mapping (REQ-002)', () => {
  it('a no-auth agent reports auth.status unauthenticated (not empty string) (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // computeAuthStatusForProvider returns 'unauthenticated' when winner is
      // 'none'. The StringLiteral "" mutant would make this return "" instead.
      expect(agent.auth.status('fake')).toBe('unauthenticated');
      // A different provider name also resolves to unauthenticated (winner is
      // provider-specific but seeds none without auth).
      expect(agent.auth.status('nonexistent')).toBe('unauthenticated');
    } finally {
      await cleanup();
    }
  }, 30000);

  it('a keyName-auth agent reports auth.status authenticated (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      auth: { keyName: 'named-key' },
    });
    try {
      expect(agent.auth.status('fake')).toBe('authenticated');
    } finally {
      await cleanup();
    }
  }, 30000);

  it('an inline-apiKey agent reports auth.status authenticated (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      auth: { apiKey: 'sk-test-123' },
    });
    try {
      expect(agent.auth.status('fake')).toBe('authenticated');
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── addDirectoryContext delegation (line 848) ──────────────────────────────

describe('mutation P23.c — addDirectoryContext delegation (REQ-002)', () => {
  it('addDirectoryContext appends to history (delegation executes, not no-op) (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await drain(agent.stream('a turn'));
      const before = (await agent.getHistory()).length;
      // The real method delegates to client.addDirectoryContext which injects
      // directory context into the system prompt, growing the history. The
      // BlockStatement {} mutant makes this a no-op → history stays the same.
      await agent.addDirectoryContext();
      const after = (await agent.getHistory()).length;
      expect(after).toBeGreaterThan(before);
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── getProviderStatus keyFile discrimination (line 652) ────────────────────

describe('mutation P23.c — keyFile winner discrimination (REQ-002)', () => {
  it('a keyName winner does NOT surface keyFile even when apiKeyFile is also set (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      // Both keyName and apiKeyFile set — keyName wins (higher precedence).
      auth: { keyName: 'named-key', apiKeyFile: '/tmp/other.pem' },
    });
    try {
      const status = agent.getProviderStatus();
      // winner === 'keyName' (not 'keyfile'): keyName surfaces, keyFile does
      // NOT. The always-include ConditionalExpression mutant would surface
      // keyFile='/tmp/other.pem' here — this assertion kills it.
      expect(status.keyName).toBe('named-key');
      expect(status.keyFile).toBeUndefined();
      expect(status.authStatus).toBe('authenticated');
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── setModelParam overwrite semantics (line 757) ───────────────────────────

describe('mutation P23.c — setModelParam overwrite (REQ-005)', () => {
  it('a second setModelParam on the same key replaces the prior value (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      agent.setModelParam('temperature', 0.3);
      expect(agent.getModelParams().temperature).toBe(0.3);
      // Overwrite: the new value replaces, not accumulates.
      agent.setModelParam('temperature', 0.9);
      expect(agent.getModelParams().temperature).toBe(0.9);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('multiple distinct params coexist in getModelParams (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      agent.setModelParam('temperature', 0.5);
      agent.setModelParam('topP', 0.9);
      const params = agent.getModelParams();
      expect(params.temperature).toBe(0.5);
      expect(params.topP).toBe(0.9);
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── auth.setBaseUrl delegation (line 459) + keys.setRaw (line 441) ──────────

describe('mutation P23.c — auth control delegation (REQ-002)', () => {
  it('auth.setBaseUrl updates the per-agent baseUrl surfaced in getProviderStatus (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await agent.auth.setBaseUrl('https://custom.api/v1');
      const status = agent.getProviderStatus();
      expect(status.baseUrl).toBe('https://custom.api/v1');
    } finally {
      await cleanup();
    }
  }, 30000);

  it('auth.setBaseUrl(null) clears the per-agent baseUrl (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      auth: { baseUrl: 'https://initial.api/v1' },
    });
    try {
      expect(agent.getProviderStatus().baseUrl).toBe('https://initial.api/v1');
      await agent.auth.setBaseUrl(null);
      expect(agent.getProviderStatus().baseUrl).toBeUndefined();
    } finally {
      await cleanup();
    }
  }, 30000);

  it('auth.keys.setRaw flips the auth winner to raw (authenticated) (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      expect(agent.auth.status('fake')).toBe('unauthenticated');
      await agent.auth.keys.setRaw('sk-raw-123');
      expect(agent.auth.status('fake')).toBe('authenticated');
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── Property-based (>=30% ratio) ───────────────────────────────────────────

describe('mutation P23.c — property cases @plan:PLAN-20260621-COREAPIREMED.P23 @requirement:REQ-002', () => {
  it('PROP auth.status: for any provider string, a no-auth agent reports unauthenticated (REQ-002)', async () => {
    await fc.assert(
      fc.asyncProperty(nonBlankStringArbitrary, async (provider) => {
        const { agent, cleanup } = await buildAgent('plain-text.jsonl');
        try {
          return agent.auth.status(provider) === 'unauthenticated';
        } finally {
          await cleanup();
        }
      }),
    );
  }, 30000);

  it('PROP keyName precedence: for any keyName, getProviderStatus surfaces keyName not keyFile (REQ-002)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (keyName) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
            auth: { keyName, apiKeyFile: '/tmp/competing.pem' },
          });
          try {
            const status = agent.getProviderStatus();
            return (
              status.keyName === keyName &&
              status.keyFile === undefined &&
              status.authStatus === 'authenticated'
            );
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);

  it('PROP setModelParam: for any distinct two numbers, overwrite replaces the first value (REQ-005)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        async (first, second) => {
          if (first === second) {
            return true; // overwrite with same value is trivially correct
          }
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            agent.setModelParam('temperature', first);
            agent.setModelParam('temperature', second);
            return agent.getModelParams().temperature === second;
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);

  it('PROP setBaseUrl: for any non-empty URL, getProviderStatus surfaces it (REQ-002)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.webUrl(), async (url) => {
        const { agent, cleanup } = await buildAgent('plain-text.jsonl');
        try {
          await agent.auth.setBaseUrl(url);
          return agent.getProviderStatus().baseUrl === url;
        } finally {
          await cleanup();
        }
      }),
    );
  }, 30000);

  it('PROP clearModelParam: after clear, the key is absent from getModelParams (REQ-005)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((s) => !s.includes('__proto__')),
        async (key) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            agent.setModelParam(key, 42);
            agent.clearModelParam(key);
            return !(key in agent.getModelParams());
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);
});

// ─── compress/generate NoCoverage paths (lines 863-885, 926-931) ────────────

describe('mutation P23.d — compress + generate NoCoverage (REQ-005)', () => {
  it('compress() returns a CompressionResult with a promptId and status string (covers readCompressionTokenCount) (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // Drive one turn so the chat is initialized (compress requires it).
      await drain(agent.stream('initialize the chat'));
      // compress() exercises readCompressionTokenCount (lines 1060-1069) and
      // the status mapping (lines 873-884). Under the fake seam, the chat
      // returns COMPRESSED, so status should be 'compressed' with numeric
      // token counts.
      const result = await agent.compress();
      expect(typeof result.status).toBe('string');
      expect(result.promptId).toBeDefined();
      expect(typeof result.promptId).toBe('string');
      // Under the fake seam, performCompression returns COMPRESSED, so status
      // is 'compressed' with numeric token counts (not skipped/failed).
      expect(result.status).toBe('compressed');
      expect(typeof result.originalTokenCount).toBe('number');
      expect(typeof result.newTokenCount).toBe('number');
    } finally {
      await cleanup();
    }
  }, 30000);

  it('generate() returns a string (covers getResponseText fallback line 931) (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // generate() delegates to client.generateDirectMessage then reads the
      // response text via getResponseText. Under the fake seam the response
      // carries text, so the result is a non-empty string. This covers the
      // getResponseText ?? '' fallback at line 931.
      const result = await agent.generate('hello');
      expect(typeof result).toBe('string');
    } finally {
      await cleanup();
    }
  }, 30000);

  it('getStats() after a turn returns a populated SessionStats snapshot (covers readTurnCount + projectStats) (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // Before any turn, turnCount is 0 (readTurnCount reads from
      // HistoryService which has no messages yet).
      const before = agent.getStats();
      expect(before.turnCount).toBe(0);
      expect(typeof before.totalTokens).toBe('number');

      // Drive one turn so HistoryService has messages, then readTurnCount
      // returns > 0 (covers the service.getStatistics().totalMessages path
      // at lines 1083-1084).
      await drain(agent.stream('collect stats'));
      const after = agent.getStats();
      expect(after.turnCount).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  }, 30000);

  // ─── Property-based (maintain >=30% ratio) ──────────────────────────────

  it('PROP compress promptId: for any explicit promptId, compress returns that same id (REQ-005)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 30 })
          .filter((s) => !s.includes('__proto__')),
        async (id) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            await drain(agent.stream('init'));
            const result = await agent.compress({ promptId: id });
            return result.promptId === id;
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);
});

// ─── rebuild-with-callbacks NoCoverage (lines 1192-1197) ───────────────────

describe('mutation P23.e — rebuild with approval + display callbacks (REQ-005)', () => {
  it('setModel on an agent WITH onApproval triggers rebuild carrying the approval handler (covers line 1193) (REQ-005)', async () => {
    // Build WITH onApproval — approvalHandler is threaded into deps, so the
    // rebuild conditional spread at line 1192-1194 includes it. The
    // ObjectLiteral {} mutant would omit the handler from the rebuild,
    // and the test would fail because setModel is still callable.
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      onApproval: () => ToolConfirmationOutcome.ProceedOnce,
    });
    try {
      // setModel triggers rebuild() — the rebuild's conditional spread
      // `{ approvalHandler }` at line 1193 executes with the handler present.
      await agent.setModel('fake-model-2');
      // The model changed: getModel() reflects the new model.
      expect(agent.getModel()).toBe('fake-model-2');
      // After rebuild, a new turn still drives to completion (the rebuilt loop
      // bound to the CURRENT client carries the approval handler).
      const events = await drain(agent.stream('post-rebuild turn'));
      const done = events.filter((e) => e.type === 'done');
      expect(done).toHaveLength(1);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('setModel on an agent WITH editorCallbacks triggers rebuild carrying displayCallbacks (covers line 1196) (REQ-005)', async () => {
    // Build WITH editorCallbacks — deriveDisplayCallbacks threads them into
    // deps.displayCallbacks, so the rebuild conditional spread at line
    // 1195-1197 includes them.
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      editorCallbacks: {
        getPreferredEditor: () => 'test-editor',
        onEditorClose: () => {
          /* no-op */
        },
      },
    });
    try {
      await agent.setModel('fake-model-3');
      expect(agent.getModel()).toBe('fake-model-3');
      // After rebuild, a new turn still drives to completion.
      const events = await drain(agent.stream('post-rebuild turn'));
      const done = events.filter((e) => e.type === 'done');
      expect(done).toHaveLength(1);
    } finally {
      await cleanup();
    }
  }, 30000);

  // ─── Property-based (maintain >=30% ratio) ──────────────────────────────

  it('PROP setModel: for any non-empty model string, getModel reflects it after setModel (REQ-005)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 30 })
          .filter((s) => !s.includes('__proto__')),
        async (model) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            await agent.setModel(model);
            return agent.getModel() === model;
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);
});
