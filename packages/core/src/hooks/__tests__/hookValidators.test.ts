/**
 * TDD tests for hook payload validators
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P10
 * @requirement DELTA-HPAY-001, DELTA-HPAY-002, DELTA-HPAY-005
 *
 * These tests verify runtime validation at mediated boundaries.
 * All validators are type predicates that narrow TypeScript types.
 */
import { describe, it, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';

import {
  validateBeforeToolInput,
  validateAfterToolInput,
  validateBeforeAgentInput,
  validateAfterAgentInput,
  validateBeforeModelInput,
  validateAfterModelInput,
  validateBeforeToolSelectionInput,
  validateNotificationInput,
  isObject,
  isNonEmptyString,
} from '../hookValidators.js';
import { NotificationType } from '../types.js';

// =============================================================================
// Test Group 1: BeforeTool validator (DELTA-HPAY-001)
// =============================================================================
describe('validateBeforeToolInput @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P10
   * @requirement DELTA-HPAY-001
   * @scenario Valid BeforeTool input
   * @given { tool_name: 'read_file', tool_input: { path: '/tmp/x.txt' } }
   * @when validateBeforeToolInput called
   * @then returns true
   */
  it('accepts valid payload with tool_name and tool_input @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {
      tool_name: 'read_file',
      tool_input: { path: '/tmp/x.txt' },
    };
    expect(validateBeforeToolInput(input)).toBe(true);
  });

  it('rejects payload missing tool_name @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { tool_input: { path: '/tmp/x.txt' } };
    expect(validateBeforeToolInput(input)).toBe(false);
  });

  it('rejects payload missing tool_input @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { tool_name: 'read_file' };
    expect(validateBeforeToolInput(input)).toBe(false);
  });

  it('rejects non-object tool_input @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { tool_name: 'x', tool_input: 'string' };
    expect(validateBeforeToolInput(input)).toBe(false);
  });

  it('rejects empty string tool_name @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { tool_name: '', tool_input: {} };
    expect(validateBeforeToolInput(input)).toBe(false);
  });
});

// =============================================================================
// Test Group 2: AfterTool validator (DELTA-HPAY-001)
// =============================================================================
describe('validateAfterToolInput @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  it('accepts valid payload with tool_name, tool_input, tool_response @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {
      tool_name: 'read_file',
      tool_input: { path: '/tmp/x.txt' },
      tool_response: { content: 'hello' },
    };
    expect(validateAfterToolInput(input)).toBe(true);
  });

  it('rejects payload missing tool_response @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {
      tool_name: 'read_file',
      tool_input: { path: '/tmp/x.txt' },
    };
    expect(validateAfterToolInput(input)).toBe(false);
  });

  it('rejects non-object tool_response @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {
      tool_name: 'read_file',
      tool_input: {},
      tool_response: 'string',
    };
    expect(validateAfterToolInput(input)).toBe(false);
  });
});

// =============================================================================
// Test Group 3: BeforeAgent / AfterAgent validators (DELTA-HPAY-001)
// =============================================================================
describe('validateBeforeAgentInput @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  it('accepts valid payload with prompt @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { prompt: 'Hello, agent!' };
    expect(validateBeforeAgentInput(input)).toBe(true);
  });

  it('rejects payload missing prompt @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {};
    expect(validateBeforeAgentInput(input)).toBe(false);
  });

  it('rejects non-string prompt @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { prompt: 123 };
    expect(validateBeforeAgentInput(input)).toBe(false);
  });
});

describe('validateAfterAgentInput @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  it('accepts valid payload with prompt, prompt_response, stop_hook_active @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {
      prompt: 'Hello',
      prompt_response: 'Hi there!',
      stop_hook_active: false,
    };
    expect(validateAfterAgentInput(input)).toBe(true);
  });

  it('rejects payload missing prompt_response @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { prompt: 'Hello', stop_hook_active: false };
    expect(validateAfterAgentInput(input)).toBe(false);
  });

  it('rejects payload missing stop_hook_active @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { prompt: 'Hello', prompt_response: 'Hi' };
    expect(validateAfterAgentInput(input)).toBe(false);
  });
});

