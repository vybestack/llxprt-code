/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import { SessionClientOwner } from '../../../session/session-client-owner.js';

export async function captureSessionOwner<T>(
  build: () => Promise<T>,
): Promise<{ value: T; owner: SessionClientOwner }> {
  let owner: SessionClientOwner | undefined;
  const create = SessionClientOwner.create;
  const capture = spyOn(SessionClientOwner, 'create').mockImplementation(
    async (...args) => {
      owner = await create(...args);
      return owner;
    },
  );
  try {
    const value = await build();
    if (owner === undefined)
      throw new Error('Fixture did not acquire a session owner');
    return { value, owner };
  } finally {
    capture.mockRestore();
  }
}
