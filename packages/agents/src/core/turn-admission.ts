/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  suspendJournalMaintenance,
  type JournalMaintenanceScope,
} from '@vybestack/llxprt-code-core/journal/deferred-maintenance.js';

/** Owns the send slot before prompt publication or purge snapshots can start. */
export class TurnAdmission {
  constructor(
    private readonly maintenanceScope: () => JournalMaintenanceScope,
  ) {}

  private tail: Promise<void> = Promise.resolve();
  private async reserve(): Promise<() => void> {
    const previous = this.tail;
    let release = (): void => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const resumeMaintenance = await suspendJournalMaintenance(
      this.maintenanceScope(),
    );
    return () => {
      resumeMaintenance();
      release();
    };
  }
  async run<T>(execute: () => Promise<T>): Promise<T> {
    const release = await this.reserve();
    try {
      return await execute();
    } finally {
      release();
    }
  }
  async stream<T>(
    execute: () => Promise<T>,
    idle: () => Promise<void>,
  ): Promise<T> {
    const release = await this.reserve();
    try {
      const stream = await execute();
      void idle().then(release, release);
      return stream;
    } catch (error) {
      release();
      throw error;
    }
  }
}
