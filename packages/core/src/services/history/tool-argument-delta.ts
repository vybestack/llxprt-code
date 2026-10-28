/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export interface ToolArgumentDelta {
  readonly attemptId?: string;
  readonly sourceId: string;
  readonly id: string;
  readonly name: string;
  readonly nameMode?: 'replace';
  readonly arguments: string;
  readonly complete?: boolean;
  readonly contextOrder?: 'finalized';
  readonly finalizedIndex?: number;
  readonly replacementArguments?: string;
}
