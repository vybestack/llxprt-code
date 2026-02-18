/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P07
 * @requirement DELTA-HEVT-001, DELTA-HEVT-002, DELTA-HEVT-003, DELTA-HBUS-002, DELTA-HBUS-003, DELTA-HPAY-003
 *
 * Tests for MessageBus integration with HookEventHandler.
 * These tests verify subscription, routing, correlated responses, and model translation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { EventEmitter } from 'events';
import { HookEventHandler } from '../hookEventHandler.js';
import { HookEventName } from '../types.js';
import type {
  HookExecutionRequest,
  HookExecutionResponse,
} from '../hookBusContracts.js';
import type { Config } from '../../config/config.js';
import type { HookRegistry } from '../hookRegistry.js';
import type { HookPlanner } from '../hookPlanner.js';
import type { HookRunner } from '../hookRunner.js';
import type { HookAggregator } from '../hookAggregator.js';
import { DebugLogger } from '../../debug/index.js';

// ---------------------------------------------------------------------------
// Test Utilities
// ---------------------------------------------------------------------------

const HOOK_EXECUTION_REQUEST = 'HOOK_EXECUTION_REQUEST';
const HOOK_EXECUTION_RESPONSE = 'HOOK_EXECUTION_RESPONSE';

/**
 * Minimal fake MessageBus for testing
 */
class FakeMessageBus {
  private emitter = new EventEmitter();
  private publishedMessages: Array<{ type: string; payload: unknown }> = [];

  publish(message: { type: string; payload?: unknown }): void {
    // Store the message as-is (type + payload)
    this.publishedMessages.push({
      type: message.type,
      payload: message.payload,
    });
    // Emit the full message to subscribers (handler receives entire message object)
    this.emitter.emit(message.type, message);
  }

  subscribe<T>(type: string, handler: (msg: T) => void): () => void {
    this.emitter.on(type, handler);
    return () => this.emitter.off(type, handler);
  }

  getPublishedResponses(): HookExecutionResponse[] {
    return this.publishedMessages
      .filter((m) => m.type === HOOK_EXECUTION_RESPONSE)
      .map((m) => m.payload as HookExecutionResponse);
  }

  clear(): void {
    this.publishedMessages = [];
    this.emitter.removeAllListeners();
  }
}

function makeConfig(): Config {
  return {
    storage: { getGeminiDir: vi.fn().mockReturnValue('/project/.gemini') },
    getExtensions: vi.fn().mockReturnValue([]),
    getHooks: vi.fn().mockReturnValue({}),
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    getTargetDir: vi.fn().mockReturnValue('/test/project'),
    getEnableHooks: vi.fn().mockReturnValue(true),
  } as unknown as Config;
}

function makeRegistry(): HookRegistry {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    getHooksForEvent: vi.fn().mockReturnValue([]),
    getAllHooks: vi.fn().mockReturnValue([]),
    setHookEnabled: vi.fn(),
  } as unknown as HookRegistry;
}

function makePlanner(): HookPlanner {
  return {
    createExecutionPlan: vi.fn().mockReturnValue(null), // null = no hooks match
  } as unknown as HookPlanner;
}

function makeRunner(): HookRunner {
  return {
    execute: vi.fn().mockResolvedValue([]),
  } as unknown as HookRunner;
}

function makeAggregator(): HookAggregator {
  return {
    aggregate: vi.fn().mockReturnValue({
      success: true,
      hookResults: [],
      allOutputs: [],
      errors: [],
      totalDuration: 0,
    }),
  } as unknown as HookAggregator;
}

async function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test Group 1: Subscription and routing (DELTA-HEVT-001)
// ---------------------------------------------------------------------------

