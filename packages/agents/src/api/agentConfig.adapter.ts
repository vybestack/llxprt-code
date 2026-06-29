/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @plan:PLAN-20260617-COREAPI.P14
 * @requirement:REQ-002
 */

import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentConfig } from './config-types.js';
import { CONFIG_FIELD_CLASSIFICATION } from './config-classification.js';

/**
 * Raised when a typed AgentConfig field is shadowed via the unstable
 * `settings` escape hatch, which would silently override a first-class field.
 * @pseudocode config-adapter.md step 84
 */
export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
    Object.setPrototypeOf(this, AdapterError.prototype);
  }
}

type ConfigParamsMut = {
  -readonly [K in keyof ConfigParameters]: ConfigParameters[K];
};

const TYPED_FIELD_SET: ReadonlySet<string> = new Set(
  CONFIG_FIELD_CLASSIFICATION.filter(
    (entry) => entry.classification === 'typed',
  ).map((entry) => entry.field),
);

/** Deep-clones a JSON-serializable value (records/arrays/scalars). */
function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A mapping rule: reads a config field and, when defined, writes one or more
 * params targets. `copy` copies the value verbatim; `clone` deep-clones it;
 * `spread` expands an array readonly tuple into a mutable array.
 */
type CopyKind = 'copy' | 'clone';

interface SimpleMapping {
  readonly configField: keyof AgentConfig;
  readonly paramField: keyof ConfigParameters;
  readonly kind: CopyKind;
}

/**
 * @pseudocode config-adapter.md steps 61-71: typed-field → ConfigParameters map.
 * Each entry maps an AgentConfig field to its ConfigParameters target. Only
 * fields whose target genuinely exists on ConfigParameters are present.
 * modelParams and streamIdleTimeoutMs drive runtime behavior (not a
 * ConfigParameters field), so they are absent.
 */
const SIMPLE_MAPPINGS: readonly SimpleMapping[] = [
  { configField: 'fileFiltering', paramField: 'fileFiltering', kind: 'clone' },
  { configField: 'telemetry', paramField: 'telemetry', kind: 'clone' },
  { configField: 'proxy', paramField: 'proxy', kind: 'copy' },
  {
    configField: 'maxSessionTurns',
    paramField: 'maxSessionTurns',
    kind: 'copy',
  },
  { configField: 'compression', paramField: 'chatCompression', kind: 'clone' },
  { configField: 'checkpointing', paramField: 'checkpointing', kind: 'copy' },
  { configField: 'outputFormat', paramField: 'outputFormat', kind: 'copy' },
  { configField: 'shell', paramField: 'shellReplacement', kind: 'copy' },
  { configField: 'contextLimit', paramField: 'contextLimit', kind: 'copy' },
  {
    configField: 'compressionThreshold',
    paramField: 'compressionThreshold',
    kind: 'copy',
  },
  { configField: 'useWriteTodos', paramField: 'useWriteTodos', kind: 'copy' },
  { configField: 'skillsSupport', paramField: 'skillsSupport', kind: 'copy' },
  {
    configField: 'adminSkillsEnabled',
    paramField: 'adminSkillsEnabled',
    kind: 'copy',
  },
  { configField: 'sandbox', paramField: 'sandbox', kind: 'copy' },
  { configField: 'embeddingModel', paramField: 'embeddingModel', kind: 'copy' },
  { configField: 'debugMode', paramField: 'debugMode', kind: 'copy' },
  {
    configField: 'continueOnFailedApiCall',
    paramField: 'continueOnFailedApiCall',
    kind: 'copy',
  },
  {
    configField: 'toolDiscoveryCommand',
    paramField: 'toolDiscoveryCommand',
    kind: 'copy',
  },
  {
    configField: 'toolCallCommand',
    paramField: 'toolCallCommand',
    kind: 'copy',
  },
  {
    configField: 'mcpServerCommand',
    paramField: 'mcpServerCommand',
    kind: 'copy',
  },
  { configField: 'mcpEnabled', paramField: 'mcpEnabled', kind: 'copy' },
  {
    configField: 'extensionsEnabled',
    paramField: 'extensionsEnabled',
    kind: 'copy',
  },
  { configField: 'interactive', paramField: 'interactive', kind: 'copy' },
];

/** Copies simple 1:1 typed fields onto params when defined on config. */
function applySimpleMappings(
  config: AgentConfig,
  params: ConfigParamsMut,
): void {
  const sink = params as Record<string, unknown>;
  for (const m of SIMPLE_MAPPINGS) {
    const value = config[m.configField];
    if (value === undefined) {
      continue;
    }
    sink[m.paramField] = m.kind === 'clone' ? clone(value) : value;
  }
}

