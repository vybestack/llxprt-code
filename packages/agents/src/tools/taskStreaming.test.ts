/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for {@link setupTaskStreaming} (issue #3288): XML
 * attribute escaping on the subagent wrapper tags, and restoration of a
 * pre-existing `scope.onMessage` when the closing tag is emitted.
 *
 * These tests drive the real `setupTaskStreaming` with the real
 * `startTaskHeartbeat` (an injected parameter of the signature) and collect
 * genuine `LiveOutputUpdate` values, so reverting the production change fails
 * them.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import {
  setupTaskStreaming,
  type TaskStreamingHandle,
} from './taskStreaming.js';
import { startTaskHeartbeat } from './taskHeartbeat.js';
import type { SubAgentScope } from '../core/subagent.js';
import type { LiveOutputUpdate } from '@vybestack/llxprt-code-tools';

/** The part of {@link SubAgentScope} that task streaming manipulates. */
interface TestSubAgentScope {
  onMessage?: (message: string) => void;
}

/** Narrow bridge from the minimal test scope to the full scope type. */
function asSubAgentScope(scope: TestSubAgentScope): SubAgentScope {
  return scope as unknown as SubAgentScope;
}

/** A message handler that records what it received, for chaining assertions. */
interface RecordingHandler {
  handler: (message: string) => void;
  received: string[];
}

function createRecordingHandler(): RecordingHandler {
  const received: string[] = [];
  return {
    handler: (message: string): void => {
      received.push(message);
    },
    received,
  };
}

/**
 * Every real heartbeat started by a test, stopped in afterEach so the 10s
 * liveness timers do not outlive the test that armed them.
 */
const openStreams: TaskStreamingHandle[] = [];

describe('taskStreaming', () => {
  afterEach(() => {
    while (openStreams.length > 0) {
      openStreams.pop()?.heartbeat.stop();
    }
  });

  interface StreamingHarness {
    scope: TestSubAgentScope;
    updates: LiveOutputUpdate[];
    handle: TaskStreamingHandle;
  }

  /**
   * Calls the real `setupTaskStreaming` with the real `startTaskHeartbeat` and a
   * plain collector as `updateOutput`. Returns the scope (whose `onMessage` the
   * tests read), the collected updates, and the streaming handle.
   */
  function createStreamingHarness(
    subagentName: string,
    agentId: string,
    options: {
      existingHandler?: (message: string) => void;
      updateOutput?: (update: LiveOutputUpdate) => void;
    } = {},
  ): StreamingHarness {
    const scope: TestSubAgentScope = { onMessage: options.existingHandler };
    const updates: LiveOutputUpdate[] = [];
    const collect = (update: LiveOutputUpdate): void => {
      updates.push(update);
      options.updateOutput?.(update);
    };
    const handle = setupTaskStreaming(
      subagentName,
      agentId,
      asSubAgentScope(scope),
      collect,
      startTaskHeartbeat,
    );
    openStreams.push(handle);
    return { scope, updates, handle };
  }

  /** Extracts append payloads, skipping typed status (heartbeat) updates. */
  function appendData(updates: LiveOutputUpdate[]): string[] {
    return updates
      .filter((update) => update.mode === 'append')
      .map((update) => update.data);
  }

  describe('setupTaskStreaming attribute escaping', () => {
    it('escapes double quotes in the subagent name in the opening and closing tags', () => {
      const { updates, handle } = createStreamingHarness(
        'say "hi"',
        'agent-42',
      );

      handle.emitClosingSubagentTag();

      expect(appendData(updates)).toStrictEqual([
        '<subagent name="say &quot;hi&quot;" id="agent-42">\n',
        '</subagent name="say &quot;hi&quot;" id="agent-42">\n',
      ]);
    });

    it('escapes ampersands and angle brackets in the subagent name', () => {
      const { updates, handle } = createStreamingHarness('a & <b>', 'agent-42');

      handle.emitClosingSubagentTag();

      expect(appendData(updates)).toStrictEqual([
        '<subagent name="a &amp; &lt;b&gt;" id="agent-42">\n',
        '</subagent name="a &amp; &lt;b&gt;" id="agent-42">\n',
      ]);
    });

    it('escapes apostrophes in the subagent name', () => {
      const { updates, handle } = createStreamingHarness("it's", 'agent-42');

      handle.emitClosingSubagentTag();

      expect(appendData(updates)).toStrictEqual([
        '<subagent name="it&apos;s" id="agent-42">\n',
        '</subagent name="it&apos;s" id="agent-42">\n',
      ]);
    });

    it('escapes an ampersand once rather than double-escaping the entities it produces', () => {
      const { updates, handle } = createStreamingHarness(
        '&lt;raw&gt;',
        'agent-42',
      );

      handle.emitClosingSubagentTag();

      expect(appendData(updates)[0]).toBe(
        '<subagent name="&amp;lt;raw&amp;gt;" id="agent-42">\n',
      );
    });

    it('escapes an agent id containing special characters', () => {
      const { updates, handle } = createStreamingHarness('helper', 'a&b"c<d>');

      handle.emitClosingSubagentTag();

      expect(appendData(updates)).toStrictEqual([
        '<subagent name="helper" id="a&amp;b&quot;c&lt;d&gt;">\n',
        '</subagent name="helper" id="a&amp;b&quot;c&lt;d&gt;">\n',
      ]);
    });

    it('leaves a name with no special characters byte-identical', () => {
      const { updates, handle } = createStreamingHarness('helper', 'agent-42');

      handle.emitClosingSubagentTag();

      expect(appendData(updates)).toStrictEqual([
        '<subagent name="helper" id="agent-42">\n',
        '</subagent name="helper" id="agent-42">\n',
      ]);
    });
  });

  describe('setupTaskStreaming scope.onMessage lifecycle', () => {
    it('restores a pre-existing handler when the closing tag is emitted', () => {
      const existing = createRecordingHandler();
      const { scope, handle } = createStreamingHarness('helper', 'agent-42', {
        existingHandler: existing.handler,
      });
      expect(scope.onMessage).not.toBe(existing.handler);

      handle.emitClosingSubagentTag();

      expect(scope.onMessage).toBe(existing.handler);
    });

    it('restores undefined when the scope had no handler before streaming', () => {
      const { scope, handle } = createStreamingHarness('helper', 'agent-42');
      expect(scope.onMessage).toBeDefined();

      handle.emitClosingSubagentTag();

      expect(scope.onMessage).toBeUndefined();
    });

    it('emits the delta and chains to the pre-existing handler while streaming is open', () => {
      const existing = createRecordingHandler();
      const { scope, updates, handle } = createStreamingHarness(
        'helper',
        'agent-42',
        { existingHandler: existing.handler },
      );

      scope.onMessage?.('first progress');
      handle.emitClosingSubagentTag();

      expect(existing.received).toStrictEqual(['first progress']);
      expect(appendData(updates)).toStrictEqual([
        '<subagent name="helper" id="agent-42">\n',
        'first progress',
        '</subagent name="helper" id="agent-42">\n',
      ]);
    });

    it('emits nothing after the closing tag when a stale relay reference is invoked', () => {
      const existing = createRecordingHandler();
      const { scope, updates, handle } = createStreamingHarness(
        'helper',
        'agent-42',
        { existingHandler: existing.handler },
      );
      const staleRelay = scope.onMessage;

      handle.emitClosingSubagentTag();
      staleRelay?.('late progress');

      expect(existing.received).toStrictEqual(['late progress']);
      expect(appendData(updates)).toStrictEqual([
        '<subagent name="helper" id="agent-42">\n',
        '</subagent name="helper" id="agent-42">\n',
      ]);
    });

    it('restores the handler even when updateOutput throws while emitting the closing tag', () => {
      const existing = createRecordingHandler();
      const { scope, handle } = createStreamingHarness('helper', 'agent-42', {
        existingHandler: existing.handler,
        updateOutput: (update) => {
          if (
            update.mode === 'append' &&
            update.data.startsWith('</subagent')
          ) {
            throw new Error('downstream serialization failure');
          }
        },
      });

      expect(() => handle.emitClosingSubagentTag()).toThrow(
        'downstream serialization failure',
      );

      expect(scope.onMessage).toBe(existing.handler);
    });

    it('leaves a handler installed while streaming was active in place at close', () => {
      const existing = createRecordingHandler();
      const later = createRecordingHandler();
      const { scope, handle } = createStreamingHarness('helper', 'agent-42', {
        existingHandler: existing.handler,
      });

      scope.onMessage = later.handler;
      handle.emitClosingSubagentTag();

      expect(scope.onMessage).toBe(later.handler);
    });

    it('does not clobber a handler installed after close when the closing tag is emitted twice', () => {
      const existing = createRecordingHandler();
      const later = createRecordingHandler();
      const { scope, updates, handle } = createStreamingHarness(
        'helper',
        'agent-42',
        { existingHandler: existing.handler },
      );

      handle.emitClosingSubagentTag();
      expect(scope.onMessage).toBe(existing.handler);
      scope.onMessage = later.handler;
      handle.emitClosingSubagentTag();

      expect(scope.onMessage).toBe(later.handler);
      expect(appendData(updates)).toStrictEqual([
        '<subagent name="helper" id="agent-42">\n',
        '</subagent name="helper" id="agent-42">\n',
      ]);
    });
  });
});
