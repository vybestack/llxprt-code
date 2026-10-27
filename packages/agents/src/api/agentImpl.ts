/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from './agent.js';
import { buildAgentResult, drainToResult } from './agentBootstrap.js';
import type { AgentProviderFileOperations } from './provider-file-domain.js';

type ConversationOperations = Pick<
  Agent,
  | 'getHistory'
  | 'setHistory'
  | 'addHistory'
  | 'restoreHistory'
  | 'updateSystemInstruction'
  | 'addDirectoryContext'
  | 'getCurrentSequenceModel'
>;
type FacadeConvenienceOperations = Pick<
  Agent,
  | 'chat'
  | 'listTools'
  | 'getRuntimeId'
  | 'getEphemeralSetting'
  | 'setEphemeralSetting'
  | 'getEphemeralSettings'
  | 'setModelParam'
  | 'clearModelParam'
>;

export type AgentFacadeComposition = Omit<
  Agent,
  | keyof ConversationOperations
  | keyof AgentProviderFileOperations
  | keyof FacadeConvenienceOperations
> & {
  readonly conversation: ConversationOperations;
  readonly runtimeId: string;
};

class AgentImpl {
  constructor(
    private readonly operations: {
      readonly stream: Agent['stream'];
      readonly listTools: Agent['tools']['list'];
      readonly runtimeId: string;
    },
  ) {}

  readonly getRuntimeId = (): string => this.operations.runtimeId;
  readonly listTools: Agent['listTools'] = () => [
    ...this.operations.listTools(),
  ];

  async chat(
    input: Parameters<Agent['chat']>[0],
    options?: Parameters<Agent['chat']>[1],
  ): ReturnType<Agent['chat']> {
    return buildAgentResult(
      await drainToResult(this.operations.stream(input, options)),
    );
  }
}

export function createAgentFacade(
  providerFiles: AgentProviderFileOperations,
  composition: AgentFacadeComposition,
): Agent {
  const { conversation, runtimeId, ...operations } = composition;
  return Object.assign(
    new AgentImpl({
      stream: operations.stream,
      listTools: () => operations.tools.list(),
      runtimeId,
    }),
    operations,
    conversation,
    providerFiles,
    {
      getEphemeralSetting: operations.settings.getEphemeralSetting,
      setEphemeralSetting: operations.settings.setEphemeralSetting,
      getEphemeralSettings: operations.settings.getEphemeralSettings,
      setModelParam: operations.modelParameters.set,
      clearModelParam: operations.modelParameters.clear,
    },
  );
}
