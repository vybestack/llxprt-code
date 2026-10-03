/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { coreEvents } from '@vybestack/llxprt-code-core';
import type { HostFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';

export const agentMcpFeedback: HostFeedbackSink = (...args) =>
  coreEvents.emitFeedback(...args);
