/**
 * Test helpers extracted from useAgentEventStream.loopIntegration.test.tsx
 * to keep it under the max-lines lint limit.
 */

import {
  AgentEventType,
  DEFAULT_AGENT_ID,
  type ServerAgentStreamEvent,
  type ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core/core/turn.js';
import type { AgentRequestInput } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { iContentFromBlocks } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';

export interface ScriptedClientState {
  scriptQueue: ServerAgentStreamEvent[][];
  history: IContent[];
  turnMessages: AgentRequestInput[];
  recordedToolCalls: CompletedToolCall[][];
  sendMessageStreamCalls: AgentRequestInput[];
}

export function toolCallRequestEvent(
  name: string,
  callId: string,
  args: Record<string, unknown> = {},
): ServerAgentStreamEvent {
  const value: ToolCallRequestInfo = {
    callId,
    name,
    args,
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  return { type: AgentEventType.ToolCallRequest, value };
}

export function contentEvent(text: string): ServerAgentStreamEvent {
  return { type: AgentEventType.Content, value: text };
}

export function finishedEvent(): ServerAgentStreamEvent {
  return {
    type: AgentEventType.Finished,
    value: { reason: 'stop' },
  };
}

export function agentRequestInputToBlocks(
  req: AgentRequestInput,
): ContentBlock[] {
  if (typeof req === 'string') return [{ type: 'text', text: req }];
  if (Array.isArray(req)) {
    if (req.length > 0 && typeof req[0] === 'object' && 'blocks' in req[0]) {
      return (req as IContent[]).flatMap((c) => c.blocks);
    }
    return req as ContentBlock[];
  }
  return req.blocks;
}

function isIContentLike(req: unknown): req is IContent {
  if (typeof req !== 'object' || req === null || Array.isArray(req)) {
    return false;
  }
  return 'speaker' in req && 'blocks' in req;
}

export function agentRequestInputToIContent(req: AgentRequestInput): IContent {
  if (typeof req === 'string')
    return { speaker: 'human', blocks: [{ type: 'text', text: req }] };
  if (isIContentLike(req)) return req;
  if (Array.isArray(req)) {
    if (req.length > 0 && typeof req[0] === 'object' && 'blocks' in req[0]) {
      return req[0];
    }
    return iContentFromBlocks(req as ContentBlock[], 'human');
  }
  return iContentFromBlocks(agentRequestInputToBlocks(req), 'human');
}
