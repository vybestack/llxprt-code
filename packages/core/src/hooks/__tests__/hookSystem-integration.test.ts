/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P15
 * @requirement DELTA-HSYS-001,DELTA-HSYS-002,DELTA-HEVT-004,DELTA-HBUS-002,
 *              DELTA-HPAY-006,DELTA-HAPP-001,DELTA-HAPP-002
 *
 * Integration tests for the complete hook system: HookSystem, HookEventHandler,
 * HookRegistry, HookPlanner, HookRunner, HookAggregator working together.
 *
 * These tests use REAL components (not mocks) wherever possible.
 * A minimal FakeMessageBus is used only to make pub/sub observable without
 * pulling in PolicyEngine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { HookSystem } from '../hookSystem.js';
import {
  SessionStartSource,
  SessionEndReason,
  HookEventName,
} from '../types.js';
import type {
  HookExecutionRequest,
  HookExecutionResponse,
} from '../hookBusContracts.js';
import { DebugLogger } from '../../debug/index.js';
import type { Config } from '../../config/config.js';
import type { MessageBus } from '../../confirmation-bus/message-bus.js';
import type { MessageBusType } from '../../confirmation-bus/types.js';

// ---------------------------------------------------------------------------
// Minimal observable message bus – no PolicyEngine dependency
// ---------------------------------------------------------------------------

const HOOK_EXECUTION_REQUEST = 'HOOK_EXECUTION_REQUEST';
const HOOK_EXECUTION_RESPONSE = 'HOOK_EXECUTION_RESPONSE';

class FakeMessageBus {
  private emitter = new EventEmitter();
  private published: Array<{ type: string; payload: unknown }> = [];

  publish(message: { type: string; payload?: unknown }): void {
    this.published.push({ type: message.type, payload: message.payload });
    this.emitter.emit(message.type, message);
  }

  subscribe<T>(
    type: MessageBusType | string,
    handler: (msg: T) => void,
  ): () => void {
    this.emitter.on(type as string, handler);
    return () => this.emitter.off(type as string, handler);
  }

  responses(): HookExecutionResponse[] {
    return this.published
      .filter((m) => m.type === HOOK_EXECUTION_RESPONSE)
      .map((m) => m.payload as HookExecutionResponse);
  }

  clear(): void {
    this.published = [];
    this.emitter.removeAllListeners();
  }
}

// ---------------------------------------------------------------------------
// Mock for DebugLogger module (avoids file system access)
// ---------------------------------------------------------------------------

