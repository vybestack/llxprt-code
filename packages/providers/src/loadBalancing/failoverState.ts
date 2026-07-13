/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export class FailoverState {
  private index = 0;
  private owner = Symbol();

  getIndex(): number {
    return this.index;
  }

  reset(): void {
    this.index = 0;
  }

  claim(): { owner: symbol; startIndex: number } {
    this.owner = Symbol();
    return { owner: this.owner, startIndex: this.index };
  }

  setIfOwner(owner: symbol, index: number): void {
    if (owner === this.owner) {
      this.index = index;
    }
  }

  advanceFrom(
    owner: symbol,
    currentIndex: number,
    profileCount: number,
  ): false {
    this.setIfOwner(owner, (currentIndex + 1) % profileCount);
    return false;
  }
}
