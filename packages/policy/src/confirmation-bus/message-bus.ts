import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { PolicyEngine } from '../policy-engine.js';
import { PolicyDecision } from '../types.js';
import {
  ConfirmationOutcome,
  MessageBusType,
  type BucketAuthConfirmationResponse,
  type ConfirmationPayload,
  type MessageBusMessage,
  type PolicyFunctionCall,
  type ToolConfirmationResponse,
} from './types.js';

type MessageHandler<T extends MessageBusMessage = MessageBusMessage> = (
  message: T,
) => void;

export interface PolicyLogger {
  log: (message: string, ...args: unknown[]) => void;
  warn?: (message: string, ...args: unknown[]) => void;
  error?: (message: string, ...args: unknown[]) => void;
}

/**
 * MessageBus provides event-driven communication for tool confirmations and policy decisions.
 * Uses EventEmitter for pub/sub pattern and integrates with PolicyEngine for authorization.
 */
export class MessageBus {
  private readonly emitter: EventEmitter;
  private readonly policyEngine: PolicyEngine;
  private readonly debugMode: boolean;
  private readonly logger?: PolicyLogger;

  constructor(
    policyEngine?: PolicyEngine,
    debugMode = false,
    logger?: PolicyLogger,
  ) {
    this.emitter = new EventEmitter();
    this.policyEngine = policyEngine ?? new PolicyEngine();
    this.debugMode = debugMode;
    this.logger = logger;

    this.emitter.setMaxListeners(50);
  }

  publish(message: MessageBusMessage): void {
    if (this.debugMode) {
      this.logger?.log(`[MessageBus] Publishing: ${message.type}`, message);
    }

    this.emitter.emit(message.type, message);
  }

  subscribe<T extends MessageBusMessage>(
    type: MessageBusType,
    handler: MessageHandler<T>,
  ): () => void {
    this.emitter.on(type, handler as MessageHandler);

    return () => {
      this.emitter.off(type, handler as MessageHandler);
    };
  }

  unsubscribe<T extends MessageBusMessage>(
    type: MessageBusType,
    handler: MessageHandler<T>,
  ): void {
    this.emitter.off(type, handler as MessageHandler);
  }

  async requestConfirmation(
    toolCall: PolicyFunctionCall,
    args: Record<string, unknown>,
    serverName?: string,
  ): Promise<boolean> {
    const correlationId = randomUUID();

    if (!toolCall.name) {
      throw new Error('Tool call must have a name');
    }

    const decision = this.policyEngine.evaluate(
      toolCall.name,
      args,
      serverName,
    );

    if (this.debugMode) {
      this.logger?.log(
        `[MessageBus] Policy decision for ${toolCall.name}: ${decision}`,
      );
    }

    if (decision === PolicyDecision.ALLOW) {
      return true;
    }

    if (decision === PolicyDecision.DENY) {
      this.publish({
        type: MessageBusType.TOOL_POLICY_REJECTION,
        toolCall,
        correlationId,
        reason: 'Policy denied execution',
        serverName,
      });
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, 300000);

      const unsubscribe = this.subscribe<ToolConfirmationResponse>(
        MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        (response) => {
          if (response.correlationId === correlationId) {
            clearTimeout(timeout);
            unsubscribe();
            let resolvedConfirmation: boolean;
            if (response.outcome !== undefined) {
              const isCancel = response.outcome === ConfirmationOutcome.Cancel;
              const isModify =
                response.outcome === ConfirmationOutcome.ModifyWithEditor;
              const isSuggest =
                response.outcome === ConfirmationOutcome.SuggestEdit;
              resolvedConfirmation = !isCancel && !isModify && !isSuggest;
            } else if (response.confirmed !== undefined) {
              resolvedConfirmation = response.confirmed;
            } else {
              resolvedConfirmation = false;
            }
            resolve(resolvedConfirmation);
          }
        },
      );

      this.publish({
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        toolCall,
        correlationId,
        serverName,
      });
    });
  }

  respondToConfirmation(
    correlationId: string,
    outcome: ConfirmationOutcome,
    payload?: ConfirmationPayload,
    requiresUserConfirmation?: boolean,
  ): void {
    const confirmed =
      outcome !== ConfirmationOutcome.Cancel &&
      outcome !== ConfirmationOutcome.ModifyWithEditor &&
      outcome !== ConfirmationOutcome.SuggestEdit;
    this.publish({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      outcome,
      payload,
      confirmed,
      requiresUserConfirmation,
    });
  }

  async requestBucketAuthConfirmation(
    provider: string,
    bucket: string,
    bucketIndex: number,
    totalBuckets: number,
  ): Promise<boolean> {
    const correlationId = randomUUID();

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, 300000);

      const unsubscribe = this.subscribe<BucketAuthConfirmationResponse>(
        MessageBusType.BUCKET_AUTH_CONFIRMATION_RESPONSE,
        (response) => {
          if (response.correlationId === correlationId) {
            clearTimeout(timeout);
            unsubscribe();
            resolve(response.confirmed);
          }
        },
      );

      this.publish({
        type: MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST,
        correlationId,
        provider,
        bucket,
        bucketIndex,
        totalBuckets,
      });
    });
  }

  respondToBucketAuthConfirmation(
    correlationId: string,
    confirmed: boolean,
  ): void {
    this.publish({
      type: MessageBusType.BUCKET_AUTH_CONFIRMATION_RESPONSE,
      correlationId,
      confirmed,
    });
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  listenerCount(type: MessageBusType): number {
    return this.emitter.listenerCount(type);
  }
}