/** Copies array-typed fields (readonly on AgentConfig → mutable on params). */
function applyArrayMappings(
  config: AgentConfig,
  params: ConfigParamsMut,
): void {
  if (config.includeDirectories !== undefined) {
    params.includeDirectories = [...config.includeDirectories];
  }
  if (config.tools !== undefined) {
    params.coreTools = [...config.tools];
  }
  if (config.excludeTools !== undefined) {
    params.excludeTools = [...config.excludeTools];
  }
  if (config.skills !== undefined) {
    params.skills = [...config.skills] as ConfigParameters['skills'];
  }
  if (config.allowedTools !== undefined) {
    params.allowedTools = [...config.allowedTools];
  }
  if (config.coreTools !== undefined) {
    params.coreTools = [...config.coreTools];
  }
  if (config.allowedMcpServers !== undefined) {
    params.allowedMcpServers = [...config.allowedMcpServers];
  }
  if (config.blockedMcpServers !== undefined) {
    params.blockedMcpServers = [...config.blockedMcpServers];
  }
  if (config.disabledHooks !== undefined) {
    params.disabledHooks = [...config.disabledHooks];
  }
  if (config.disabledSkills !== undefined) {
    params.disabledSkills = [...config.disabledSkills];
  }
}

/** Copies object/record fields with deep clone + readonly→mutable casts. */
function applyObjectMappings(
  config: AgentConfig,
  params: ConfigParamsMut,
): void {
  if (config.mcpServers !== undefined) {
    params.mcpServers = clone(
      config.mcpServers,
    ) as ConfigParameters['mcpServers'];
  }
  if (config.extensions !== undefined) {
    params.extensions = clone(
      config.extensions,
    ) as ConfigParameters['extensions'];
  }
  if (config.lsp !== undefined) {
    params.lsp = clone(config.lsp) as ConfigParameters['lsp'];
  }
  if (config.hooks !== undefined) {
    params.hooks = clone(config.hooks) as ConfigParameters['hooks'];
  }
  if (config.projectHooks !== undefined) {
    params.projectHooks = clone(
      config.projectHooks,
    ) as ConfigParameters['projectHooks'];
  }
}

/** Copies fields that map to multiple params targets or need bespoke logic. */
function applyCompoundMappings(
  config: AgentConfig,
  params: ConfigParamsMut,
): void {
  if (config.workingDir !== undefined) {
    params.cwd = config.workingDir;
    params.targetDir = config.workingDir;
  }
  if (config.sessionId !== undefined) {
    params.sessionId = config.sessionId;
  }
  // systemPrompt and memory both target userMemory; systemPrompt wins when
  // both are present (explicit, higher-precedence directive).
  if (config.systemPrompt !== undefined) {
    params.userMemory = config.systemPrompt;
  } else if (config.memory !== undefined) {
    params.userMemory = config.memory;
  }
  if (config.approvalMode !== undefined) {
    params.approvalMode = config.approvalMode;
  }
  if (config.policy !== undefined) {
    params.policyEngineConfig = config.policy;
  }
  if (config.folderTrust !== undefined) {
    params.folderTrust = config.folderTrust;
    params.trustedFolder = config.folderTrust;
  }
  applyIdeMapping(config, params);
  applyToolOutputLimitsMapping(config, params);
}

function applyIdeMapping(config: AgentConfig, params: ConfigParamsMut): void {
  if (config.ide === undefined) {
    return;
  }
  if (config.ide.mode !== undefined) {
    params.ideMode = config.ide.mode;
  }
  if (config.ide.experimentalZed !== undefined) {
    params.experimentalZedIntegration = config.ide.experimentalZed;
  }
}

function applyToolOutputLimitsMapping(
  config: AgentConfig,
  params: ConfigParamsMut,
): void {
  if (config.toolOutputLimits === undefined) {
    return;
  }
  const limits = config.toolOutputLimits;
  if (limits.truncateThreshold !== undefined) {
    params.truncateToolOutputThreshold = limits.truncateThreshold;
  }
  if (limits.truncateLines !== undefined) {
    params.truncateToolOutputLines = limits.truncateLines;
  }
  if (limits.enableTruncation !== undefined) {
    params.enableToolOutputTruncation = limits.enableTruncation;
  }
}

/**
 * Merges the UNSTABLE settings escape hatch, throwing if a key shadows a
 * typed AgentConfig field.
 * @pseudocode config-adapter.md steps 80-87
 */
function applySettings(config: AgentConfig, params: ConfigParamsMut): void {
  if (config.settings === undefined) {
    return;
  }
  const sink = params as Record<string, unknown>;
  for (const [k, v] of Object.entries(config.settings)) {
    if (TYPED_FIELD_SET.has(k)) {
      throw new AdapterError(
        'field ' + k + ' must be a typed AgentConfig field, not settings',
      );
    }
    sink[k] = v;
  }
}

/**
 * Translates a validated AgentConfig into an immutable ConfigParameters object
 * for `new Config(...)`. Builds a FRESH params object (never mutates input)
 * and freezes the result.
 * @pseudocode config-adapter.md steps 10-101: toConfigParameters
 */
export function toConfigParameters(
  config: AgentConfig,
): Readonly<ConfigParameters> {
  // @pseudocode config-adapter.md step 11: fresh, immutable build
  const params: ConfigParamsMut = {} as ConfigParamsMut;

  // @pseudocode config-adapter.md steps 20-23: required identity
  params.provider = config.provider;
  params.model = config.model;

  // @pseudocode config-adapter.md steps 30-71: typed field mappings
  applyCompoundMappings(config, params);
  applyArrayMappings(config, params);
  applyObjectMappings(config, params);
  applySimpleMappings(config, params);

  // @pseudocode config-adapter.md steps 80-87: UNSTABLE settings escape hatch
  applySettings(config, params);

  // @pseudocode config-adapter.md step 100: return frozen params
  return Object.freeze(params);
}