// =============================================================================
// Test Group 4: BeforeModel / AfterModel / BeforeToolSelection validators
// =============================================================================
describe('validateBeforeModelInput @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  it('accepts valid payload with llm_request @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { llm_request: { messages: [] } };
    expect(validateBeforeModelInput(input)).toBe(true);
  });

  it('rejects payload missing llm_request @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {};
    expect(validateBeforeModelInput(input)).toBe(false);
  });

  it('rejects non-object llm_request @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { llm_request: 'string' };
    expect(validateBeforeModelInput(input)).toBe(false);
  });
});

describe('validateAfterModelInput @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  it('accepts valid payload with llm_request and llm_response @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {
      llm_request: { messages: [] },
      llm_response: { content: 'response' },
    };
    expect(validateAfterModelInput(input)).toBe(true);
  });

  it('rejects payload missing llm_response @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { llm_request: { messages: [] } };
    expect(validateAfterModelInput(input)).toBe(false);
  });
});

describe('validateBeforeToolSelectionInput @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  it('accepts valid payload with llm_request @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = { llm_request: { messages: [], tools: [] } };
    expect(validateBeforeToolSelectionInput(input)).toBe(true);
  });

  it('rejects payload missing llm_request @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {};
    expect(validateBeforeToolSelectionInput(input)).toBe(false);
  });
});

// =============================================================================
// Test Group 5: Notification validator (DELTA-HPAY-001)
// =============================================================================
describe('validateNotificationInput @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  it('accepts valid notification with type, message, details @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {
      notification_type: NotificationType.ToolPermission,
      message: 'Permission requested',
      details: { tool: 'read_file' },
    };
    expect(validateNotificationInput(input)).toBe(true);
  });

  it('rejects notification missing message @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {
      notification_type: NotificationType.ToolPermission,
      details: {},
    };
    expect(validateNotificationInput(input)).toBe(false);
  });

  it('rejects notification with non-string message @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {
      notification_type: NotificationType.ToolPermission,
      message: 123,
      details: {},
    };
    expect(validateNotificationInput(input)).toBe(false);
  });

  it('rejects notification missing details @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    const input = {
      notification_type: NotificationType.ToolPermission,
      message: 'test',
    };
    expect(validateNotificationInput(input)).toBe(false);
  });
});

// =============================================================================
// Test Group 6: Helper validators (isObject, isNonEmptyString)
// =============================================================================
describe('isObject @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  it('returns true for plain object @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    expect(isObject({ key: 'value' })).toBe(true);
  });

  it('returns false for null @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    expect(isObject(null)).toBe(false);
  });

  it('returns false for array @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    expect(isObject([1, 2, 3])).toBe(false);
  });

  it('returns false for primitive @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    expect(isObject('string')).toBe(false);
  });
});

describe('isNonEmptyString @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  it('returns true for non-empty string @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    expect(isNonEmptyString('hello')).toBe(true);
  });

  it('returns false for empty string @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    expect(isNonEmptyString('')).toBe(false);
  });

  it('returns false for non-string @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
    expect(isNonEmptyString(123)).toBe(false);
  });
});

