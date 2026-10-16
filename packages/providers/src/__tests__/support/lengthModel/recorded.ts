/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: reads what the counterexample fixtures recorded for a
 * send, so a length model can be checked against today's bytes.
 */

import type { Observation } from '../frozenWire/explicit/explicitCase.js';

/** The history-member byte lengths of the sends recorded under `label`. */
export function recordedMembers(
  observation: Observation | undefined,
  label: string,
): number[] {
  if (observation === undefined) throw new Error('the fixture holds no case');
  const sends: unknown = Reflect.get(observation, label);
  if (!Array.isArray(sends)) throw new Error(`no sends under ${label}`);
  return sends.map((sent: unknown) => {
    const member: unknown = Reflect.get(Object(sent), 'member');
    if (typeof member !== 'number') {
      throw new Error(`${label} recorded no history member`);
    }
    return member;
  });
}
