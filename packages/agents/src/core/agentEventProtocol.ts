/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentEventType as CoreAgentEventType } from '@vybestack/llxprt-code-core/core/turn.js';

export {
  AgentEventType,
  DEFAULT_AGENT_ID,
} from '../../../core/src/core/turn.js';
export type {
  ModelInfo,
  ServerAgentStreamEvent,
  ServerFinishedOutcome,
} from '@vybestack/llxprt-code-core/core/turn.js';

export const MODEL_INFO_EVENT_TYPE =
  'model_info' as CoreAgentEventType.ModelInfo;
export const MAX_SESSION_TURNS_EVENT_TYPE =
  'max_session_turns' as CoreAgentEventType.MaxSessionTurns;
export const STREAM_IDLE_TIMEOUT_EVENT_TYPE =
  'stream_idle_timeout' as CoreAgentEventType.StreamIdleTimeout;
export const ERROR_EVENT_TYPE = 'error' as CoreAgentEventType.Error;
export const USER_CANCELLED_EVENT_TYPE =
  'user_cancelled' as CoreAgentEventType.UserCancelled;