// =============================================================================
// Property-Based Tests (30%+ of tests) - METAMORPHIC INVARIANTS
// =============================================================================
describe('Property-based validation invariants @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  /**
   * METAMORPHIC INVARIANT 1: extra fields never break a valid payload (toleration)
   * Domain entropy: non-empty tool names + shaped input record + extra scalar fields
   * @plan PLAN-20250218-HOOKSYSTEM.P10
   * @requirement DELTA-HPAY-001
   */
  test.prop([
    fc.string({ minLength: 1, maxLength: 64 }), // non-empty tool name
    fc.record({
      // shaped input record
      path: fc.string({ minLength: 1 }),
      encoding: fc.constantFrom('utf8', 'binary', 'base64'),
    }),
    fc.record({
      // extra fields: scalar values
      extra_flag: fc.boolean(),
      extra_count: fc.integer({ min: 0, max: 999 }),
    }),
  ])(
    'METAMORPHIC: validateBeforeToolInput(valid + extra) === validateBeforeToolInput(valid) @plan:PLAN-20250218-HOOKSYSTEM.P10',
    (toolName, toolInput, extraFields) => {
      const base = { tool_name: toolName, tool_input: toolInput };
      const withExtra = { ...base, ...extraFields };
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(validateBeforeToolInput(withExtra)).toBe(
        validateBeforeToolInput(base),
      );
    },
  );

  /**
   * METAMORPHIC INVARIANT 2: removing required field ALWAYS fails (monotone failure)
   * Domain entropy: wide range of non-empty tool names and shaped inputs
   * @plan PLAN-20250218-HOOKSYSTEM.P10
   * @requirement DELTA-HPAY-001
   */
  test.prop([
    fc.string({ minLength: 1, maxLength: 64 }),
    fc.record({ path: fc.string({ minLength: 1 }) }),
  ])(
    'METAMORPHIC: validateBeforeToolInput fails when tool_name removed @plan:PLAN-20250218-HOOKSYSTEM.P10',
    (toolName, toolInput) => {
      const valid = { tool_name: toolName, tool_input: toolInput };
      const degraded = { tool_input: toolInput }; // required field removed
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(validateBeforeToolInput(valid)).toBe(true); // valid baseline
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(validateBeforeToolInput(degraded)).toBe(false); // degraded always fails
    },
  );

  /**
   * METAMORPHIC INVARIANT 3: all validators uniformly reject non-object primitives
   * Domain entropy: wide sample of primitives including edge cases
   * @plan PLAN-20250218-HOOKSYSTEM.P10
   * @requirement DELTA-HPAY-005
   */
  test.prop([
    fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.boolean(),
      fc.float(),
      fc.string({ maxLength: 10 }), // strings are primitives, not objects
    ),
  ])(
    'METAMORPHIC: all validators reject any primitive input @plan:PLAN-20250218-HOOKSYSTEM.P10',
    (primitive) => {
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(validateBeforeToolInput(primitive)).toBe(false);
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(validateAfterToolInput(primitive)).toBe(false);
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(validateBeforeModelInput(primitive)).toBe(false);
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(validateNotificationInput(primitive)).toBe(false);
    },
  );

  /**
   * METAMORPHIC INVARIANT 4: Notification validator accepts any non-empty string message
   * with any extra fields (toleration + positive path)
   * @plan PLAN-20250218-HOOKSYSTEM.P10
   * @requirement DELTA-HPAY-001
   */
  test.prop([
    fc.string({ minLength: 1, maxLength: 200 }), // non-empty message
    fc.record({
      severity: fc.constantFrom('info', 'warn', 'error'),
    }),
  ])(
    'METAMORPHIC: validateNotificationInput passes for valid notification @plan:PLAN-20250218-HOOKSYSTEM.P10',
    (message, extra) => {
      const payload = {
        notification_type: NotificationType.ToolPermission,
        message,
        details: { ...extra },
      };
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(validateNotificationInput(payload)).toBe(true);
    },
  );

  /**
   * METAMORPHIC INVARIANT 5: empty string is never a valid message for Notification
   * @plan PLAN-20250218-HOOKSYSTEM.P10
   * @requirement DELTA-HPAY-001
   */
  test.prop([
    fc.record({
      severity: fc.constantFrom('info', 'warn', 'error'),
    }),
  ])(
    'METAMORPHIC: validateNotificationInput rejects empty string message @plan:PLAN-20250218-HOOKSYSTEM.P10',
    (extra) => {
      const payload = {
        notification_type: NotificationType.ToolPermission,
        message: '',
        details: { ...extra },
      };
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(validateNotificationInput(payload)).toBe(false);
    },
  );

  /**
   * METAMORPHIC INVARIANT 6: BeforeAgent with any non-empty prompt passes
   * @plan PLAN-20250218-HOOKSYSTEM.P10
   * @requirement DELTA-HPAY-001
   */
  test.prop([fc.string({ minLength: 1, maxLength: 500 })])(
    'METAMORPHIC: validateBeforeAgentInput passes for any non-empty prompt @plan:PLAN-20250218-HOOKSYSTEM.P10',
    (prompt) => {
      // eslint-disable-next-line vitest/no-standalone-expect
      expect(validateBeforeAgentInput({ prompt })).toBe(true);
    },
  );
});
