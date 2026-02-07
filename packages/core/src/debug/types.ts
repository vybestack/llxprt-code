/**
 * @plan PLAN-20250120-DEBUGLOGGING.P03
 * @requirement REQ-001
 */
export interface DebugOutputConfig {
  target: string;
  directory?: string;
}

export interface DebugSettings {
  enabled: boolean;
  namespaces: string[] | Record<string, unknown>;
  level: string;
  output: DebugOutputConfig | string;
  lazyEvaluation: boolean;
  redactPatterns: string[];
}

export interface LogEntry {
  timestamp: string;
  namespace: string;
  level: string;
  message: string;
  args?: unknown[];
  runId: string;
  pid: number;
}
