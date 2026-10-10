/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ImageOperationRunner,
  ImageOperationRunnerInput,
  ImageOperationRunnerResult,
} from '@vybestack/llxprt-code-core/services/image/imageCapability.js';

/**
 * Admits image operations for one session, cancels them when admission closes,
 * and joins the accepted ones before running the composition cleanup.
 */
export class SessionImageAdmission {
  private runner: ImageOperationRunner | undefined;
  private readonly cancellation = new AbortController();
  private readonly accepted = new Set<Promise<ImageOperationRunnerResult>>();
  private cleanup: (() => Promise<void>) | undefined;
  private closing: Promise<void> | undefined;

  isComposed(): boolean {
    return this.runner !== undefined;
  }

  compose(runner: ImageOperationRunner, cleanup?: () => Promise<void>): void {
    this.cancellation.signal.throwIfAborted();
    if (this.runner !== undefined)
      throw new Error('Session image operation is already composed');
    this.runner = runner;
    this.cleanup = cleanup;
  }

  async run(
    input: ImageOperationRunnerInput,
  ): Promise<ImageOperationRunnerResult> {
    this.cancellation.signal.throwIfAborted();
    const runner = this.runner;
    if (runner === undefined)
      throw new Error('Missing explicit image composition');
    const signal =
      input.signal === undefined
        ? this.cancellation.signal
        : AbortSignal.any([input.signal, this.cancellation.signal]);
    signal.throwIfAborted();
    const admitted = Object.freeze({
      prompt: input.prompt,
      outputPath: input.outputPath,
      inputPaths:
        input.inputPaths === undefined
          ? undefined
          : Object.freeze([...input.inputPaths]),
      signal,
    });
    const operation = runner(admitted);
    this.accepted.add(operation);
    return operation.finally(() => {
      this.accepted.delete(operation);
    });
  }

  close(): Promise<void> {
    this.cancellation.abort();
    this.closing ??= Promise.allSettled([...this.accepted]).then(async () => {
      await this.cleanup?.();
    });
    return this.closing;
  }
}
