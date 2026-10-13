/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { rm } from 'node:fs/promises';

/**
 * Collects the outcome of the independent steps of a disposal. Every step
 * runs even when an earlier one failed, so one failure cannot leak the
 * resources owned by a later step; the failures are raised together.
 */
export class DisposalSteps {
  private readonly failures: unknown[] = [];

  async run(step: () => void | Promise<void>): Promise<void> {
    try {
      await step();
    } catch (error) {
      this.failures.push(error);
    }
  }

  removeDirectory(directory: string | null): Promise<void> {
    return this.run(async () => {
      if (directory !== null)
        await rm(directory, { recursive: true, force: true });
    });
  }

  /** A lone failure is thrown as is; several are thrown as one AggregateError. */
  throwIfFailed(message: string): void {
    if (this.failures.length === 1) throw this.failures[0];
    if (this.failures.length > 1)
      throw new AggregateError(this.failures, message);
  }
}
