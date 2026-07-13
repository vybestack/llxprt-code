/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';

// `os.homedir` is a non-configurable property, so it cannot be spied on with
// vi.spyOn. Instead we mock the entire `os` module, spreading the real
// implementation and overriding only `homedir`. `vi.hoisted` ensures the mock
// fn is available inside the hoisted vi.mock factory.
const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<[], string | undefined>(),
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: homedirMock };
});

// Imported AFTER vi.mock is established (vi.mock is hoisted above imports).
import { Storage } from './storage.js';

describe('Storage - .agents security: fail-closed home resolution', () => {
  beforeEach(() => {
    homedirMock.mockReset();
  });

  it('throws when os.homedir() is empty rather than returning a relative path', () => {
    homedirMock.mockReturnValue('');
    expect(() => Storage.getGlobalAgentsDir()).toThrow(
      'Unable to resolve user home directory for .agents skills',
    );
    // The dependent method must also fail closed - it must never produce a
    // bare relative ".agents/skills" path.
    expect(() => Storage.getUserAgentSkillsDir()).toThrow(
      'Unable to resolve user home directory for .agents skills',
    );
  });

  it('throws when os.homedir() returns a relative path', () => {
    homedirMock.mockReturnValue('relative/home');
    expect(() => Storage.getGlobalAgentsDir()).toThrow(
      'Unable to resolve user home directory for .agents skills',
    );
    expect(() => Storage.getUserAgentSkillsDir()).toThrow(
      'Unable to resolve user home directory for .agents skills',
    );
  });

  it('throws when os.homedir() returns undefined', () => {
    homedirMock.mockReturnValue(undefined);
    expect(() => Storage.getGlobalAgentsDir()).toThrow(
      'Unable to resolve user home directory for .agents skills',
    );
    // The dependent method must also fail closed for undefined.
    expect(() => Storage.getUserAgentSkillsDir()).toThrow(
      'Unable to resolve user home directory for .agents skills',
    );
  });

  it('resolves normally when os.homedir() returns an absolute path', () => {
    homedirMock.mockReturnValue('/home/test-user');
    expect(Storage.getGlobalAgentsDir()).toBe(
      path.join('/home/test-user', '.agents'),
    );
    expect(Storage.getUserAgentSkillsDir()).toBe(
      path.join('/home/test-user', '.agents', 'skills'),
    );
  });
});
