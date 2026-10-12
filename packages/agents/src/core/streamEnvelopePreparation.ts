/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import { preparePromptEnvelopeAfterEnforcement } from './promptEnvelopeSendSeam.js';

type BuildOptions = Parameters<
  typeof preparePromptEnvelopeAfterEnforcement
>[0]['buildOptions'];

export function prepareStreamEnvelope(
  provider: RuntimeProvider,
  contents: IContent[],
  pendingContents: IContent[] | undefined,
  buildOptions: BuildOptions,
  compressionHandler: CompressionHandler,
  promptId: string,
  recordingExecution?: AgentChatRecordingExecution,
  modelParameters?: AdmittedModelParameters,
  tokenizerFactory?: Pick<
    RuntimeTokenizerFactory,
    'estimatePrompt' | 'claimsModel' | 'getEstimatorFamily'
  >,
): ReturnType<typeof preparePromptEnvelopeAfterEnforcement> {
  return preparePromptEnvelopeAfterEnforcement({
    provider,
    contents,
    buildOptions,
    tokenizerFactory,
    enforce: (contents, estimate) =>
      compressionHandler.enforceProviderContents(
        { contents, pendingContents },
        promptId,
        provider,
        estimate,
        recordingExecution?.transcriptPath,
        recordingExecution?.historyOrigin,
        recordingExecution?.hookOwner,
        modelParameters,
      ),
    fallbackEstimate: (contents) =>
      compressionHandler.estimatePendingTokens(contents),
  });
}
