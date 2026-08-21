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
 * Resumed-session chain behavior for issue #3160 Codex statefulness.
 *
 * Replay strips `responsesStored` from AI turns (see ReplayEngine @ #3160),
 * so the first turn of a resumed session must start a fresh chain: no
 * previous_response_id, full history, `responsesStored: true` on its own
 * completion. The live in-process control proves the parent scan itself is
 * unchanged.
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
  metadataOf,
} from '../codexStateful.test-helpers.js';

describe('OpenAIResponsesProvider Codex resumed chain @issue:3160', () => {
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

  function codexTransportContents(hasMarker: boolean): IContent[] {
    return [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q1' }] },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'a1' }],
        metadata: {
          id: 'resp_dead',
          ...(hasMarker ? { responsesStored: true } : {}),
          providerBaseURL: CODEX_BASE_URL,
        },
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'q2' }] },
    ];
  }

  it('a resumed history (marker stripped by replay) sends no previous_response_id and the full history', async () => {
    const contents = codexTransportContents(false);
    const harness = new SocketHarness([completingScript('ok')]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    try {
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

  it('a live in-process chain still sends the parent', async () => {
    const contents = codexTransportContents(true);
    const harness = new SocketHarness([completingScript('ok')]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    try {
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
      expect(sent['previous_response_id']).toBe('resp_dead');
      const users = userTextsOf(sent['input']);
      expect(users).not.toContain('q1');
    } finally {
      transport.close();
    }
  });

  it('the first resumed turn is itself chainable', async () => {
    const resumedContents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'resumed question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'old answer' }],
        metadata: {
          id: 'resp_dead',
          providerBaseURL: CODEX_BASE_URL,
        },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'resumed follow-up' }],
      },
    ];
    const harness1 = new SocketHarness([completingScript('resumed answer')]);
    const transport1 = createCodexResponsesWebSocketTransport({
      openSocket: harness1.openSocket,
    });
    try {
      const resumedMessages = await drainHarness(
        executeOpenAIResponsesRequest(
          buildOptions(resumedContents),
          buildDeps({ getWebSocketTransport: () => transport1 }),
        ),
      );

      const resumedMeta = metadataOf(resumedMessages);
      expect(resumedMeta).toBeDefined();
      expect(resumedMeta!.responsesStored).toBe(true);

      const resumedSent = JSON.parse(harness1.sockets[0].sent[0]) as Record<
        string,
        unknown
      >;
      expect(resumedSent['previous_response_id']).toBeUndefined();
      const resumedUsers = userTextsOf(resumedSent['input']);
      expect(resumedUsers).toContain('resumed question');

      const resumedAnswer = resumedMessages
        .flatMap((m) => m.blocks)
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('');
      const turn2Contents: IContent[] = [
        ...resumedContents,
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: resumedAnswer }],
          metadata: { ...resumedMeta!, providerBaseURL: CODEX_BASE_URL },
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'turn 2 question' }],
        },
      ];

      const harness2 = new SocketHarness([completingScript('turn 2 answer')]);
      const transport2 = createCodexResponsesWebSocketTransport({
        openSocket: harness2.openSocket,
      });
      try {
        await drainHarness(
          executeOpenAIResponsesRequest(
            buildOptions(turn2Contents),
            buildDeps({ getWebSocketTransport: () => transport2 }),
          ),
        );

        const sent = JSON.parse(harness2.sockets[0].sent[0]) as Record<
          string,
          unknown
        >;
        expect(sent['previous_response_id']).toBe(resumedMeta!.id);
        const users = userTextsOf(sent['input']);
        expect(users).not.toContain('resumed question');
        expect(users).toContain('turn 2 question');
      } finally {
        transport2.close();
      }
    } finally {
      transport1.close();
    }
  });
});
