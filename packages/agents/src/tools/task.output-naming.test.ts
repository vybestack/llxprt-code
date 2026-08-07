/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TaskTool output-parameter naming tests (Issue #2255).
 * Covers the preferred `expected_outputs` parameter, the backward-compatible
 * `output_spec` alias, precedence when both are provided, and validation that
 * rejects JSON-Schema-shaped object values.
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { TaskTool, type TaskToolParams } from './task.js';
import {
  validateOutputSpec,
  normalizeTaskParams,
} from './taskToolGovernance.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';

describe('Issue #2255: TaskTool output parameter naming', () => {
  let config: Config;

  beforeEach(() => {
    config = {
      getSessionId: () => 'session-2255',
    } as unknown as Config;
  });

  function createMockLaunch() {
    const dispose = vi.fn().mockResolvedValue(undefined);
    // SubAgentScope requires runNonInteractive/onMessage even though the
    // interactive-path tests only exercise runInteractive.
    const scope = {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi.fn().mockResolvedValue(undefined),
      runNonInteractive: vi.fn(),
      onMessage: undefined,
    };
    // SubagentLaunchResult requires all fields; prompt/profile/config/runtime
    // are unused by these tests but must be present to satisfy the type.
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-2255',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    return { launch, orchestrator };
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

  describe('normalizeTaskParams precedence', () => {
    it('prefers expected_outputs over output_spec when both are provided', () => {
      const normalized = normalizeTaskParams({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        expected_outputs: { result: 'from expected_outputs' },
        output_spec: { result: 'from output_spec' },
      });
      expect(normalized.outputSpec).toStrictEqual({
        result: 'from expected_outputs',
      });
    });

    it('validates the output_spec alias when expected_outputs takes precedence', () => {
      expect(() =>
        normalizeTaskParams({
          subagent_name: 'helper',
          goal_prompt: 'Do work',
          expected_outputs: { result: 'preferred' },
          output_spec: {
            result: { type: 'string', description: 'invalid alias' },
          } as unknown as Record<string, string>,
        }),
      ).toThrow(
        "output_spec 'result' must be a plain string description, not a JSON Schema object.",
      );
    });

    it('falls back to output_spec alias when expected_outputs is absent', () => {
      const normalized = normalizeTaskParams({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        output_spec: { result: 'from output_spec' },
      });
      expect(normalized.outputSpec).toStrictEqual({
        result: 'from output_spec',
      });
    });

    it('resolves camelCase expectedOutputs', () => {
      const normalized = normalizeTaskParams({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        expectedOutputs: { result: 'camel' },
      });
      expect(normalized.outputSpec).toStrictEqual({ result: 'camel' });
    });

    it('resolves camelCase outputSpec alias', () => {
      const normalized = normalizeTaskParams({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        outputSpec: { result: 'camel legacy' },
      });
      expect(normalized.outputSpec).toStrictEqual({
        result: 'camel legacy',
      });
    });

    it('returns undefined when neither is provided', () => {
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

    it('throws when output_spec alias contains JSON-Schema-shaped values', () => {
      expect(() =>
        normalizeTaskParams({
          subagent_name: 'helper',
          goal_prompt: 'Do work',
          output_spec: {
            findings: { type: 'string', description: 'bad' },
          } as unknown as Record<string, string>,
        }),
      ).toThrow(
        "output_spec 'findings' must be a plain string description, not a JSON Schema object.",
      );
    });
  });

  describe('TaskTool schema', () => {
    function getSchemaProperties(
      tool: TaskTool,
    ): Record<string, { description?: string }> | undefined {
      const decl = tool.schema as unknown as {
        parametersJsonSchema?: {
          properties?: Record<string, { description?: string }>;
        };
      };
      return decl.parametersJsonSchema?.properties;
    }

    it('exposes expected_outputs as a schema property', () => {
      const tool = new TaskTool(config, {
        orchestratorFactory: () => ({}) as unknown as SubagentOrchestrator,
      });
      const prop = getSchemaProperties(tool)?.['expected_outputs'];
      expect(prop).toBeDefined();
      expect(prop?.description).toContain(
        'Values must be strings, not JSON Schema objects.',
      );
    });

    it('retains output_spec as a deprecated alias in the schema', () => {
      const tool = new TaskTool(config, {
        orchestratorFactory: () => ({}) as unknown as SubagentOrchestrator,
      });
      const prop = getSchemaProperties(tool)?.['output_spec'];
      expect(prop).toBeDefined();
      expect(prop?.description).toContain('Deprecated alias');
      expect(prop?.description).toContain(
        'Values must be strings, not JSON Schema objects.',
      );
    });
  });

  describe('TaskTool validateToolParamValues', () => {
    it('rejects JSON-Schema-shaped expected_outputs at schema validation time', () => {
      const tool = new TaskTool(config, {
        orchestratorFactory: () => ({}) as unknown as SubagentOrchestrator,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        expected_outputs: {
          findings: { type: 'string', description: 'bad' },
        } as unknown as Record<string, string>,
      };
      // The JSON Schema validator (additionalProperties: { type: "string" })
      // rejects non-string values before our custom validateOutputSpec runs.
      // The error message references the param path in the form
      // "expected_outputs/findings must be string".
      expect(() => tool.build(params)).toThrow(
        /expected_outputs\/findings must be string/,
      );
    });

    it('rejects JSON-Schema-shaped output_spec alias at schema validation time', () => {
      const tool = new TaskTool(config, {
        orchestratorFactory: () => ({}) as unknown as SubagentOrchestrator,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        output_spec: {
          findings: { type: 'string', description: 'bad' },
        } as unknown as Record<string, string>,
      };
      expect(() => tool.build(params)).toThrow(
        /output_spec\/findings must be string/,
      );
    });

    it('validateToolParamValues rejects non-string expected_outputs values that bypass schema', () => {
      const tool = new TaskTool(config, {
        orchestratorFactory: () => ({}) as unknown as SubagentOrchestrator,
      });
      // validateToolParamValues is a second line of defense for callers that
      // construct params programmatically and bypass schema validation.
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

    it('validateToolParamValues rejects non-string output_spec values that bypass schema', () => {
      const tool = new TaskTool(config, {
        orchestratorFactory: () => ({}) as unknown as SubagentOrchestrator,
      });
      const error = (
        tool as unknown as {
          validateToolParamValues: (p: TaskToolParams) => string | null;
        }
      ).validateToolParamValues({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        output_spec: {
          findings: { type: 'string', description: 'bad' },
        } as unknown as Record<string, string>,
      });
      expect(error).toContain(
        "output_spec 'findings' must be a plain string description",
      );
    });

    it('accepts valid string-valued expected_outputs', () => {
      const tool = new TaskTool(config, {
        orchestratorFactory: () => ({}) as unknown as SubagentOrchestrator,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        expected_outputs: { findings: 'A concise summary' },
      };
      const invocation = tool.build(params);
      expect(invocation.result).toBeUndefined();
    });

    it('accepts valid string-valued output_spec alias', () => {
      const tool = new TaskTool(config, {
        orchestratorFactory: () => ({}) as unknown as SubagentOrchestrator,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        output_spec: { findings: 'A concise summary' },
      };
      const invocation = tool.build(params);
      expect(invocation.result).toBeUndefined();
    });
  });

  describe('TaskTool end-to-end output config', () => {
    it('passes expected_outputs into launchRequest.outputConfig', async () => {
      const { launch, orchestrator } = createMockLaunch();
      const tool = new TaskTool(config, {
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

    it('passes output_spec alias into launchRequest.outputConfig', async () => {
      const { launch, orchestrator } = createMockLaunch();
      const tool = new TaskTool(config, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => true,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        output_spec: { result: 'The outcome' },
      });

      await invocation.execute(new AbortController().signal, undefined);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          outputConfig: { outputs: { result: 'The outcome' } },
        }),
        expect.any(AbortSignal),
      );
    });

    it('prefers expected_outputs over output_spec when both are provided at runtime', async () => {
      const { launch, orchestrator } = createMockLaunch();
      const tool = new TaskTool(config, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => true,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        expected_outputs: { result: 'preferred' },
        output_spec: { result: 'legacy' },
      });

      await invocation.execute(new AbortController().signal, undefined);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          outputConfig: { outputs: { result: 'preferred' } },
        }),
        expect.any(AbortSignal),
      );
    });
  });
});
