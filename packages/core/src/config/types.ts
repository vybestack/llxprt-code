/**
 * Subagent configuration stored in <subagentsDir>/<name>.json
 * (the configured subagents directory under the LLxprt config dir).
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
 * @requirement:REQ-001
 * @requirement:REQ-012
 */
export interface SubagentConfig {
  /** Subagent identifier (matches filename without .json) */
  name: string;

  /** Reference to a saved profile name (profiles live in the LLxprt config dir) */
  profile: string;

  /** System prompt text for this subagent */
  systemPrompt: string;

  /** ISO 8601 timestamp when subagent was created */
  createdAt: string;

  /** ISO 8601 timestamp when subagent was last updated */
  updatedAt: string;

  /** Provenance: 'user' (default, disk-backed), 'extension', or 'settings' */
  source?: 'user' | 'extension' | 'settings';

  /** Extension name if source === 'extension' */
  sourceExtension?: string;
}

// _ = SubagentConfig; // Ensure the interface is considered "used" by the compiler
