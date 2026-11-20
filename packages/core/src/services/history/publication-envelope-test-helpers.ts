/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';

const { gcAndSweep }: { gcAndSweep(): void } = createRequire(import.meta.url)(
  'bun:jsc',
);

export function envelopeGate(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function envelopeGC(): Promise<void> {
  for (let index = 0; index < 4; index++) {
    await setImmediate();
    gcAndSweep();
  }
}

export function envelopeSurvivors(
  refs: ReadonlyArray<WeakRef<object>>,
): number {
  return refs.filter((ref) => ref.deref() !== undefined).length;
}
