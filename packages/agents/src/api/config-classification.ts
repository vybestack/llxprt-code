/**
 * @plan:PLAN-20260617-COREAPI.P03
 * @requirement:REQ-002, REQ-017
 */

export type FieldClassification =
  | 'typed'
  | 'agent-sub-surface'
  | 'app-service'
  | 'settings-escape-hatch';

export interface ClassificationEntry {
  readonly field: string;
  readonly classification: FieldClassification;
  readonly rationale: string;
}

export const CONFIG_FIELD_CLASSIFICATION: readonly ClassificationEntry[] = [
  {
    field: 'provider',
    classification: 'typed',
    rationale: 'Maps directly to ConfigParameters.provider.',
  },
  {
    field: 'model',
    classification: 'typed',
    rationale: 'Maps directly to ConfigParameters.model.',
  },
  {
    field: 'modelParams',
    classification: 'typed',
    rationale:
      'Provider/model params consumed by the switch pipeline (REQ-004).',
  },
  {
    field: 'auth',
    classification: 'agent-sub-surface',
    rationale:
      'Resolved at runtime via the Agent.auth sub-surface (REQ-008 precedence); apiKey/keyfile/oauth are not ConfigParameters fields.',
  },
  {
    field: 'tools',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.coreTools.',
  },
  {
    field: 'excludeTools',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.excludeTools.',
  },
  {
    field: 'mcpServers',
    classification: 'typed',
    rationale:
      'Maps to ConfigParameters.mcpServers (Record<string, MCPServerConfig>).',
  },
  {
    field: 'approvalMode',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.approvalMode.',
  },
  {
    field: 'systemPrompt',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.userMemory via the adapter.',
  },
  {
    field: 'workingDir',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.cwd / targetDir.',
  },
  {
    field: 'sessionId',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.sessionId.',
  },
  {
    field: 'includeDirectories',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.includeDirectories.',
  },
  {
    field: 'fileFiltering',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.fileFiltering.',
  },
  {
    field: 'telemetry',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.telemetry.',
  },
  {
    field: 'proxy',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.proxy.',
  },
  {
    field: 'maxSessionTurns',
    classification: 'typed',
    rationale:
      'Maps to ConfigParameters.maxSessionTurns (terminal max-turns done).',
  },
  {
    field: 'compression',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.chatCompression.',
  },
  {
    field: 'checkpointing',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.checkpointing.',
  },
  {
    field: 'recording',
    classification: 'agent-sub-surface',
    rationale:
      'Session recording swap is owned by Agent.session sub-surface (REQ-010); not a ConfigParameters field.',
  },
  {
    field: 'policy',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.policyEngineConfig.',
  },
  {
    field: 'extensions',
    classification: 'typed',
    rationale:
      'Maps to ConfigParameters.extensions; settings must not shadow the typed extension seed.',
  },
  {
    field: 'ide',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.ideMode / experimentalZedIntegration.',
  },
  {
    field: 'hooks',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.hooks.',
  },
  {
    field: 'memory',
    classification: 'typed',
    rationale:
      'Maps to ConfigParameters.userMemory (LLXPRT.md / project memory).',
  },
  {
    field: 'streamIdleTimeoutMs',
    classification: 'typed',
    rationale: 'Drives the terminal idle-timeout stream event (REQ-003).',
  },
  {
    field: 'toolOutputLimits',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.truncateToolOutputThreshold/Lines.',
  },
  {
    field: 'outputFormat',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.outputFormat.',
  },
  {
    field: 'shell',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.shellReplacement.',
  },
  {
    field: 'contextLimit',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.contextLimit.',
  },
  {
    field: 'compressionThreshold',
    classification: 'typed',
    rationale:
      'Maps to ConfigParameters.compressionThreshold (automatic compression gate).',
  },
  {
    field: 'skillsSupport',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.skillsSupport.',
  },
  {
    field: 'disabledSkills',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.disabledSkills.',
  },
  {
    field: 'adminSkillsEnabled',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.adminSkillsEnabled.',
  },
  {
    field: 'skills',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.skills.',
  },
  {
    field: 'useWriteTodos',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.useWriteTodos.',
  },
  {
    field: 'sandbox',
    classification: 'typed',
    rationale:
      'Agent-instance config (T18e/REQ-002); maps to ConfigParameters.sandbox. Change requires recreate, not live mutation.',
  },
  {
    field: 'folderTrust',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.folderTrust / trustedFolder.',
  },
  {
    field: 'embeddingModel',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.embeddingModel.',
  },
  {
    field: 'debugMode',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.debugMode.',
  },
  {
    field: 'continueOnFailedApiCall',
    classification: 'typed',
    rationale:
      'Maps to ConfigParameters.continueOnFailedApiCall (retry/413 path).',
  },
  {
    field: 'allowedTools',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.allowedTools.',
  },
  {
    field: 'coreTools',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.coreTools (explicit tool allowlist).',
  },
  {
    field: 'toolDiscoveryCommand',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.toolDiscoveryCommand.',
  },
  {
    field: 'toolCallCommand',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.toolCallCommand.',
  },
  {
    field: 'mcpServerCommand',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.mcpServerCommand.',
  },
  {
    field: 'allowedMcpServers',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.allowedMcpServers.',
  },
  {
    field: 'blockedMcpServers',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.blockedMcpServers.',
  },
  {
    field: 'mcpEnabled',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.mcpEnabled.',
  },
  {
    field: 'extensionsEnabled',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.extensionsEnabled.',
  },
  {
    field: 'projectHooks',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.projectHooks.',
  },
  {
    field: 'disabledHooks',
    classification: 'typed',
    rationale: 'Maps to ConfigParameters.disabledHooks.',
  },
  {
    field: 'interactive',
    classification: 'typed',
    rationale:
      'Maps to ConfigParameters.interactive (controls coordinator throw scope).',
  },
  {
    field: 'lsp',
    classification: 'typed',
    rationale:
      'Maps to ConfigParameters.lsp for public Agent LSP status/control.',
  },
  {
    field: 'harness',
    classification: 'typed',
    rationale:
      'First-class createAgent harness seam gating; settings must not shadow typed public API fields.',
  },
  {
    field: 'onApproval',
    classification: 'agent-sub-surface',
    rationale:
      'Host callback wired into the AgenticLoop approvalHandler; never a ConfigParameters field.',
  },
  {
    field: 'onOAuthPrompt',
    classification: 'agent-sub-surface',
    rationale:
      'Host callback consumed by Agent.auth sub-surface for interactive OAuth; not a ConfigParameters field.',
  },
  {
    field: 'editorCallbacks',
    classification: 'agent-sub-surface',
    rationale:
      'Host callbacks wired to the scheduler/confirmation flow; not a ConfigParameters field.',
  },
  {
    field: 'toolSchedulerFactory',
    classification: 'agent-sub-surface',
    rationale:
      'Caller-owned factory (REQ-006). Scheduler instances it creates are Agent-owned and disposed by Agent.dispose(). Not a ConfigParameters field.',
  },
  {
    field: 'settings',
    classification: 'settings-escape-hatch',
    rationale:
      'UNSTABLE. Long-tail ConfigParameters entries merged by the adapter. Throws if a key shadows a typed AgentConfig field.',
  },
];

export function classifyConfigField(
  field: string,
): ClassificationEntry | undefined {
  return CONFIG_FIELD_CLASSIFICATION.find(
    (entry: ClassificationEntry): boolean => entry.field === field,
  );
}

export function classificationCountsByCategory(): Readonly<
  Record<FieldClassification, number>
> {
  const counts: Record<FieldClassification, number> = {
    typed: 0,
    'agent-sub-surface': 0,
    'app-service': 0,
    'settings-escape-hatch': 0,
  };
  for (const entry of CONFIG_FIELD_CLASSIFICATION) {
    counts[entry.classification] += 1;
  }
  return counts;
}