vi.mock('../../debug/index.js', () => ({
  DebugLogger: {
    getLogger: vi.fn(() => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(hooksOverride?: Record<string, unknown>): Config {
  return {
    storage: { getGeminiDir: vi.fn().mockReturnValue('/project/.gemini') },
    getExtensions: vi.fn().mockReturnValue([]),
    getHooks: vi.fn().mockReturnValue(hooksOverride ?? {}),
    getSessionId: vi.fn().mockReturnValue('integration-test-session'),
    getTargetDir: vi.fn().mockReturnValue('/test/project'),
    getEnableHooks: vi.fn().mockReturnValue(true),
  } as unknown as Config;
}

function makeConfigWithHook(): Config {
  return makeConfig({
    BeforeTool: [
      {
        hooks: [{ type: 'command', command: './hooks/check.sh' }],
      },
    ],
  });
}

function makeConfigWithModelHook(): Config {
  return makeConfig({
    BeforeModel: [
      {
        hooks: [{ type: 'command', command: './hooks/model-check.sh' }],
      },
    ],
  });
}

function makeDebugLogger(): DebugLogger {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as DebugLogger;
}

async function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test 1: Full mediated path round-trip
// @plan PLAN-20250218-HOOKSYSTEM.P15
// @requirement DELTA-HSYS-001, DELTA-HBUS-001
// ---------------------------------------------------------------------------

describe('Integration: mediated path round-trip (DELTA-HSYS-001)', () => {
  let bus: FakeMessageBus;
  let system: HookSystem;

  beforeEach(async () => {
    bus = new FakeMessageBus();
    system = new HookSystem(makeConfig(), bus as unknown as MessageBus);
    await system.initialize();
  });

  afterEach(() => {
    system.dispose();
    bus.clear();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HSYS-001
   * @given HookSystem initialized with a FakeMessageBus
   * @when HOOK_EXECUTION_REQUEST is published with a valid BeforeModel payload
   * @then HOOK_EXECUTION_RESPONSE is published with success=true and a correlationId
   */
  it('publishes HOOK_EXECUTION_RESPONSE after a valid HOOK_EXECUTION_REQUEST @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const correlationId = 'test-correlation-id-001';
    const request: HookExecutionRequest = {
      eventName: HookEventName.BeforeModel,
      input: {
        llm_request: { messages: [{ role: 'user', content: 'hello' }] },
      },
      correlationId,
    };

    bus.publish({
      type: HOOK_EXECUTION_REQUEST,
      payload: request,
    });

    // Allow async handler to run
    await waitMs(50);

    const responses = bus.responses();
    expect(responses.length).toBeGreaterThanOrEqual(1);
    const response = responses.find((r) => r.correlationId === correlationId);
    expect(response).toBeDefined();
    expect(response!.success).toBe(true);
    expect(response!.correlationId).toBe(correlationId);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Mediated path with invalid payload (missing required field)
// @plan PLAN-20250218-HOOKSYSTEM.P15
// @requirement DELTA-HPAY-001
// ---------------------------------------------------------------------------

describe('Integration: mediated path invalid payload (DELTA-HPAY-001)', () => {
  let bus: FakeMessageBus;
  let system: HookSystem;

  beforeEach(async () => {
    bus = new FakeMessageBus();
    system = new HookSystem(makeConfig(), bus as unknown as MessageBus);
    await system.initialize();
  });

  afterEach(() => {
    system.dispose();
    bus.clear();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HPAY-001
   * @given HookSystem with MessageBus
   * @when a request is published with payload missing the 'input' field
   * @then the response has success=false and an error describing the failure
   */
  it('returns validation failure when payload is missing required fields @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const correlationId = 'test-correlation-id-002';

    // Publish a message with missing 'input' field – triggers invalid_request
    bus.publish({
      type: HOOK_EXECUTION_REQUEST,
      payload: { eventName: HookEventName.BeforeTool, correlationId },
    });

    await waitMs(50);

    const responses = bus.responses();
    expect(responses.length).toBeGreaterThanOrEqual(1);
    const response = responses.find((r) => r.correlationId === correlationId);
    expect(response).toBeDefined();
    expect(response!.success).toBe(false);
    expect(response!.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 3: Direct path without MessageBus
// @plan PLAN-20250218-HOOKSYSTEM.P15
// @requirement DELTA-HBUS-002
// ---------------------------------------------------------------------------

describe('Integration: direct path without MessageBus (DELTA-HBUS-002)', () => {
  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HBUS-002
   * @given HookSystem constructed without a MessageBus
   * @when fireBeforeModelEvent is called directly
   * @then it returns an AggregatedHookResult with success=true
   */
  it('fireBeforeModelEvent works on direct path without MessageBus @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const system = new HookSystem(makeConfig());
    await system.initialize();

    const handler = system.getEventHandler();
    const result = await handler.fireBeforeModelEvent({ messages: [] });

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);

    system.dispose();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HBUS-002
   * @given HookSystem constructed without a MessageBus
   * @when fireSessionStartEvent is called directly
   * @then it returns an AggregatedHookResult with success=true
   */
  it('fireSessionStartEvent works on direct path without MessageBus @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const system = new HookSystem(makeConfig());
    await system.initialize();

    const result = await system
      .getEventHandler()
      .fireSessionStartEvent({ source: SessionStartSource.Startup });

    expect(result.success).toBe(true);

    system.dispose();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Management APIs
// @plan PLAN-20250218-HOOKSYSTEM.P15
// @requirement DELTA-HSYS-002
// ---------------------------------------------------------------------------

describe('Integration: management APIs (DELTA-HSYS-002)', () => {
  let system: HookSystem;

  beforeEach(async () => {
    system = new HookSystem(makeConfigWithHook());
    await system.initialize();
  });

  afterEach(() => {
    system.dispose();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HSYS-002
   * @given HookSystem initialized with a BeforeTool hook
   * @when getAllHooks() is called
   * @then it returns an array containing the registered hook entry
   */
  it('getAllHooks() returns all registered hooks @plan:PLAN-20250218-HOOKSYSTEM.P15', () => {
    const hooks = system.getAllHooks();
    expect(Array.isArray(hooks)).toBe(true);
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks[0]).toHaveProperty('config');
    expect(hooks[0]).toHaveProperty('enabled');
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HSYS-002
   * @given a registered hook with command './hooks/check.sh'
   * @when setHookEnabled('./hooks/check.sh', false) is called
   * @then getAllHooks() shows that hook as disabled
   */
  it('setHookEnabled(id, false) marks the hook disabled @plan:PLAN-20250218-HOOKSYSTEM.P15', () => {
    system.setHookEnabled('./hooks/check.sh', false);

    const hooks = system.getAllHooks();
    const target = hooks.find((h) => h.config.command === './hooks/check.sh');
    expect(target).toBeDefined();
    expect(target!.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 5: dispose() / teardown
// @plan PLAN-20250218-HOOKSYSTEM.P15
// @requirement DELTA-HEVT-004
// ---------------------------------------------------------------------------

describe('Integration: dispose() / teardown (DELTA-HEVT-004)', () => {
  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HEVT-004
   * @given HookSystem initialized with a FakeMessageBus
   * @when dispose() is called and then a HOOK_EXECUTION_REQUEST is published
   * @then no HOOK_EXECUTION_RESPONSE is published (subscription was torn down)
   */
  it('after dispose(), bus messages are ignored @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const bus = new FakeMessageBus();
    const system = new HookSystem(makeConfig(), bus as unknown as MessageBus);
    await system.initialize();

    // Confirm handler works before dispose
    const correlationIdBefore = 'before-dispose';
    bus.publish({
      type: HOOK_EXECUTION_REQUEST,
      payload: {
        eventName: HookEventName.BeforeModel,
        input: { messages: [] },
        correlationId: correlationIdBefore,
      },
    });
    await waitMs(50);
    const beforeDispose = bus.responses();
    expect(
      beforeDispose.some((r) => r.correlationId === correlationIdBefore),
    ).toBe(true);

    // Dispose and clear recorded messages
    system.dispose();
    bus.clear();

    // Publish after dispose – should produce no response
    bus.publish({
      type: HOOK_EXECUTION_REQUEST,
      payload: {
        eventName: HookEventName.BeforeModel,
        input: { messages: [] },
        correlationId: 'after-dispose',
      },
    });
    await waitMs(50);

    const afterDispose = bus.responses();
    expect(afterDispose.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Model translation (direct path)
// @plan PLAN-20250218-HOOKSYSTEM.P15
// @requirement DELTA-HPAY-003
// ---------------------------------------------------------------------------

describe('Integration: fireBeforeModelEvent payload translation (DELTA-HPAY-003)', () => {
  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HPAY-003
   * @given HookSystem without a MessageBus
   * @when fireBeforeModelEvent is called with a structured llmRequest object
   * @then it returns a well-formed AggregatedHookResult (translation does not crash)
   */
  it('fireBeforeModelEvent accepts arbitrary llmRequest without crashing @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const system = new HookSystem(makeConfig());
    await system.initialize();

    const llmRequest = {
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      model: 'gemini-pro',
      temperature: 0.7,
    };

    const result = await system
      .getEventHandler()
      .fireBeforeModelEvent(llmRequest);

    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(typeof result.totalDuration).toBe('number');

    system.dispose();
  });
});

// ---------------------------------------------------------------------------
// Test 7: ProcessedHookResult stop semantics
// @plan PLAN-20250218-HOOKSYSTEM.P15
// @requirement DELTA-HAPP-001, DELTA-HAPP-002
// ---------------------------------------------------------------------------

describe('Integration: ProcessedHookResult stop semantics (DELTA-HAPP-001/002)', () => {
  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HAPP-001, DELTA-HAPP-002
   * @given HookEventHandler with access to processCommonHookOutputFields (via reflection)
   * @when an aggregated result with empty allOutputs is processed
   * @then shouldStop=false, stopReason=undefined, suppressOutput=false
   */
  it('empty result produces shouldStop=false via processCommonHookOutputFields @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const system = new HookSystem(makeConfig());
    await system.initialize();
    const handler = system.getEventHandler();

    const emptyResult = handler.makeEmptySuccessResult();

    // processCommonHookOutputFields is private; access via reflection (same pattern as hookSemantics.test.ts)
    const processMethod = (
      handler as unknown as {
        processCommonHookOutputFields: (
          agg: typeof emptyResult,
        ) => import('../hookEventHandler.js').ProcessedHookResult;
      }
    ).processCommonHookOutputFields.bind(handler);

    const processed = processMethod(emptyResult);

    expect(processed.shouldStop).toBe(false);
    expect(processed.stopReason).toBeUndefined();
    expect(processed.suppressOutput).toBe(false);

    system.dispose();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HAPP-001, DELTA-HAPP-002
   * @given HookEventHandler
   * @when an aggregated result with a hook output containing continue=false and stopReason is processed
   * @then shouldStop=true and stopReason matches the value from the hook output (upstream parity)
   */
  it('hook output with stopReason surfaces as shouldStop=true @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const system = new HookSystem(makeConfig());
    await system.initialize();
    const handler = system.getEventHandler();

    const { DefaultHookOutput } = await import('../types.js');
    const aggregatedWithStop = {
      success: true,
      finalOutput: undefined,
      allOutputs: [
        new DefaultHookOutput({
          continue: false,
          stopReason: 'context limit reached',
        }),
      ],
      errors: [],
      totalDuration: 10,
    };

    const processMethod = (
      handler as unknown as {
        processCommonHookOutputFields: (
          agg: typeof aggregatedWithStop,
        ) => import('../hookEventHandler.js').ProcessedHookResult;
      }
    ).processCommonHookOutputFields.bind(handler);

    const processed = processMethod(aggregatedWithStop);

    expect(processed.shouldStop).toBe(true);
    expect(processed.stopReason).toBe('context limit reached');

    system.dispose();
  });
});

// ---------------------------------------------------------------------------
// Test 8: DebugLogger integration
// @plan PLAN-20250218-HOOKSYSTEM.P15
// @requirement DELTA-HTEL-001, DELTA-HTEL-002
// ---------------------------------------------------------------------------

describe('Integration: DebugLogger receives hook telemetry (DELTA-HTEL-001/002)', () => {
  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HTEL-001, DELTA-HTEL-002
   * @given HookSystem constructed with an injected DebugLogger
   * @when fireBeforeModelEvent is called
   * @then the injected logger's log or debug method is called at least once
   */
  it('injected DebugLogger receives log calls during event firing @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const spyLogger = makeDebugLogger();
    const system = new HookSystem(makeConfig(), undefined, spyLogger);
    await system.initialize();

    await system.getEventHandler().fireBeforeModelEvent({ messages: [] });

    const logCalled =
      (spyLogger.log as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    const debugCalled =
      (spyLogger.debug as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    expect(logCalled || debugCalled).toBe(true);

    system.dispose();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HTEL-002
   * @given HookSystem constructed with an injected DebugLogger
   * @when fireBeforeModelEvent is called
   * @then the logger receives a 'hook:batch_summary' log with expected shape
   */
  it('DebugLogger receives hook:batch_summary log @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const spyLogger = makeDebugLogger();
    // Use a config with a BeforeModel hook so emitBatchSummary is called
    // (emitBatchSummary only fires when there are hooks to execute)
    const system = new HookSystem(
      makeConfigWithModelHook(),
      undefined,
      spyLogger,
    );
    await system.initialize();

    await system.getEventHandler().fireBeforeModelEvent({ messages: [] });

    const logMock = spyLogger.log as ReturnType<typeof vi.fn>;
    const batchSummaryCalls = logMock.mock.calls.filter(
      (args) => args[0] === 'hook:batch_summary',
    );
    expect(batchSummaryCalls.length).toBeGreaterThan(0);

    const record = batchSummaryCalls[0][1] as Record<string, unknown>;
    expect(record).toHaveProperty('eventName');
    expect(record).toHaveProperty('hookCount');
    expect(record).toHaveProperty('successCount');
    expect(record).toHaveProperty('failureCount');
    expect(record).toHaveProperty('totalDurationMs');

    system.dispose();
  });
});

// ---------------------------------------------------------------------------
// Test 9: fireSessionStartEvent typed parameter
// @plan PLAN-20250218-HOOKSYSTEM.P15
// @requirement DELTA-HPAY-006
// ---------------------------------------------------------------------------

describe('Integration: fireSessionStartEvent uses SessionStartSource enum (DELTA-HPAY-006)', () => {
  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HPAY-006
   * @given HookSystem without a MessageBus
   * @when fireSessionStartEvent is called with each SessionStartSource value
   * @then all calls succeed without error and return success=true
   */
  it('accepts all SessionStartSource enum values @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const system = new HookSystem(makeConfig());
    await system.initialize();
    const handler = system.getEventHandler();

    for (const source of Object.values(SessionStartSource)) {
      const result = await handler.fireSessionStartEvent({ source });
      expect(result.success).toBe(true);
    }

    system.dispose();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HPAY-006
   * @given HookSystem without a MessageBus
   * @when fireSessionEndEvent is called with each SessionEndReason value
   * @then all calls succeed without error and return success=true
   */
  it('fireSessionEndEvent accepts all SessionEndReason enum values @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const system = new HookSystem(makeConfig());
    await system.initialize();
    const handler = system.getEventHandler();

    for (const reason of Object.values(SessionEndReason)) {
      const result = await handler.fireSessionEndEvent({ reason });
      expect(result.success).toBe(true);
    }

    system.dispose();
  });
});

// ---------------------------------------------------------------------------
// Test 10: Failure envelope from broken hook / buildFailureEnvelope
// @plan PLAN-20250218-HOOKSYSTEM.P15
// @requirement DELTA-HFAIL-005
// ---------------------------------------------------------------------------

describe('Integration: failure envelope from buildFailureEnvelope (DELTA-HFAIL-005)', () => {
  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HFAIL-005
   * @given HookEventHandler's buildFailureEnvelope method
   * @when called with an Error object
   * @then returns a structured AggregatedHookResult with success=false and errors[]
   */
  it('buildFailureEnvelope produces structured error result @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const system = new HookSystem(makeConfig());
    await system.initialize();
    const handler = system.getEventHandler();

    const err = new Error('hook script crashed');
    const envelope = handler.buildFailureEnvelope(err, 'execution', {
      eventName: HookEventName.BeforeTool,
    });

    expect(envelope.success).toBe(false);
    expect(Array.isArray(envelope.errors)).toBe(true);
    expect(envelope.errors.length).toBeGreaterThan(0);
    expect(envelope.errors[0].message).toContain('hook script crashed');
    expect(envelope.allOutputs).toEqual([]);

    system.dispose();
  });

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P15
   * @requirement DELTA-HFAIL-005
   * @given HookEventHandler's buildFailureEnvelope method
   * @when called with a plain string error
   * @then wraps it in an Error and returns success=false
   */
  it('buildFailureEnvelope wraps string errors @plan:PLAN-20250218-HOOKSYSTEM.P15', async () => {
    const system = new HookSystem(makeConfig());
    await system.initialize();
    const handler = system.getEventHandler();

    const envelope = handler.buildFailureEnvelope(
      'something went wrong',
      'planning',
    );

    expect(envelope.success).toBe(false);
    expect(envelope.errors.length).toBeGreaterThan(0);
    expect(envelope.errors[0]).toBeInstanceOf(Error);

    system.dispose();
  });
});
