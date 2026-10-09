/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export type FetchCall = (
  ...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;

const nativeFetch = globalThis.fetch;

export function withFetchPreconnect<T extends FetchCall>(
  transport: T,
): NoInfer<T> & Pick<typeof fetch, 'preconnect'> {
  return Object.assign(transport, {
    preconnect: nativeFetch.preconnect.bind(nativeFetch),
  });
}
