/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
type Disposition =
  | { kind: 'borrowed' }
  | { kind: 'owned'; close: () => Promise<void> }
  | { kind: 'closed' };

export class ProviderLifetimeOwnership {
  private disposition: Disposition = { kind: 'borrowed' };
  private closing: Promise<void> | undefined;

  private admissionClosed = false;

  closeAdmission(): void {
    this.admissionClosed = true;
  }

  adopt(close: () => Promise<void>): void {
    if (this.admissionClosed)
      throw new Error('Provider lifetime admission is closed');
    if (this.disposition.kind !== 'borrowed')
      throw new Error('Provider lifetime was already adopted');
    this.disposition = { kind: 'owned', close };
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closeAdmission();
    const selected = this.disposition;
    this.disposition = { kind: 'closed' };
    this.closing = Promise.resolve().then(() =>
      selected.kind === 'owned' ? selected.close() : undefined,
    );
    return this.closing;
  }
}
