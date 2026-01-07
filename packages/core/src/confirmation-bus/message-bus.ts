import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { FunctionCall } from '@google/genai';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyDecision } from '../policy/types.js';
import {
  MessageBusType,
  type MessageBusMessage,
  type ToolConfirmationResponse,
  type BucketAuthConfirmationResponse,
} from './types.js';
import {
  ToolConfirmationOutcome,
  type ToolConfirmationPayload,
} from '../tools/tool-confirmation-types.js';

type MessageHandler<T extends MessageBusMessage = MessageBusMessage> = (
  message: T,
) => void;

/**
 * MessageBus provides event-driven communication for tool confirmations and policy decisions.
 * Uses EventEmitter for pub/sub pattern and integrates with PolicyEngine for authorization.
 */
export class MessageBus {
  private readonly emitter: EventEmitter;
  private readonly policyEngine: PolicyEngine;
  private readonly debugMode: boolean;

  constructor(policyEngine: PolicyEngine, debugMode = false) {
    this.emitter = new EventEmitter();
    this.policyEngine = policyEngine;
    this.debugMode = debugMode;

    // Increase max listeners to prevent warnings in complex flows
    this.emitter.setMaxListeners(50);
  }

  /**
   * Publishes a message to all subscribers of the message type.
   *
   * @param message - The message to publish
   */
  publish(message: MessageBusMessage): void {
    if (this.debugMode) {
      console.log(`[MessageBus] Publishing: ${message.type}`, message);
    }

    this.emitter.emit(message.type, message);
  }

  /**
   * Subscribes to messages of a specific type.
   *
   * @param type - The message type to subscribe to
   * @param handler - The handler function to call when a message is received
   * @returns Unsubscribe function
   */
  subscribe<T extends MessageBusMessage>(
    type: MessageBusType,
    handler: MessageHandler<T>,
  ): () => void {
    this.emitter.on(type, handler as MessageHandler);

    return () => {
      this.emitter.off(type, handler as MessageHandler);
    };
  }

  /**
   * Unsubscribes from messages of a specific type.
   *
   * @param type - The message type to unsubscribe from
   * @param handler - The handler function to remove
   */
  unsubscribe<T extends MessageBusMessage>(
    type: MessageBusType,
    handler: MessageHandler<T>,
  ): void {
    this.emitter.off(type, handler as MessageHandler);
  }

  /**
   * Requests confirmation for a tool execution through the policy engine.
   * If policy allows, returns immediately. If policy asks user, publishes confirmation request.
   *
   * @param toolCall - The tool call to evaluate
   * @param args - The tool arguments
   * @param serverName - Optional MCP server name
   * @returns Promise<boolean> - true if approved, false if denied
   */
  async requestConfirmation(
    toolCall: FunctionCall,
    args: Record<string, unknown>,
    serverName?: string,
  ): Promise<boolean> {
    const correlationId = randomUUID();

    // Tool name is required
    if (!toolCall.name) {
      throw new Error('Tool call must have a name');
    }

    // Evaluate policy
    const decision = this.policyEngine.evaluate(
      toolCall.name,
      args,
      serverName,
    );

    if (this.debugMode) {
      console.log(
        `[MessageBus] Policy decision for ${toolCall.name}: ${decision}`,
      );
    }

    // Handle immediate decisions
    if (decision === PolicyDecision.ALLOW) {
      return true;
    }

    if (decision === PolicyDecision.DENY) {
      this.publish({
        type: MessageBusType.TOOL_POLICY_REJECTION,
        toolCall,
        correlationId,
        reason: 'Policy denied execution',
      });
      return false;
    }

    // ASK_USER - wait for confirmation response
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve(false); // Timeout = deny
      }, 300000); // 5 minute timeout

      const unsubscribe = this.subscribe<ToolConfirmationResponse>(
        MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        (response) => {
          if (response.correlationId === correlationId) {
            clearTimeout(timeout);
            unsubscribe();
            const resolvedConfirmation =
              response.confirmed ??
              (response.outcome !== undefined
                ? response.outcome !== ToolConfirmationOutcome.Cancel &&
                  response.outcome !== ToolConfirmationOutcome.ModifyWithEditor
                : false);
            resolve(resolvedConfirmation);
          }
        },
      );

      // Publish confirmation request
      this.publish({
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        toolCall,
        correlationId,
        serverName,
      });
    });
  }

  /**
   * Responds to a confirmation request.
   *
   * @param correlationId - The correlation ID from the request
   * @param outcome - The ToolConfirmationOutcome to apply
   * @param payload - Optional payload for inline modifications
   * @param requiresUserConfirmation - Whether legacy UI should be used
   */
  respondToConfirmation(
    correlationId: string,
    outcome: ToolConfirmationOutcome,
    payload?: ToolConfirmationPayload,
    requiresUserConfirmation?: boolean,
  ): void {
    const confirmed =
      outcome !== ToolConfirmationOutcome.Cancel &&
      outcome !== ToolConfirmationOutcome.ModifyWithEditor;
    this.publish({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      outcome,
      payload,
      confirmed,
      requiresUserConfirmation,
    });
  }

  /**
   * Requests confirmation for OAuth bucket authentication.
   * Publishes a confirmation request and waits for user response.
   *
   * @param provider - The provider name (e.g., 'anthropic')
   * @param bucket - The bucket name (e.g., 'work@company.com')
   * @param bucketIndex - Current bucket index (1-based)
   * @param totalBuckets - Total number of buckets
   * @returns Promise<boolean> - true if approved, false if denied
   */
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
        resolve(false); // Timeout = deny
      }, 300000); // 5 minute timeout

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

      // Publish confirmation request
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

  /**
   * Responds to a bucket auth confirmation request.
   *
   * @param correlationId - The correlation ID from the request
   * @param confirmed - Whether the user confirmed
   */
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

  /**
   * Removes all event listeners (for cleanup).
   */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  /**
   * Returns the number of listeners for a specific message type.
   *
   * @param type - The message type
   * @returns Number of listeners
   */
  listenerCount(type: MessageBusType): number {
    return this.emitter.listenerCount(type);
  }
}
