/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RequestSizeSink } from './requestSizeReport.js';

/**
 * Holds back a body-less `api_request` until the provider reports the size of
 * the request body it is about to send, so the event carries the size without
 * any second pass over the rows. The first report wins; later attempts of the
 * same request resend the same body. {@link settle} emits the event without a
 * size when the provider never got as far as reporting one.
 */
export class DeferredApiRequest {
  private emitted = false;

  constructor(
    private readonly emit: (requestChars: number | undefined) => void,
  ) {}

  readonly report: RequestSizeSink = (requestChars) => {
    this.emitOnce(requestChars);
  };

  settle(): void {
    this.emitOnce(undefined);
  }

  private emitOnce(requestChars: number | undefined): void {
    if (this.emitted) return;
    this.emitted = true;
    this.emit(requestChars);
  }
}
