/**
 * Subagent configuration stored in ~/.llxprt/subagents/<name>.json
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
 * @requirement:REQ-001, REQ-012
 */
export interface SubagentConfig {
  /** Subagent identifier (matches filename without .json) */
  name: string;
  
  /** Reference to profile name in ~/.llxprt/profiles/ */
  profile: string;
  
  /** System prompt text for this subagent */
  systemPrompt: string;
  
  /** ISO 8601 timestamp when subagent was created */
  createdAt: string;
  
  /** ISO 8601 timestamp when subagent was last updated */
  updatedAt: string;
}

// _ = SubagentConfig; // Ensure the interface is considered "used" by the compiler