/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { StreamProcessorRuntime } from './chatSessionPorts.js';
import { prepareHistoryUserInput } from './streamResponseHelpers.js';

export async function submitUserPrompt(
  runtime: Pick<StreamProcessorRuntime, 'history' | 'state'>,
  input: IContent | IContent[],
  submissionId: string,
  eager: ReadonlySet<string>,
  origin?: object,
): Promise<void> {
  const { historyUserInput } = prepareHistoryUserInput(input, eager);
  const rows = Array.isArray(historyUserInput)
    ? historyUserInput
    : [historyUserInput];
  await runtime.history.submitPrompt(
    submissionId,
    rows,
    runtime.state.model,
    origin,
  );
}
