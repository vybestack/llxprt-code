/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const primitive = 42;

export function exportedFunction(value: string): string {
  return `actual:${value}`;
}

export class ExportedClass {
  method(): string {
    return 'actual';
  }
}

export const nested = {
  label: 'nested',
  callable(): string {
    return 'actual nested';
  },
};
