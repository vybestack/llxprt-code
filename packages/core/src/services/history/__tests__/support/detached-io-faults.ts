/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export class DetachedIOFaults {
  private readZero = false;
  private writeZero = false;
  private writeFailure: Error | undefined;
  private writeStage: 'records' | 'trailer' | undefined;
  reads = 0;
  writes = 0;
  descriptorReads = 0;
  descriptorReadBytes = 0;
  descriptorWrites = 0;
  descriptorWrittenBytes = 0;

  recordRead(bytes: number): void {
    this.descriptorReads++;
    this.descriptorReadBytes += bytes;
  }

  recordWrite(bytes: number): void {
    this.descriptorWrites++;
    this.descriptorWrittenBytes += bytes;
  }

  zeroNext(kind: 'read' | 'write'): void {
    if (kind === 'read') this.readZero = true;
    else this.writeZero = true;
  }

  rejectNextWrite(error: Error, stage?: 'records' | 'trailer'): void {
    this.writeFailure = error;
    this.writeStage = stage;
  }

  read(): boolean {
    if (!this.readZero) return false;
    this.readZero = false;
    this.reads++;
    return true;
  }

  write(stage: 'records' | 'trailer'): boolean {
    if (
      this.writeFailure !== undefined &&
      (this.writeStage === undefined || this.writeStage === stage)
    ) {
      const failure = this.writeFailure;
      this.writeFailure = undefined;
      this.writes++;
      throw failure;
    }
    if (!this.writeZero) return false;
    this.writeZero = false;
    this.writes++;
    return true;
  }
}
