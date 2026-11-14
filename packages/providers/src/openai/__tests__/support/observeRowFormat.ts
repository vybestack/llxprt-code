/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  RowFormatFill,
  RowFormatRegistration,
  RowLengthFacts,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { RowEntry } from '@vybestack/llxprt-code-core/journal/rowEntry.js';

export function observeRowFormat(
  registration: RowFormatRegistration,
  observe: (entry: RowEntry, facts: RowLengthFacts) => void,
): RowFormatRegistration {
  function measure(
    original: RowFormatRegistration['measure'],
  ): RowFormatRegistration['measure'] {
    return async (snapshot, entry, settings) => {
      const facts = await original(snapshot, entry, settings);
      observe(entry, facts);
      return facts;
    };
  }
  function fill(prepared: RowFormatFill): RowFormatFill {
    return {
      measure: measure(prepared.measure),
      finish: () => prepared.finish(),
      close: () => prepared.close(),
    };
  }
  const { prepare, prepareAppend } = registration;
  return {
    ...registration,
    measure: measure(registration.measure),
    ...(prepare === undefined
      ? {}
      : {
          prepare: async (...args: Parameters<typeof prepare>) =>
            fill(await prepare(...args)),
        }),
    ...(prepareAppend === undefined
      ? {}
      : {
          prepareAppend: async (...args: Parameters<typeof prepareAppend>) =>
            fill(await prepareAppend(...args)),
        }),
  };
}
