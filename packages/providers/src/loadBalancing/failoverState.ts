/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export class FailoverState {
  private index = 0;
  private generation = 0;

  getIndex(): number {
    return this.index;
  }

  reset(): void {
    this.index = 0;
  }

  claim(): { generation: number; startIndex: number } {
    this.generation++;
    return { generation: this.generation, startIndex: this.index };
  }

  setIfOwner(generation: number, index: number): void {
    if (generation === this.generation) {
      this.index = index;
    }
  }

  advanceFrom(
    generation: number,
    currentIndex: number,
    profileCount: number,
  ): false {
    this.setIfOwner(generation, (currentIndex + 1) % profileCount);
    return false;
  }
}
