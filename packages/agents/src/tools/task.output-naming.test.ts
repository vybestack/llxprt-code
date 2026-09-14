/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TaskTool output-parameter naming tests (Issue #2533).
 * Asserts the single canonical `expected_outputs` vocabulary: legacy
 * `output_spec` and camelCase spellings are rejected with a validation error
 * naming the canonical member, and `expected_outputs` values must be plain
 * string descriptions.
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { TaskTool, type TaskToolParams } from './task.js';
import { TaskTool, type TaskToolParams } from './task.js';
import {
  validateOutputSpec,
  validateOutputParams,
  normalizeTaskParams,
} from './taskToolGovernance.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';

const CANONICAL_TASK_PARAM_NAMES = [
  'async',
  'behaviour_prompts',
  'context',
  'expected_outputs',
  'goal_prompt',
  'grace_period_seconds',
  'max_turns',
  'subagent_name',
  'timeout_seconds',
  'tool_whitelist',
];

describe('Issue #2533: TaskTool single parameter vocabulary', () => {
  let config: Config;

  beforeEach(() => {
    config = {
      getSessionId: () => 'session-2533',
    } as unknown as Config;
  });

  function createTool(
    orchestrator: SubagentOrchestrator = {} as unknown as SubagentOrchestrator,
  ): TaskTool {
    return new TaskTool(config, {
      messageBus: new MessageBus(),
      orchestratorFactory: () => orchestrator,
    });
  }

  function buildWithExtra(extra: Record<string, unknown>): void {
    createTool().build({
      subagent_name: 'helper',
      goal_prompt: 'Do work',
      ...extra,
    } as unknown as TaskToolParams);
  }

  describe('validateOutputSpec', () => {
    it('returns null for a valid string-valued map', () => {
      expect(
        validateOutputSpec(
          { findings: 'A concise summary' },
          'expected_outputs',
        ),
      ).toBeNull();
    });

    it('returns null for an empty map', () => {
      expect(validateOutputSpec({}, 'expected_outputs')).toBeNull();
    });

    it('returns an error for a JSON-Schema-shaped object value', () => {
      const error = validateOutputSpec(
        {
          findings: {
            type: 'string',
            description: 'A concise summary',
          },
        } as unknown as Record<string, string>,
        'expected_outputs',
      );
      expect(error).toBe(
        "expected_outputs 'findings' must be a plain string description, not a JSON Schema object.",
      );
    });

    it('returns an error for a non-object spec', () => {
      expect(validateOutputSpec('not-an-object', 'expected_outputs')).toBe(
        'expected_outputs must be an object mapping variable names to string descriptions.',
      );
    });

    it('returns an error for an array spec', () => {
      expect(validateOutputSpec([], 'expected_outputs')).toBe(
        'expected_outputs must be an object mapping variable names to string descriptions.',
      );
    });

    it('returns an error for null', () => {
      expect(validateOutputSpec(null, 'expected_outputs')).toBe(
        'expected_outputs must be an object mapping variable names to string descriptions.',
      );
    });

    it('returns an error for a number value', () => {
      expect(
        validateOutputSpec(
          { count: 42 } as unknown as Record<string, string>,
          'expected_outputs',
        ),
      ).toBe(
        "expected_outputs 'count' must be a plain string description, not a number.",
      );
    });
  });

  describe('validateOutputParams', () => {
    it.each(['output_spec', 'outputSpec', 'expectedOutputs'] as const)(
      'rejects legacy %s even without schema validation',
      (legacyName) => {
        const params = {
          subagent_name: 'helper',
          goal_prompt: 'Do work',
          [legacyName]: { result: 'The outcome' },
        } as unknown as TaskToolParams;

        expect(validateOutputParams(params)).toContain(
          "use the canonical 'expected_outputs'",
        );
      },
    );
  });

  describe('validateToolParamValues', () => {
    class ValueValidatingTaskTool extends TaskTool {
      override validateToolParamValues(params: TaskToolParams): string | null {
        return super.validateToolParamValues(params);
      }
    }

    it.each([
      ['subagentName', 'subagent_name'],
      ['goalPrompt', 'goal_prompt'],
    ] as const)(
      'rejects legacy %s before validating values',
      (legacyName, canonicalName) => {
        const tool = new ValueValidatingTaskTool(config, {
          messageBus: new MessageBus(),
        });
        const params = {
          subagent_name: 'helper',
          goal_prompt: 'Do work',
          [legacyName]: 'legacy value',
        };

        expect(tool.validateToolParamValues(params)).toContain(
          `use the canonical '${canonicalName}'`,
        );
      },
    );
  });

  describe('normalizeTaskParams', () => {
    it('resolves expected_outputs into outputSpec', () => {
      const normalized = normalizeTaskParams({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        expected_outputs: { result: 'The outcome' },
      });
      expect(normalized.outputSpec).toStrictEqual({ result: 'The outcome' });
    });

    it('returns undefined when expected_outputs is absent', () => {
      const normalized = normalizeTaskParams({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
      });
      expect(normalized.outputSpec).toBeUndefined();
    });

    it('throws when expected_outputs contains JSON-Schema-shaped values', () => {
      expect(() =>
        normalizeTaskParams({
          subagent_name: 'helper',
          goal_prompt: 'Do work',
          expected_outputs: {
            findings: { type: 'string', description: 'bad' },
          } as unknown as Record<string, string>,
        }),
      ).toThrow(
        "expected_outputs 'findings' must be a plain string description, not a JSON Schema object.",
      );
    });

    it.each([
      ['subagentName', 'subagent_name'],
      ['goalPrompt', 'goal_prompt'],
      ['behaviourPrompts', 'behaviour_prompts'],
      ['behavior_prompts', 'behaviour_prompts'],
      ['behaviorPrompts', 'behaviour_prompts'],
      ['toolWhitelist', 'tool_whitelist'],
      ['output_spec', 'expected_outputs'],
      ['outputSpec', 'expected_outputs'],
      ['expectedOutputs', 'expected_outputs'],
      ['context_vars', 'context'],
      ['contextVars', 'context'],
    ] as const)(
      'rejects legacy %s before normalization can drop it',
      (legacyName, canonicalName) => {
        const params = {
          subagent_name: 'helper',
          goal_prompt: 'Do work',
          [legacyName]:
            canonicalName === 'expected_outputs'
              ? { result: 'The outcome' }
              : 'legacy value',
        } as unknown as TaskToolParams;

        expect(() => normalizeTaskParams(params)).toThrow(
          `use the canonical '${canonicalName}'`,
        );
      },
    );

    it.each([
      ['expected_outputs', 'output_spec', 'expected_outputs'],
      ['subagent_name', 'subagentName', 'subagent_name'],
    ] as const)(
      'rejects canonical %s combined with legacy %s',
      (canonicalName, legacyName, expectedCanonicalName) => {
        const params = {
          subagent_name: 'helper',
          goal_prompt: 'Do work',
          [canonicalName]:
            canonicalName === 'expected_outputs'
              ? { result: 'The canonical outcome' }
              : 'canonical value',
          [legacyName]:
            canonicalName === 'expected_outputs'
              ? { result: 'The outcome' }
              : 'legacy value',
        } as unknown as TaskToolParams;

        expect(() => normalizeTaskParams(params)).toThrow(
          `use the canonical '${expectedCanonicalName}'`,
        );
      },
    );
  });

  describe('taskToolSchema', () => {
    function runtimeParameterSchema(): Record<string, unknown> {
      const schema = createTool().schema.parametersJsonSchema;
      if (
        typeof schema !== 'object' ||
        schema === null ||
        Array.isArray(schema)
      ) {
        throw new Error('TaskTool runtime parameter schema must be an object.');
      }
      return schema;
    }

    it('exposes exactly the canonical property set at runtime', () => {
      const properties = runtimeParameterSchema()['properties'];
      if (
        typeof properties !== 'object' ||
        properties === null ||
        Array.isArray(properties)
      ) {
        throw new Error(
          'TaskTool runtime schema properties must be an object.',
        );
      }
      expect(Object.keys(properties).sort()).toStrictEqual(
        CANONICAL_TASK_PARAM_NAMES,
      );
    });

    it('rejects unknown properties', () => {
      expect(runtimeParameterSchema()['additionalProperties']).toBe(false);
    });

    it('describes expected_outputs string values', () => {
      expect(JSON.stringify(runtimeParameterSchema())).toContain(
        'Values must be strings, not JSON Schema objects.',
      );
    });
  });

  describe('TaskTool.build rejection of non-canonical spellings', () => {
    it('rejects output_spec with an error naming expected_outputs', () => {
      expect(() =>
        buildWithExtra({ output_spec: { result: 'The outcome' } }),
      ).toThrow("use the canonical 'expected_outputs'");
    });

    it.each([
      ['subagentName', 'subagent_name'],
      ['goalPrompt', 'goal_prompt'],
      ['behaviourPrompts', 'behaviour_prompts'],
      ['behavior_prompts', 'behaviour_prompts'],
      ['behaviorPrompts', 'behaviour_prompts'],
      ['toolWhitelist', 'tool_whitelist'],
      ['outputSpec', 'expected_outputs'],
      ['expectedOutputs', 'expected_outputs'],
      ['context_vars', 'context'],
      ['contextVars', 'context'],
    ] as const)(
      'rejects %s with an error naming %s',
      (legacyName, canonicalName) => {
        expect(() => buildWithExtra({ [legacyName]: 'value' })).toThrow(
          `use the canonical '${canonicalName}'`,
        );
      },
    );

    it('rejects a completely unknown property via the schema', () => {
      expect(() => buildWithExtra({ bogus_param: 'value' })).toThrow(
        'params must NOT have additional properties',
      );
    });

    it('requires the canonical subagent_name when only camelCase is given', () => {
      expect(() =>
        createTool().build({
          subagentName: 'helper',
          goalPrompt: 'Do work',
        } as unknown as TaskToolParams),
      ).toThrow("use the canonical 'subagent_name'");
    });
  });

  describe('TaskTool.build accepts canonical input', () => {
    it('accepts valid string-valued expected_outputs', () => {
      const invocation = createTool().build({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        expected_outputs: { findings: 'A concise summary' },
      });
      expect(invocation).toBeDefined();
    });

    it('rejects JSON-Schema-shaped expected_outputs at schema validation time', () => {
      expect(() =>
        createTool().build({
          subagent_name: 'helper',
          goal_prompt: 'Do work',
          expected_outputs: {
            findings: { type: 'string', description: 'bad' },
          } as unknown as Record<string, string>,
        }),
      ).toThrow(/expected_outputs\/findings must be string/);
    });

    it('validateToolParamValues rejects non-string expected_outputs values that bypass schema', () => {
      const tool = createTool();
      const error = (
        tool as unknown as {
          validateToolParamValues: (p: TaskToolParams) => string | null;
        }
      ).validateToolParamValues({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        expected_outputs: {
          findings: 42,
        } as unknown as Record<string, string>,
      });
      expect(error).toContain(
        "expected_outputs 'findings' must be a plain string description",
      );
    });
  });

  describe('TaskTool end-to-end output config', () => {
    it('passes expected_outputs into launchRequest.outputConfig', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn().mockResolvedValue(undefined),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-2533',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const tool = new TaskTool(config, {
        messageBus: new MessageBus(),
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => true,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        expected_outputs: { result: 'The outcome' },
      });

      await invocation.execute(new AbortController().signal, undefined);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          outputConfig: { outputs: { result: 'The outcome' } },
        }),
        expect.any(AbortSignal),
      );
    });
  });
});
