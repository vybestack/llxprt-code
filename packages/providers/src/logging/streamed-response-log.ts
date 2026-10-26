/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { getConversationFileWriter } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
import { ConversationResponseEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import type { ConversationLogContext } from './conversationResponseLogger.js';
import type { RequestLoggingPolicy } from './requestLoggingPolicy.js';
import { StreamingRedactor } from './streaming-redactor.js';

type ArtifactStream = Awaited<
  ReturnType<ReturnType<typeof getConversationFileWriter>['openResponseStream']>
>;

export class StreamedResponseLog {
  private readonly redactor: StreamingRedactor;
  private stream: ArtifactStream | undefined;
  private failure: unknown;
  private failed = false;
  constructor(
    private readonly config: ProviderRequestDiagnostics,
    private readonly context: ConversationLogContext,
    private readonly policy: RequestLoggingPolicy,
  ) {
    this.redactor = new StreamingRedactor(config.redaction);
  }

  get retainedChars(): number {
    return this.redactor.retainedChars;
  }
  get retentionLimit(): number {
    return this.redactor.retentionLimit;
  }

  private async open(): Promise<ArtifactStream> {
    this.stream ??= await getConversationFileWriter(
      this.config.conversationLogPath,
    ).openResponseStream(this.context.providerName);
    return this.stream;
  }

  async append(text: string): Promise<void> {
    if (this.failed) return;
    try {
      const redacted = this.redactor.push(text);
      if (redacted.length > 0) await (await this.open()).append(redacted);
    } catch (error) {
      this.failed = true;
      this.failure = error;
      await this.abort();
    }
  }

  async finish(
    promptId: string,
    duration: number,
    success: boolean,
    error: unknown,
  ): Promise<void | (() => void | Promise<void>)> {
    try {
      if (this.failed) throw this.failure;
      if (!success) await this.abort();
      const stream = await this.open();
      if (success) await stream.append(this.redactor.finish());
      const artifact = await stream.finish({
        conversationId: this.context.conversationId,
        turnNumber: this.context.turnNumber,
        promptId,
        duration,
        success,
        error: error != null ? String(error) : undefined,
      });
      const event = new ConversationResponseEvent(
        this.context.providerName,
        this.context.conversationId,
        this.context.turnNumber,
        promptId,
        artifact,
        duration,
        success,
        error != null ? String(error) : undefined,
      );
      const publish = (): void => this.config.recordConversationResponse(event);
      if (this.policy.strictDurableResponse) {
        if (this.policy.strictTelemetry)
          return async (): Promise<void> => {
            const accept = await this.config.acknowledgeTerminalTelemetry(
              publish,
              this.policy.signal,
            );
            accept();
          };
        return publish;
      }
      publish();
    } catch (logError) {
      await this.abort();
      if (this.policy.strictDurableResponse) throw logError;
      this.context.debug.warn(
        () => `Failed to write conversation response log: ${logError}`,
      );
    }
    return undefined;
  }

  async abort(): Promise<void> {
    const stream = this.stream;
    this.stream = undefined;
    await stream?.abort();
  }
}
