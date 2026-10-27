/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { setImmediate } from 'node:timers/promises';

export class DeferredMaintenance {
  private scheduled: Promise<void> | undefined;
  private requested = false;

  constructor(
    private readonly run: () => Promise<void>,
    private readonly fail: (error: unknown) => void,
  ) {}

  request(): void {
    this.requested = true;
    if (this.scheduled !== undefined) return;
    this.scheduled = setImmediate()
      .then(async () => {
        this.requested = false;
        await this.run();
      })
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.scheduled = undefined;
        if (this.requested) this.request();
      });
  }

  consumeRequests(): void {
    this.requested = false;
  }

  async settle(): Promise<void> {
    while (this.scheduled !== undefined) await this.scheduled;
  }
}
