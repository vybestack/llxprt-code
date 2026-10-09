/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { StreamProcessor } from './StreamProcessor.js';
import { sourcePending } from './streamprocessor-source-fixture.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import {
  ChatSession,
  StreamEventType,
  type ChatSessionConfig,
  type SendMessageParams,
} from './chatSession.js';

/** The legacy generator argument is unused by the real neutral session route. */
export function loggingChatSession(
  runtime: AgentRuntimeContext,
  provider: RuntimeProvider,
  generation: ChatSessionConfig,
): ChatSession {
  runtime.provider.getActiveProvider = () => provider;
  const unused = async (): Promise<never> => {
    throw new Error('Unexpected legacy content generator invocation');
  };
  return new ChatSession(
    runtime,
    {
      generateContent: unused,
      generateContentStream: unused,
      countTokens: unused,
      embedContent: unused,
    },
    generation,
  );
}

export async function readLoggingChatStream(
  chat: ChatSession,
  params: SendMessageParams,
  promptId: string,
): Promise<string> {
  let output = '';
  for await (const event of await chat.sendMessageStream(params, promptId)) {
    if (event.type === StreamEventType.CHUNK) {
      output += event.value.content.blocks
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
    }
  }
  await chat.waitForIdle();
  return output;
}

export async function readLoggingProcessorStream(
  processor: StreamProcessor,
  params: SendMessageParams,
): Promise<string> {
  let output = '';
  const stream = await processor.makeApiCallAndProcessStream(
    params,
    'real-logging',
    sourcePending,
  );
  for await (const chunk of stream) {
    output += chunk.content.blocks
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
  }
  return output;
}
