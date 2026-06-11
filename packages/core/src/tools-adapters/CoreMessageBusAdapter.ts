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
  type ToolMessageEvent,
  type ToolMessageHandler,
  type Unsubscribe,
} from '@vybestack/llxprt-code-tools';
import { MessageBus } from '../confirmation-bus/message-bus.js';
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

export class CoreMessageBusAdapter implements IToolMessageBus {
  constructor(private readonly messageBus: MessageBus) {}

  async requestConfirmation(
    details: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<ToolConfirmationOutcome> {
    const confirmationDetails = details as ToolConfirmationDetails;
    const toolName =
      typeof confirmationDetails.toolName === 'string'
        ? confirmationDetails.toolName
        : typeof confirmationDetails.name === 'string'
          ? confirmationDetails.name
          : 'unknown';
    const args =
      confirmationDetails.args !== null &&
      typeof confirmationDetails.args === 'object' &&
      !Array.isArray(confirmationDetails.args)
        ? (confirmationDetails.args as Record<string, unknown>)
        : details;
    const serverName =
      typeof confirmationDetails.serverName === 'string'
        ? confirmationDetails.serverName
        : undefined;

    if (abortSignal?.aborted) {
      return ToolConfirmationOutcome.Cancel;
    }

    const toolCall: FunctionCall = {
      name: toolName,
      args,
    };

    const confirmed = await this.messageBus.requestConfirmation(
      toolCall,
      args,
      serverName,
    );

    if (abortSignal?.aborted) {
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
      void handler(message as unknown as ToolMessageEvent);
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
