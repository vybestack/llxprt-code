/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
type Close = () => void | Promise<void>;
type Phase =
  | 'files'
  | 'manager'
  | 'oauth'
  | 'tokens'
  | 'policy'
  | 'bus'
  | 'settings';

export class AcquisitionRelease {
  private readonly actions: Array<{ phase: Phase; close: Close }> = [];
  private closing: Promise<void> | undefined;

  acquire(phase: Phase, close: Close): void {
    if (this.closing !== undefined)
      throw new Error('Acquisition owner is closed');
    this.actions.push({ phase, close });
  }

  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(() => this.release(false));
    return this.closing;
  }

  rollback(): Promise<void> {
    this.closing ??= Promise.resolve().then(() => this.release(true));
    return this.closing;
  }

  private async release(reverse: boolean): Promise<void> {
    const phases: readonly Phase[] = [
      'files',
      'manager',
      'oauth',
      'tokens',
      'policy',
      'bus',
      'settings',
    ];
    const actions = reverse
      ? [...this.actions].reverse()
      : phases.flatMap((phase) =>
          this.actions.filter((action) => action.phase === phase),
        );
    const failures: unknown[] = [];
    for (const action of actions) {
      try {
        await action.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Acquisition owner cleanup failed');
  }
}
