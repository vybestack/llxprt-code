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
  | 'network'
  | 'tokens'
  | 'policy'
  | 'bus'
  | 'settings';

export class AcquisitionRelease {
  private readonly actions: Array<{ phase: Phase; close: Close }> = [];
  private readonly beforeActions: Array<() => void> = [];
  private closing: Promise<void> | undefined;

  acquire(phase: Phase, close: Close): void {
    if (this.closing !== undefined)
      throw new Error('Acquisition owner is closed');
    this.actions.push({ phase, close });
  }

  beforeRelease(action: () => void): void {
    if (this.closing !== undefined)
      throw new Error('Acquisition owner is closed');
    this.beforeActions.push(action);
  }

  close(): Promise<void> {
    this.closing ??= this.begin(false);
    return this.closing;
  }

  rollback(): Promise<void> {
    this.closing ??= this.begin(true);
    return this.closing;
  }

  private begin(reverse: boolean): Promise<void> {
    const failures: unknown[] = [];
    for (const action of this.beforeActions) {
      try {
        action();
      } catch (error) {
        failures.push(error);
      }
    }
    return Promise.resolve().then(() => this.release(reverse, failures));
  }

  private async release(reverse: boolean, failures: unknown[]): Promise<void> {
    const phases: readonly Phase[] = [
      'files',
      'manager',
      'oauth',
      'network',
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
