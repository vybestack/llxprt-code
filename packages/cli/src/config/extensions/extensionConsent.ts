import type { MCPServerConfig } from '@vybestack/llxprt-code-core';
import { escapeAnsiCtrlCodes } from '../../ui/utils/textUtils.js';
import type { ExtensionConfig } from '../extension.js';
import { computeHookConsentDelta, requestHookConsent } from './consent.js';

function buildMcpServerSource(
  mcpServer: MCPServerConfig,
  hasCommand: boolean,
): string {
  if (hasCommand) {
    const command = mcpServer.command ?? '';
    const hasArgs = Array.isArray(mcpServer.args) && mcpServer.args.length > 0;
    const args = hasArgs ? ' ' + mcpServer.args.join(' ') : '';
    return `${command}${args}`;
  }
  if (mcpServer.url != null) {
    return mcpServer.url;
  }
  return 'unknown';
}

function extensionConsentString(extensionConfig: ExtensionConfig): string {
  const sanitizedConfig = escapeAnsiCtrlCodes(extensionConfig);
  const output: string[] = [];
  const mcpServerEntries = Object.entries(sanitizedConfig.mcpServers ?? {});
  output.push(`Installing extension "${sanitizedConfig.name}".`);
  output.push(
    '**Extensions may introduce unexpected behavior. Ensure you have investigated the extension source and trust the author.**',
  );

  if (mcpServerEntries.length > 0) {
    output.push('This extension will run the following MCP servers:');
    for (const [key, mcpServer] of mcpServerEntries) {
      const hasCommand =
        typeof mcpServer.command === 'string' && mcpServer.command.length > 0;
      const isLocal = hasCommand;
      const source =
        mcpServer.httpUrl ?? buildMcpServerSource(mcpServer, hasCommand);
      output.push(`  * ${key} (${isLocal ? 'local' : 'remote'}): ${source}`);
    }
  }
  if (
    sanitizedConfig.hooks != null &&
    Object.keys(sanitizedConfig.hooks).length > 0
  ) {
    output.push(
      `This extension will register hooks: ${Object.keys(sanitizedConfig.hooks).join(', ')}`,
    );
    output.push(
      'Note: Hooks can intercept and modify LLxprt Code behavior. Additional consent will be requested.',
    );
  }
  const contextFileName = sanitizedConfig.contextFileName;
  const hasContextFileName = Array.isArray(contextFileName)
    ? contextFileName.length > 0
    : typeof contextFileName === 'string' && contextFileName.length > 0;
  if (hasContextFileName) {
    output.push(
      `This extension will append info to your LLXPRT.md context using ${contextFileName}`,
    );
  }
  const excludeTools = sanitizedConfig.excludeTools;
  if (Array.isArray(excludeTools) && excludeTools.length > 0) {
    output.push(
      `This extension will exclude the following core tools: ${excludeTools}`,
    );
  }
  return output.join('\n');
}

export async function maybeRequestConsentOrFail(
  extensionConfig: ExtensionConfig,
  requestConsent: (consent: string) => Promise<boolean>,
  previousExtensionConfig?: ExtensionConfig,
): Promise<void> {
  const extensionConsent = extensionConsentString(extensionConfig);
  if (previousExtensionConfig) {
    const previousExtensionConsent = extensionConsentString(
      previousExtensionConfig,
    );
    if (previousExtensionConsent === extensionConsent) {
      const hookDelta = computeHookConsentDelta(
        extensionConfig.hooks,
        previousExtensionConfig.hooks,
      );
      if (
        hookDelta.newHooks.length === 0 &&
        hookDelta.changedHooks.length === 0
      ) {
        return;
      }
    }
  }
  if (!(await requestConsent(extensionConsent))) {
    throw new Error(`Installation cancelled for "${extensionConfig.name}".`);
  }

  const hookDelta = computeHookConsentDelta(
    extensionConfig.hooks,
    previousExtensionConfig?.hooks,
  );
  if (hookDelta.newHooks.length > 0 || hookDelta.changedHooks.length > 0) {
    const hooksRequiringConsent = [
      ...hookDelta.newHooks,
      ...hookDelta.changedHooks,
    ];
    const hookConsent = await requestHookConsent(
      extensionConfig.name,
      hooksRequiringConsent,
      requestConsent,
    );
    if (!hookConsent) {
      throw new Error(
        `Hook registration declined for extension "${extensionConfig.name}". Installation cancelled.`,
      );
    }
  }
}
