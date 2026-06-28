/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FunctionCall } from '@google/genai';
import {
  ToolConfirmationOutcome,
  type IToolMessageBus,
  type PolicyUpdateOptions,
  type ToolMessageHandler,
  type Unsubscribe,
} from '@vybestack/llxprt-code-tools';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type MessageBusMessage,
  type ToolConfirmationResponse,
} from '../confirmation-bus/types.js';

interface ToolConfirmationDetails {
  toolName?: unknown;
  name?: unknown;
  args?: unknown;
  serverName?: unknown;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function recordFromObject(
  value: unknown,
  fallback?: Record<string, unknown>,
): Record<string, unknown> {
  return isPlainRecord(value) ? { ...value } : (fallback ?? {});
}

function isAbortSignalAborted(abortSignal?: AbortSignal): boolean {
  return abortSignal?.aborted === true;
}

function getConfirmationToolName(details: ToolConfirmationDetails): string {
  if (typeof details.toolName === 'string') {
    return details.toolName;
  }
  if (typeof details.name === 'string') {
    return details.name;
  }
  return 'unknown';
}

export class CoreMessageBusAdapter implements IToolMessageBus {
  constructor(private readonly messageBus: MessageBus) {}

  async requestConfirmation(
    rawDetails: unknown,
    abortSignal?: AbortSignal,
  ): Promise<ToolConfirmationOutcome> {
    const details = isPlainRecord(rawDetails) ? rawDetails : {};
    const confirmationDetails: ToolConfirmationDetails = details;
    const toolName = getConfirmationToolName(confirmationDetails);
    const toolArgs = recordFromObject(confirmationDetails.args, details);
    const serverName =
      typeof confirmationDetails.serverName === 'string'
        ? confirmationDetails.serverName
        : undefined;

    if (isAbortSignalAborted(abortSignal)) {
      return ToolConfirmationOutcome.Cancel;
    }

    const toolCall: FunctionCall = {
      name: toolName,
      args: toolArgs,
    };

    const confirmed = await this.messageBus.requestConfirmation(
      toolCall,
      toolArgs,
      serverName,
    );

    if (isAbortSignalAborted(abortSignal)) {
      return ToolConfirmationOutcome.Cancel;
    }

    return confirmed
      ? ToolConfirmationOutcome.ProceedOnce
      : ToolConfirmationOutcome.Cancel;
  }

  async publishPolicyUpdate(
    outcome: ToolConfirmationOutcome,
    options?: PolicyUpdateOptions,
  ): Promise<void> {
    const policyOptions = options as
      | (PolicyUpdateOptions & {
          toolName?: string;
          commandPrefix?: string | string[];
          mcpName?: string;
        })
      | undefined;

    if (!policyOptions?.toolName) {
      return;
    }

    this.messageBus.publish({
      type: MessageBusType.UPDATE_POLICY,
      toolName: policyOptions.toolName,
      persist:
        policyOptions.persist ??
        outcome === ToolConfirmationOutcome.ProceedAlwaysAndSave,
      commandPrefix: policyOptions.commandPrefix,
      mcpName: policyOptions.mcpName,
    });
  }

  subscribe(handler: ToolMessageHandler): Unsubscribe {
    const wrappedHandler = (message: MessageBusMessage) => {
      void handler({ type: message.type, payload: message });
    };

    const unsubscribers = Object.values(MessageBusType).map((type) =>
      this.messageBus.subscribe(type, wrappedHandler),
    );

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }

  subscribeToConfirmationResponses(
    handler: (message: ToolConfirmationResponse) => void,
  ): Unsubscribe {
    return this.messageBus.subscribe(
      MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      handler,
    );
  }
}
