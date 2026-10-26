/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/** Owns the send slot before prompt publication or purge snapshots can start. */
export class TurnAdmission {
  private tail: Promise<void> = Promise.resolve();
  private async reserve(): Promise<() => void> {
    const previous = this.tail;
    let release = (): void => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
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