describe('MessageBus subscription (DELTA-HEVT-001)', () => {
  let handler: HookEventHandler;
  let bus: FakeMessageBus;
  let config: Config;

  beforeEach(() => {
    bus = new FakeMessageBus();
    config = makeConfig();
  });

  afterEach(() => {
    handler?.dispose();
    bus.clear();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HEVT-001
   * @given HookEventHandler constructed with a MessageBus
   * @when HOOK_EXECUTION_REQUEST is published to the bus
   * @then handler processes the message and publishes a response
   */
  it('subscribes and processes HOOK_EXECUTION_REQUEST @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    handler = new HookEventHandler(
      config,
      makeRegistry(),
      makePlanner(),
      makeRunner(),
      makeAggregator(),
      bus as unknown as import('../../confirmation-bus/message-bus.js').MessageBus,
      DebugLogger.getLogger('test'),
    );

    const request: HookExecutionRequest = {
      eventName: HookEventName.BeforeTool,
      input: { tool_name: 'test_tool', tool_input: {} },
      correlationId: 'test-corr-001',
    };

    bus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
    await waitMs(50);

    const responses = bus.getPublishedResponses();
    expect(responses.length).toBeGreaterThan(0);
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HEVT-001
   * @given HookEventHandler constructed WITHOUT MessageBus
   * @when handler is created
   * @then no subscription-related errors occur
   */
  it('does NOT subscribe when MessageBus is absent @plan:PLAN-20250218-HOOKSYSTEM.P07', () => {
    expect(() => {
      handler = new HookEventHandler(
        config,
        makeRegistry(),
        makePlanner(),
        makeRunner(),
        makeAggregator(),
        undefined,
        DebugLogger.getLogger('test'),
      );
    }).not.toThrow();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HEVT-001, DELTA-HEVT-004
   * @given HookEventHandler is disposed
   * @when HOOK_EXECUTION_REQUEST is published after dispose
   * @then no new response is published
   */
  it('ignores messages after dispose @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    handler = new HookEventHandler(
      config,
      makeRegistry(),
      makePlanner(),
      makeRunner(),
      makeAggregator(),
      bus as unknown as import('../../confirmation-bus/message-bus.js').MessageBus,
      DebugLogger.getLogger('test'),
    );

    handler.dispose();
    bus.clear();

    const request: HookExecutionRequest = {
      eventName: HookEventName.BeforeTool,
      input: { tool_name: 'test_tool', tool_input: {} },
      correlationId: 'post-dispose-001',
    };

    bus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
    await waitMs(50);

    const responses = bus.getPublishedResponses();
    expect(responses).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test Group 2: Correlated responses (DELTA-HEVT-002)
// ---------------------------------------------------------------------------

describe('Correlated responses (DELTA-HEVT-002)', () => {
  let handler: HookEventHandler;
  let bus: FakeMessageBus;

  beforeEach(() => {
    bus = new FakeMessageBus();
    handler = new HookEventHandler(
      makeConfig(),
      makeRegistry(),
      makePlanner(),
      makeRunner(),
      makeAggregator(),
      bus as unknown as import('../../confirmation-bus/message-bus.js').MessageBus,
      DebugLogger.getLogger('test'),
    );
  });

  afterEach(() => {
    handler?.dispose();
    bus.clear();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HEVT-002
   * @given HOOK_EXECUTION_REQUEST with correlationId 'test-correlation-123'
   * @when handler processes it
   * @then response.correlationId === 'test-correlation-123'
   */
  it('response correlationId matches request correlationId @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    const request: HookExecutionRequest = {
      eventName: HookEventName.BeforeTool,
      input: { tool_name: 'tool1', tool_input: {} },
      correlationId: 'test-correlation-123',
    };

    bus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
    await waitMs(50);

    const responses = bus.getPublishedResponses();
    expect(responses).toHaveLength(1);
    expect(responses[0].correlationId).toBe('test-correlation-123');
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HEVT-002
   * @given valid HOOK_EXECUTION_REQUEST
   * @when handler processes it successfully
   * @then response.success === true
   */
  it('successful execution produces success=true @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    const request: HookExecutionRequest = {
      eventName: HookEventName.BeforeTool,
      input: { tool_name: 'tool1', tool_input: {} },
      correlationId: 'success-test-001',
    };

    bus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
    await waitMs(50);

    const responses = bus.getPublishedResponses();
    expect(responses).toHaveLength(1);
    expect(responses[0].success).toBe(true);
  });

  /**
   * METAMORPHIC INVARIANT: correlationId echoed verbatim for any non-empty string
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HEVT-002
   */
  test.prop([
    fc
      .string({ minLength: 1, maxLength: 128 })
      .filter((s) => s.trim().length > 0),
  ])(
    'METAMORPHIC: correlationId echoed verbatim in response @plan:PLAN-20250218-HOOKSYSTEM.P07',
    async (correlationId) => {
      const localBus = new FakeMessageBus();
      const localHandler = new HookEventHandler(
        makeConfig(),
        makeRegistry(),
        makePlanner(),
        makeRunner(),
        makeAggregator(),
        localBus as unknown as import('../../confirmation-bus/message-bus.js').MessageBus,
        DebugLogger.getLogger('test'),
      );

      const request: HookExecutionRequest = {
        eventName: HookEventName.BeforeTool,
        input: { tool_name: 'test_tool', tool_input: {} },
        correlationId,
      };

      localBus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
      await waitMs(50);

      const responses = localBus.getPublishedResponses();
      // eslint-disable-next-line vitest/no-standalone-expect -- test.prop wraps test block
      expect(responses.length).toBeGreaterThan(0);
      // eslint-disable-next-line vitest/no-standalone-expect -- test.prop wraps test block
      expect(responses[0].correlationId).toBe(correlationId);

      localHandler.dispose();
    },
  );
});

// ---------------------------------------------------------------------------
// Test Group 3: Unsupported event name (DELTA-HEVT-003)
// ---------------------------------------------------------------------------

describe('Unsupported event name (DELTA-HEVT-003)', () => {
  let handler: HookEventHandler;
  let bus: FakeMessageBus;

  beforeEach(() => {
    bus = new FakeMessageBus();
    handler = new HookEventHandler(
      makeConfig(),
      makeRegistry(),
      makePlanner(),
      makeRunner(),
      makeAggregator(),
      bus as unknown as import('../../confirmation-bus/message-bus.js').MessageBus,
      DebugLogger.getLogger('test'),
    );
  });

  afterEach(() => {
    handler?.dispose();
    bus.clear();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HEVT-003
   * @given HOOK_EXECUTION_REQUEST with eventName='UnknownEvent'
   * @when handler processes it
   * @then failure response published with code 'unsupported_event'
   */
  it('unknown eventName produces failed response @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    const request = {
      eventName: 'UnknownEvent' as unknown as HookEventName,
      input: {},
      correlationId: 'unknown-event-001',
    };

    bus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
    await waitMs(50);

    const responses = bus.getPublishedResponses();
    expect(responses).toHaveLength(1);
    expect(responses[0].success).toBe(false);
    expect(responses[0].error?.code).toBe('unsupported_event');
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HEVT-003
   * @given HOOK_EXECUTION_REQUEST with invalid eventName
   * @when handler processes it
   * @then response still contains the original correlationId
   */
  it('failure response preserves correlationId @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    const request = {
      eventName: 'InvalidEvent' as unknown as HookEventName,
      input: {},
      correlationId: 'preserved-corr-id-123',
    };

    bus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
    await waitMs(50);

    const responses = bus.getPublishedResponses();
    expect(responses).toHaveLength(1);
    expect(responses[0].correlationId).toBe('preserved-corr-id-123');
  });

  /**
   * METAMORPHIC INVARIANT: invalid event names always produce success=false
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HEVT-003
   */
  test.prop([
    fc
      .string({ minLength: 1, maxLength: 64 })
      .filter(
        (s) => !Object.values(HookEventName).includes(s as HookEventName),
      ),
    fc.string({ minLength: 1, maxLength: 64 }),
  ])(
    'METAMORPHIC: invalid event name always produces success=false @plan:PLAN-20250218-HOOKSYSTEM.P07',
    async (invalidEventName, correlationId) => {
      const localBus = new FakeMessageBus();
      const localHandler = new HookEventHandler(
        makeConfig(),
        makeRegistry(),
        makePlanner(),
        makeRunner(),
        makeAggregator(),
        localBus as unknown as import('../../confirmation-bus/message-bus.js').MessageBus,
        DebugLogger.getLogger('test'),
      );

      const request = {
        eventName: invalidEventName as unknown as HookEventName,
        input: {},
        correlationId,
      };

      localBus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
      await waitMs(50);

      const responses = localBus.getPublishedResponses();
      // eslint-disable-next-line vitest/no-standalone-expect -- test.prop wraps test block
      expect(responses.length).toBeGreaterThan(0);
      // eslint-disable-next-line vitest/no-standalone-expect -- test.prop wraps test block
      expect(responses[0].success).toBe(false);
      // eslint-disable-next-line vitest/no-standalone-expect -- test.prop wraps test block
      expect(responses[0].correlationId).toBe(correlationId);

      localHandler.dispose();
    },
  );
});

// ---------------------------------------------------------------------------
// Test Group 4: Bus-absent fallback (DELTA-HBUS-002)
// ---------------------------------------------------------------------------

describe('Bus-absent fallback (DELTA-HBUS-002)', () => {
  let handler: HookEventHandler;

  beforeEach(() => {
    handler = new HookEventHandler(
      makeConfig(),
      makeRegistry(),
      makePlanner(),
      makeRunner(),
      makeAggregator(),
      undefined,
      DebugLogger.getLogger('test'),
    );
  });

  afterEach(() => {
    handler?.dispose();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HBUS-002
   * @given HookEventHandler constructed WITHOUT MessageBus
   * @when fireBeforeToolEvent() is called
   * @then execution proceeds normally (returns undefined when no hooks match)
   */
  it('fireBeforeToolEvent works without MessageBus @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    // fireBeforeToolEvent returns DefaultHookOutput | undefined
    // When no hooks match, it returns undefined (which is valid behavior)
    const result = await handler.fireBeforeToolEvent('tool1', {});
    // No hooks registered, so result is undefined - that's expected
    expect(result).toBeUndefined();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HBUS-002
   * @given HookEventHandler constructed WITHOUT MessageBus
   * @when fireAfterToolEvent() is called
   * @then execution proceeds normally (returns undefined when no hooks match)
   */
  it('fireAfterToolEvent works without MessageBus @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    // fireAfterToolEvent returns DefaultHookOutput | undefined
    // When no hooks match, it returns undefined (which is valid behavior)
    const result = await handler.fireAfterToolEvent('tool1', {}, {});
    // No hooks registered, so result is undefined - that's expected
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test Group 5: correlationId generation (DELTA-HBUS-003)
// ---------------------------------------------------------------------------

describe('correlationId generation (DELTA-HBUS-003)', () => {
  let handler: HookEventHandler;
  let bus: FakeMessageBus;

  beforeEach(() => {
    bus = new FakeMessageBus();
    handler = new HookEventHandler(
      makeConfig(),
      makeRegistry(),
      makePlanner(),
      makeRunner(),
      makeAggregator(),
      bus as unknown as import('../../confirmation-bus/message-bus.js').MessageBus,
      DebugLogger.getLogger('test'),
    );
  });

  afterEach(() => {
    handler?.dispose();
    bus.clear();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HBUS-003
   * @given HOOK_EXECUTION_REQUEST without correlationId field
   * @when handler processes it
   * @then response has a generated non-empty correlationId
   */
  it('generates correlationId when missing from request @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    const request = {
      eventName: HookEventName.BeforeTool,
      input: { tool_name: 'tool1', tool_input: {} },
      // correlationId intentionally omitted
    };

    bus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
    await waitMs(50);

    const responses = bus.getPublishedResponses();
    expect(responses).toHaveLength(1);
    expect(responses[0].correlationId).toBeDefined();
    expect(responses[0].correlationId.length).toBeGreaterThan(0);
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HBUS-003
   * @given HOOK_EXECUTION_REQUEST without correlationId
   * @when handler generates one
   * @then it matches UUID format
   */
  it('generated correlationId matches UUID format @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    const request = {
      eventName: HookEventName.BeforeTool,
      input: { tool_name: 'tool1', tool_input: {} },
    };

    bus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
    await waitMs(50);

    const responses = bus.getPublishedResponses();
    expect(responses).toHaveLength(1);
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(responses[0].correlationId).toMatch(uuidRegex);
  });

  /**
   * METAMORPHIC INVARIANT: response always has non-empty correlationId
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HBUS-003
   */
  test.prop([fc.constantFrom(...Object.values(HookEventName))])(
    'METAMORPHIC: response always has non-empty correlationId @plan:PLAN-20250218-HOOKSYSTEM.P07',
    async (eventName) => {
      const localBus = new FakeMessageBus();
      const localHandler = new HookEventHandler(
        makeConfig(),
        makeRegistry(),
        makePlanner(),
        makeRunner(),
        makeAggregator(),
        localBus as unknown as import('../../confirmation-bus/message-bus.js').MessageBus,
        DebugLogger.getLogger('test'),
      );

      const request = {
        eventName,
        input: {},
        // no correlationId
      };

      localBus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
      await waitMs(50);

      const responses = localBus.getPublishedResponses();
      // eslint-disable-next-line vitest/no-standalone-expect -- test.prop wraps test block
      expect(responses.length).toBeGreaterThan(0);
      // eslint-disable-next-line vitest/no-standalone-expect -- test.prop wraps test block
      expect(responses[0].correlationId).toBeDefined();
      // eslint-disable-next-line vitest/no-standalone-expect -- test.prop wraps test block
      expect(responses[0].correlationId.length).toBeGreaterThan(0);

      localHandler.dispose();
    },
  );
});

// ---------------------------------------------------------------------------
// Test Group 6: Model translation (DELTA-HPAY-003)
// ---------------------------------------------------------------------------

describe('Model translation (DELTA-HPAY-003)', () => {
  let handler: HookEventHandler;

  beforeEach(() => {
    handler = new HookEventHandler(
      makeConfig(),
      makeRegistry(),
      makePlanner(),
      makeRunner(),
      makeAggregator(),
      undefined,
      DebugLogger.getLogger('test'),
    );
  });

  afterEach(() => {
    handler?.dispose();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HPAY-003
   * @given fireBeforeModelEvent is called with model request
   * @when execution proceeds
   * @then the result is returned (translation happens internally)
   */
  it('fireBeforeModelEvent accepts model payload @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    const result = await handler.fireBeforeModelEvent(
      { messages: [{ role: 'user', content: 'test' }] },
      { model: 'gpt-4' },
    );
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HPAY-003
   * @given fireAfterModelEvent is called
   * @when execution proceeds
   * @then the result is returned
   */
  it('fireAfterModelEvent accepts model response @plan:PLAN-20250218-HOOKSYSTEM.P07', async () => {
    const result = await handler.fireAfterModelEvent(
      { messages: [] },
      { candidates: [] },
    );
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  /**
   * METAMORPHIC INVARIANT: exactly one response per request (cardinality invariant)
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P07
   * @requirement DELTA-HEVT-002
   */
  test.prop([
    fc.constantFrom(...Object.values(HookEventName)),
    fc.string({ minLength: 1, maxLength: 64 }),
  ])(
    'METAMORPHIC: exactly one response per request @plan:PLAN-20250218-HOOKSYSTEM.P07',
    async (eventName, correlationId) => {
      const localBus = new FakeMessageBus();
      const localHandler = new HookEventHandler(
        makeConfig(),
        makeRegistry(),
        makePlanner(),
        makeRunner(),
        makeAggregator(),
        localBus as unknown as import('../../confirmation-bus/message-bus.js').MessageBus,
        DebugLogger.getLogger('test'),
      );

      const request = {
        eventName,
        input: {},
        correlationId,
      };

      localBus.publish({ type: HOOK_EXECUTION_REQUEST, payload: request });
      await waitMs(50);

      const responses = localBus.getPublishedResponses();
      // eslint-disable-next-line vitest/no-standalone-expect -- test.prop wraps test block
      expect(responses).toHaveLength(1);

      localHandler.dispose();
    },
  );
});
