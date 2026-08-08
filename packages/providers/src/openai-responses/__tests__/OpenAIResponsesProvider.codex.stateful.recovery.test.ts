/**
 * @license
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Parent-rejection recovery and endpoint scoping.
 *
 * Behavioral tests for issue #3134 Codex statefulness. The transport derives
 * its metadata from a REAL SSE byte stream through parseResponsesStream, and
 * turn-2 history is fed verbatim from turn-1's ACTUAL yielded IContents.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  SocketHarness,
  completingScript,
  drain as drainHarness,
  userTextsOf,
} from '../openAIResponsesWebSocketTransport.test-helpers.js';
import { createCodexResponsesWebSocketTransport } from '../openAIResponsesWebSocketTransport.js';
import { executeOpenAIResponsesRequest } from '../openAIResponsesExecutor.js';
import {
  CODEX_BASE_URL,
  TEST_RUNTIME_ID,
  buildDeps,
  buildOptions,
  drain,
  errorResponse,
  sseResponse,
} from '../codexStateful.test-helpers.js';

describe('OpenAIResponsesProvider Codex stateful — parent rejection recovery and endpoint scoping @issue:3134', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: TEST_RUNTIME_ID,
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  describe('Fix 1 — one-shot recovery when previous_response_id is rejected', () => {
    it('retries once with full history when the API rejects a stored parent', async () => {
      let fetchCalls = 0;
      let firstBody: string | undefined;
      let secondBody: string | undefined;
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: unknown }).fetch = async (
        _input: unknown,
        init?: RequestInit,
      ) => {
        fetchCalls += 1;
        const blob = init?.body;
        const bodyText =
          blob instanceof Blob ? await blob.text() : String(blob ?? '');
        if (fetchCalls === 1) firstBody = bodyText;
        else secondBody = bodyText;
        if (fetchCalls === 1) {
          return errorResponse(
            400,
            "Previous response with id 'resp_dead' not found",
          );
        }
        return sseResponse('resp_recovered', 'recovered text', true);
      };
      try {
        const contents: IContent[] = [
          { speaker: 'human', blocks: [{ type: 'text', text: 'first q' }] },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'first a' }],
            metadata: {
              id: 'resp_dead',
              responsesStored: true,
              providerBaseURL: CODEX_BASE_URL,
            },
          },
          { speaker: 'human', blocks: [{ type: 'text', text: 'second q' }] },
        ];

        let statefulFailed = false;
        const deps = buildDeps({
          isResponsesStatefulFailed: () => statefulFailed,
          markResponsesStatefulFailed: () => {
            statefulFailed = true;
          },
        });
        const messages = await drain(
          executeOpenAIResponsesRequest(buildOptions(contents), deps),
        );

        expect(fetchCalls).toBe(2);
        expect(statefulFailed).toBe(true);

        const firstReq = JSON.parse(firstBody!) as Record<string, unknown>;
        expect(firstReq['previous_response_id']).toBe('resp_dead');
        const firstUsers = userTextsOf(firstReq['input']);
        expect(firstUsers).not.toContain('first q');

        const secondReq = JSON.parse(secondBody!) as Record<string, unknown>;
        expect(secondReq['previous_response_id']).toBeUndefined();
        const secondUsers = userTextsOf(secondReq['input']);
        expect(secondUsers).toContain('first q');
        expect(secondUsers).toContain('second q');

        const text = messages
          .flatMap((m) => m.blocks)
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('');
        expect(text).toContain('recovered text');
      } finally {
        (globalThis as { fetch: unknown }).fetch = originalFetch;
      }
    });

    it('after recovery, subsequent turns suppress statefulness (session-scoped flag)', async () => {
      let fetchCalls = 0;
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: unknown }).fetch = async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return errorResponse(
            400,
            "previous_response_id 'resp_dead' does not exist",
          );
        }
        return sseResponse('resp_new', 'ok', true);
      };
      try {
        let statefulFailed = false;
        const deps = buildDeps({
          isResponsesStatefulFailed: () => statefulFailed,
          markResponsesStatefulFailed: () => {
            statefulFailed = true;
          },
        });

        const historyWithDeadParent: IContent[] = [
          { speaker: 'human', blocks: [{ type: 'text', text: 'q1' }] },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'a1' }],
            metadata: {
              id: 'resp_dead',
              responsesStored: true,
              providerBaseURL: CODEX_BASE_URL,
            },
          },
          { speaker: 'human', blocks: [{ type: 'text', text: 'q2' }] },
        ];
        await drain(
          executeOpenAIResponsesRequest(
            buildOptions(historyWithDeadParent),
            deps,
          ),
        );

        // Turn 2: even though history now has resp_new with responsesStored,
        // the session flag suppresses statefulness.
        fetchCalls = 0;
        let turn2Body: string | undefined;
        (globalThis as { fetch: unknown }).fetch = async (
          _input: unknown,
          init?: RequestInit,
        ) => {
          const blob = init?.body;
          turn2Body =
            blob instanceof Blob ? await blob.text() : String(blob ?? '');
          return sseResponse('resp_new2', 'ok2', true);
        };

        const historyAfterRecovery: IContent[] = [
          ...historyWithDeadParent,
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'a2' }],
            metadata: {
              id: 'resp_new',
              responsesStored: true,
              providerBaseURL: CODEX_BASE_URL,
            },
          },
          { speaker: 'human', blocks: [{ type: 'text', text: 'q3' }] },
        ];
        await drain(
          executeOpenAIResponsesRequest(
            buildOptions(historyAfterRecovery),
            deps,
          ),
        );

        const req = JSON.parse(turn2Body!) as Record<string, unknown>;
        expect(req['previous_response_id']).toBeUndefined();
        const users = userTextsOf(req['input']);
        expect(users).toContain('q1');
        expect(users).toContain('q3');
      } finally {
        (globalThis as { fetch: unknown }).fetch = originalFetch;
      }
    });
  });

  describe('Fix 2 — parent lookup must match endpoint', () => {
    it('does not select a parent from a different providerBaseURL', async () => {
      const harness = new SocketHarness([completingScript('ok')]);
      const transport = createCodexResponsesWebSocketTransport({
        openSocket: harness.openSocket,
      });
      try {
        const contents: IContent[] = [
          { speaker: 'human', blocks: [{ type: 'text', text: 'q1' }] },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'a1' }],
            metadata: {
              id: 'resp_other',
              responsesStored: true,
              providerBaseURL: 'https://api.openai.com/v1',
            },
          },
          { speaker: 'human', blocks: [{ type: 'text', text: 'q2' }] },
        ];
        await drainHarness(
          executeOpenAIResponsesRequest(
            buildOptions(contents),
            buildDeps({ getWebSocketTransport: () => transport }),
          ),
        );

        const sent = JSON.parse(harness.sockets[0].sent[0]) as Record<
          string,
          unknown
        >;
        expect(sent['previous_response_id']).toBeUndefined();
        const users = userTextsOf(sent['input']);
        expect(users).toContain('q1');
        expect(users).toContain('q2');
      } finally {
        transport.close();
      }
    });

    it('selects a parent when providerBaseURL matches the resolved endpoint', async () => {
      const harness = new SocketHarness([completingScript('ok')]);
      const transport = createCodexResponsesWebSocketTransport({
        openSocket: harness.openSocket,
      });
      try {
        const contents: IContent[] = [
          { speaker: 'human', blocks: [{ type: 'text', text: 'q1' }] },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'a1' }],
            metadata: {
              id: 'resp_match',
              responsesStored: true,
              providerBaseURL: CODEX_BASE_URL,
            },
          },
          { speaker: 'human', blocks: [{ type: 'text', text: 'q2' }] },
        ];
        await drainHarness(
          executeOpenAIResponsesRequest(
            buildOptions(contents),
            buildDeps({ getWebSocketTransport: () => transport }),
          ),
        );

        const sent = JSON.parse(harness.sockets[0].sent[0]) as Record<
          string,
          unknown
        >;
        expect(sent['previous_response_id']).toBe('resp_match');
        const users = userTextsOf(sent['input']);
        expect(users).not.toContain('q1');
        expect(users).toContain('q2');
      } finally {
        transport.close();
      }
    });

    /**
     * `stampAiTurnModel` takes an OPTIONAL baseURL and skips the stamp when it
     * is unavailable, so an absent `providerBaseURL` is not evidence of a
     * mismatch. Treating absent as a mismatch would silently disable
     * statefulness on any history predating the stamp — the exact inert
     * failure mode this feature must avoid.
     */
    it('still selects a parent when providerBaseURL was never stamped', async () => {
      const harness = new SocketHarness([completingScript('ok')]);
      const transport = createCodexResponsesWebSocketTransport({
        openSocket: harness.openSocket,
      });
      try {
        const contents: IContent[] = [
          { speaker: 'human', blocks: [{ type: 'text', text: 'q1' }] },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'a1' }],
            metadata: { id: 'resp_unstamped', responsesStored: true },
          },
          { speaker: 'human', blocks: [{ type: 'text', text: 'q2' }] },
        ];
        await drainHarness(
          executeOpenAIResponsesRequest(
            buildOptions(contents),
            buildDeps({ getWebSocketTransport: () => transport }),
          ),
        );

        const sent = JSON.parse(harness.sockets[0].sent[0]) as Record<
          string,
          unknown
        >;
        expect(sent['previous_response_id']).toBe('resp_unstamped');
        const users = userTextsOf(sent['input']);
        expect(users).not.toContain('q1');
        expect(users).toContain('q2');
      } finally {
        transport.close();
      }
    });

    it('ignores a trailing-slash difference in the recorded endpoint', async () => {
      const harness = new SocketHarness([completingScript('ok')]);
      const transport = createCodexResponsesWebSocketTransport({
        openSocket: harness.openSocket,
      });
      try {
        const contents: IContent[] = [
          { speaker: 'human', blocks: [{ type: 'text', text: 'q1' }] },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'a1' }],
            metadata: {
              id: 'resp_slash',
              responsesStored: true,
              providerBaseURL: `${CODEX_BASE_URL}/`,
            },
          },
          { speaker: 'human', blocks: [{ type: 'text', text: 'q2' }] },
        ];
        await drainHarness(
          executeOpenAIResponsesRequest(
            buildOptions(contents),
            buildDeps({ getWebSocketTransport: () => transport }),
          ),
        );

        const sent = JSON.parse(harness.sockets[0].sent[0]) as Record<
          string,
          unknown
        >;
        expect(sent['previous_response_id']).toBe('resp_slash');
      } finally {
        transport.close();
      }
    });
  });
});
