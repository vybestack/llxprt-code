/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DefinitionProblem } from './types.js';

export class DefinitionError extends Error {
  readonly kind = 'definition';
  constructor(readonly problems: readonly DefinitionProblem[]) {
    super(`Agent definition has ${problems.length} problem(s).`);
    this.name = 'DefinitionError';
  }
}

export class BusyError extends Error {
  constructor() {
    super('The agent already has a running turn.');
    this.name = 'BusyError';
  }
}

export class ClosedError extends Error {
  constructor() {
    super('The agent is closed or closing.');
    this.name = 'ClosedError';
  }
}

export class NotRunningError extends Error {
  constructor() {
    super('The operation requires a running turn.');
    this.name = 'NotRunningError';
  }
}

export class CursorExpired extends Error {
  constructor(readonly cursor: number) {
    super(`Event cursor ${cursor} is outside the retained replay window.`);
    this.name = 'CursorExpired';
  }
}

export class Lagging extends Error {
  constructor(readonly cursor: number) {
    super(`Event subscriber fell behind at cursor ${cursor}.`);
    this.name = 'Lagging';
  }
}

export class UnsupportedContent extends Error {
  constructor(readonly modality: string) {
    super(`The active model does not support ${modality} content.`);
    this.name = 'UnsupportedContent';
  }
}
