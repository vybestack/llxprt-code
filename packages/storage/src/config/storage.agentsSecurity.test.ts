/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import * as path from 'node:path';

// `os.homedir` is a non-configurable property, so it cannot be spied on with
// vi.spyOn. Instead we mock the entire `os` module, spreading the real
// implementation and overriding only `homedir`. `vi.hoisted` ensures the mock
// fn is available inside the hoisted vi.mock factory.
const { homedirMock } = {
  homedirMock: vi.fn<() => string | undefined>(),
};

const actual = { ...(await import('os')) };
void vi.mock('os', () => ({ ...actual, homedir: homedirMock }));

// Imported AFTER vi.mock is established (vi.mock is hoisted above imports).
import { Storage } from './storage.js';

describe('Storage - .agents security: fail-closed home resolution', () => {
  const originalAgentsHome = process.env.LLXPRT_AGENTS_HOME;

  beforeEach(() => {
    homedirMock.mockReset();
    // The storage-isolation preload sets LLXPRT_AGENTS_HOME; the homedir
    // fail-closed path only runs when the override is absent.
    delete process.env.LLXPRT_AGENTS_HOME;
  });

  afterEach(() => {
    if (originalAgentsHome === undefined) {
      delete process.env.LLXPRT_AGENTS_HOME;
    } else {
      process.env.LLXPRT_AGENTS_HOME = originalAgentsHome;
    }
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

  it('honors an absolute LLXPRT_AGENTS_HOME without consulting the home directory', () => {
    homedirMock.mockReturnValue('');
    process.env.LLXPRT_AGENTS_HOME = '/absolute/agents-home';
    expect(Storage.getGlobalAgentsDir()).toBe('/absolute/agents-home');
    expect(Storage.getUserAgentSkillsDir()).toBe(
      path.join('/absolute/agents-home', 'skills'),
    );
  });

  it('throws when LLXPRT_AGENTS_HOME is relative rather than producing a relative path', () => {
    homedirMock.mockReturnValue('/home/test-user');
    process.env.LLXPRT_AGENTS_HOME = 'relative/agents-home';
    expect(() => Storage.getGlobalAgentsDir()).toThrow(
      'LLXPRT_AGENTS_HOME must be an absolute path',
    );
    expect(() => Storage.getUserAgentSkillsDir()).toThrow(
      'LLXPRT_AGENTS_HOME must be an absolute path',
    );
  });
});
