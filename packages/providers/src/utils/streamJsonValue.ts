/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export class StreamJsonValue {
  constructor(readonly bytes: () => AsyncIterable<Uint8Array>) {}
}
