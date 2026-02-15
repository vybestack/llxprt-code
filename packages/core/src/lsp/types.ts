/* @plan PLAN-20250212-LSP.P03 */

export type LspServerId = string;

export interface LspServerConfig {
  id: LspServerId;
  command: string;
  args?: string[];
  rootUri?: string;
}

export interface LspRequestEnvelope {
  serverId: LspServerId;
  method: string;
  params?: unknown;
}

export interface LspResponseEnvelope {
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface LspConfig {
  servers: LspServerConfig[];
  includeSeverities?: Array<'error' | 'warning' | 'info' | 'hint'>;
  maxDiagnosticsPerFile?: number;
  maxProjectDiagnosticsFiles?: number;
  diagnosticTimeout?: number;
  firstTouchTimeout?: number;
  navigationTools?: boolean;
}

export interface Diagnostic {
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source?: string;
  code?: string | number;
  line?: number;
  column?: number;
}

export interface ServerStatus {
  serverId: LspServerId;
  healthy: boolean;
  detail?: string;
  state?: 'ok' | 'broken' | 'starting';
  status?: string;
}
