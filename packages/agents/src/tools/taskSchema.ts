/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Model-facing schema: only snake_case properties are exposed to the LLM.
// camelCase aliases (subagentName, expectedOutputs, etc.) exist in
// TaskToolParams for programmatic callers but are intentionally excluded
// from the schema — additionalProperties: false enforces this.
export const taskToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subagent_name', 'goal_prompt'],
  properties: {
    subagent_name: {
      type: 'string',
      description:
        'Name of the registered subagent to launch. Use the list_subagents tool to discover available subagents (defined via user config, settings, or extensions).',
    },
    goal_prompt: {
      type: 'string',
      description:
        'Primary goal or prompt to pass to the subagent. Included as the first behavioural prompt.',
    },
    behaviour_prompts: {
      type: 'array',
      description:
        'Additional behavioural prompts to append after the goal prompt.',
      items: { type: 'string' },
    },
    tool_whitelist: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Restrict the subagent to this explicit list of tools. Tool names must match the registry.',
    },
    expected_outputs: {
      type: 'object',
      description:
        'Map each output variable name to a plain string description. Values must be strings, not JSON Schema objects.',
      additionalProperties: { type: 'string' },
    },
    output_spec: {
      type: 'object',
      description:
        'Deprecated alias for expected_outputs. Map each output variable name to a plain string description. Values must be strings, not JSON Schema objects.',
      additionalProperties: { type: 'string' },
    },
    timeout_seconds: {
      type: 'number',
      description:
        'Optional maximum time the subagent may run, in seconds. ' +
        'Allowed values are -1 or a finite number of seconds greater than ' +
        'zero (0 and any other non-positive value is rejected). ' +
        'Precedence: this explicit value, then the task-default-timeout-seconds ' +
        'setting, bounded upward by the task-max-timeout-seconds setting (both are ' +
        'overridable ephemeral settings, so do not assume fixed numbers). A short ' +
        'positive request is honoured exactly — short runs are legitimate (racing ' +
        'subagents, self-imposed deadlines). -1 means "as long as the configured ' +
        'maximum allows" — it resolves to the maximum and is NOT unbounded unless ' +
        'the maximum itself is -1. A request above the maximum (or a request of -1 ' +
        'under a finite maximum) is clamped to the maximum, and the result will ' +
        'state that clamping occurred. Give long-running work (full-suite ' +
        'verification, code review, multi-file implementation) an explicit timeout ' +
        'rather than relying on the default, because such work routinely outlives it.',
    },
    grace_period_seconds: {
      type: 'number',
      description:
        'Optional grace period in seconds for recovery after a termination condition (TIMEOUT, MAX_TURNS, or protocol violation). Falls back to 60s if not specified or invalid.',
    },
    max_turns: {
      type: 'number',
      description:
        'Maximum turns for the subagent. -1 means unlimited (no turn cap). A positive integer caps the run. ' +
        'Precedence is: explicit task max_turns > selected subagent profile maxTurnsPerPrompt > ' +
        'current foreground maxTurnsPerPrompt > fallback of 1000 turns. Only the task, profile, and foreground ' +
        'layers accept -1 for unlimited; the 1000-turn fallback is a fixed constant that does not interpret -1.',
    },
    async: {
      type: 'boolean',
      description:
        'If true, launch subagent in background and return immediately. Default: false.',
    },
    context: {
      type: 'object',
      description:
        'Optional key/value pairs exposed to the subagent via the execution context.',
      additionalProperties: true,
    },
  },
} as const;
