/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export interface RowOwnershipStats {
  readonly liveRows: number;
  readonly peakRows: number;
  readonly liveSerializedBytes: number;
  readonly peakSerializedBytes: number;
  readonly acquisitions: number;
}

/** Explicit owners only. UTF-8 JSON payload charge, not JavaScript heap size.
 * Distinct shallow copies receive separate full charges, including shared fields.
 * Weak keys never keep rows alive; releases are deterministic, not GC driven.
 */
export class RowOwnership {
  private readonly rows = new WeakMap<
    object,
    { owners: number; bytes: number }
  >();
  private liveRows = 0;
  private peakRows = 0;
  private liveSerializedBytes = 0;
  private peakSerializedBytes = 0;
  private acquisitions = 0;

  retain(row: object): void {
    let entry = this.rows.get(row);
    if (entry === undefined) {
      entry = {
        owners: 0,
        bytes: Buffer.byteLength(JSON.stringify(row), 'utf8'),
      };
      this.rows.set(row, entry);
    }
    if (entry.owners === 0) {
      this.liveRows += 1;
      this.liveSerializedBytes += entry.bytes;
      this.peakRows = Math.max(this.peakRows, this.liveRows);
      this.peakSerializedBytes = Math.max(
        this.peakSerializedBytes,
        this.liveSerializedBytes,
      );
    }
    entry.owners += 1;
    this.acquisitions += 1;
  }

  release(row: object): void {
    const entry = this.rows.get(row);
    if (entry === undefined || entry.owners === 0)
      throw new Error('Unowned row release');
    entry.owners -= 1;
    if (entry.owners === 0) {
      this.liveRows -= 1;
      this.liveSerializedBytes -= entry.bytes;
      this.rows.delete(row);
    }
  }

  snapshot(): RowOwnershipStats {
    return {
      liveRows: this.liveRows,
      peakRows: this.peakRows,
      liveSerializedBytes: this.liveSerializedBytes,
      peakSerializedBytes: this.peakSerializedBytes,
      acquisitions: this.acquisitions,
    };
  }

  within(bound: { rows: number; serializedBytes: number }): boolean {
    return (
      this.acquisitions > 0 &&
      this.peakRows <= bound.rows &&
      this.peakSerializedBytes <= bound.serializedBytes
    );
  }
}
