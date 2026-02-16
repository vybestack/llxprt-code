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
