/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

export const SESSION_ROW_VISIT_CAPACITY = 32_768;

/** Fixed observer storage must not become part of the history being measured. */
export class SessionRowVisits {
  private readonly bits = new Uint8Array(SESSION_ROW_VISIT_CAPACITY / 8);
  private claimed = 0;

  constructor(private readonly rowCount: number) {
    if (
      !Number.isSafeInteger(rowCount) ||
      rowCount < 0 ||
      rowCount > SESSION_ROW_VISIT_CAPACITY
    )
      throw new RangeError(
        'Session exceeds the fixed row-observation capacity',
      );
  }

  get retainedBytes(): number {
    return this.bits.byteLength;
  }

  get count(): number {
    return this.claimed;
  }

  claim(index: number): boolean {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.rowCount)
      throw new RangeError('Observed ordinal is outside the session selection');
    const byte = Math.floor(index / 8);
    const mask = 1 << index % 8;
    if ((this.bits[byte] & mask) !== 0) return false;
    this.bits[byte] |= mask;
    this.claimed++;
    return true;
  }
}
