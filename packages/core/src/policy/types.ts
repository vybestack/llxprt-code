export enum PolicyDecision {
  ALLOW = 'allow',
  DENY = 'deny',
  ASK_USER = 'ask_user',
}

export interface PolicyRule {
  toolName?: string; // undefined = wildcard (all tools)
  argsPattern?: RegExp; // Pattern to match against stable-stringified args
  decision: PolicyDecision;
  priority?: number; // Higher wins, default 0
}

export interface PolicyEngineConfig {
  rules?: PolicyRule[];
  defaultDecision?: PolicyDecision;
  nonInteractive?: boolean; // ASK_USER → DENY when true
}
