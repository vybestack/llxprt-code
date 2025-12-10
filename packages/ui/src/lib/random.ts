import { randomInt } from 'node:crypto';

export function secureRandomBetween(min: number, max: number): number {
  return randomInt(min, max + 1);
}
