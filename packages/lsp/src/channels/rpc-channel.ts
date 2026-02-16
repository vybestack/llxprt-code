/**
 * @plan:PLAN-20250212-LSP.P22
 * @requirement REQ-ARCH-020
 * @requirement REQ-ARCH-070
 * @requirement REQ-ARCH-080
 * @pseudocode rpc-channel.md lines 10-67
 */

import type { MessageConnection } from 'vscode-jsonrpc';

import type { Orchestrator } from '../service/orchestrator.js';

type CheckFileParams = {
  filePath: string;
  text?: string;
};

export function setupRpcChannel(
  connection: MessageConnection,
  orchestrator: Orchestrator,
): void {
  connection.onRequest('lsp/checkFile', async (params: CheckFileParams) => {
    try {
      return await orchestrator.checkFile(params.filePath, params.text);
    } catch {
      return [];
    }
  });

  connection.onRequest('lsp/diagnostics', async () => {
    try {
      const diagnostics = await orchestrator.getAllDiagnostics();
      const sortedEntries = Object.entries(diagnostics).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      return Object.fromEntries(sortedEntries);
    } catch {
      return {};
    }
  });

  connection.onRequest('lsp/status', async () => {
    try {
      return await orchestrator.status();
    } catch {
      return [];
    }
  });

  connection.onRequest('lsp/shutdown', async () => {
    try {
      await orchestrator.shutdown();
    } catch {}
    return null;
  });
}
