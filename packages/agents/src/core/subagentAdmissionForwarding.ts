/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ChatSession } from './chatSession.js';
import type { ExecutionLoopContext } from './subagentExecution.js';
import {
  executeNonInteractiveRun,
  type NonInteractiveRunContext,
} from './subagentNonInteractive.js';

/**
 * Resolve the provider name, defaulting to 'backend' when the persisted
 * runtime state carries a nullish provider (the declared type lies for
 * deserialized configs). Mirrors the original `provider ?? 'backend'`
 * nullish fallback exactly: a defined value (including '') passes through.
 */
export function providerNameOrDefault(
  provider: string | null | undefined,
): string {
  if (provider === null || provider === undefined) {
    return 'backend';
  }
  return provider;
}

interface NonInteractiveAdmission {
  admit?: () => AdmittedModelParameters;
  prepare: () => Promise<{
    chat: ChatSession;
    abortController: AbortController;
    functionDeclarations: Parameters<typeof executeNonInteractiveRun>[1];
  } | null>;
  context: (
    modelParameters?: AdmittedModelParameters,
  ) => NonInteractiveRunContext;
  buildExecCtx: () => ExecutionLoopContext;
  initialMessages: () => IContent[];
  cleanup: () => void;
}

export async function forwardNonInteractiveAdmission(
  admission: NonInteractiveAdmission,
): Promise<void> {
  const modelParameters = admission.admit?.();
  const setup = await admission.prepare();
  if (!setup) return;
  const { chat, abortController, functionDeclarations } = setup;
  const context = admission.context(modelParameters);
  context.logger.debug(() => {
    const outputs = context.outputConfig
      ? Object.keys(context.outputConfig.outputs).join(', ')
      : 'none';
    return `Subagent ${context.subagentId} (${context.name}) starting run with toolCount=${functionDeclarations.length} requestedOutputs=${outputs} runConfig=${JSON.stringify(context.runConfig)}`;
  });
  await executeNonInteractiveRun(
    chat,
    functionDeclarations,
    abortController,
    admission.initialMessages(),
    Date.now(),
    admission.buildExecCtx(),
    context,
    admission.cleanup,
  );
}
