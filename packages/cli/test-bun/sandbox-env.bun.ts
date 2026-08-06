/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the sandbox env helpers (#3081). These exercise the
 * REAL `shouldUseCurrentUserInSandbox`, `resolveSandboxContainerHome` and
 * `getContainerPath` against controlled `process.env`, platform and
 * os-release inputs — no module-level mocking of the production code, only
 * spies on the host-surface inputs the functions read.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import os from 'node:os';
import fs from 'node:fs';
import {
  shouldUseCurrentUserInSandbox,
  resolveSandboxContainerHome,
  getContainerPath,
} from '../src/utils/sandbox-env.js';

describe('#3081 shouldUseCurrentUserInSandbox — env-value contract', () => {
  const savedSetUidGid = process.env.SANDBOX_SET_UID_GID;
  let platformSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    delete process.env.SANDBOX_SET_UID_GID;
    // Default to a non-Linux platform so os-release is never consulted unless
    // a test explicitly opts into the Linux auto-detect path.
    platformSpy = spyOn(os, 'platform').mockReturnValue('darwin');
  });

  afterEach(() => {
    platformSpy.mockRestore();
    if (savedSetUidGid === undefined) {
      delete process.env.SANDBOX_SET_UID_GID;
    } else {
      process.env.SANDBOX_SET_UID_GID = savedSetUidGid;
    }
  });

  it('returns false when unset on a non-Linux host', () => {
    expect(shouldUseCurrentUserInSandbox()).toBe(false);
  });

  it.each(['0', 'false'])(
    'returns false for an explicit disable value %s',
    (v) => {
      process.env.SANDBOX_SET_UID_GID = v;
      expect(shouldUseCurrentUserInSandbox()).toBe(false);
    },
  );

  it.each(['1', 'true'])(
    'returns true for an explicit enable value %s',
    (v) => {
      process.env.SANDBOX_SET_UID_GID = v;
      expect(shouldUseCurrentUserInSandbox()).toBe(true);
    },
  );

  it('treats mixed-case enable values as enabled', () => {
    process.env.SANDBOX_SET_UID_GID = 'True';
    expect(shouldUseCurrentUserInSandbox()).toBe(true);
  });

  it('trims surrounding whitespace before evaluating', () => {
    process.env.SANDBOX_SET_UID_GID = '  1  ';
    expect(shouldUseCurrentUserInSandbox()).toBe(true);
  });
});

describe('#3081 shouldUseCurrentUserInSandbox — Linux os-release auto-detect', () => {
  const savedSetUidGid = process.env.SANDBOX_SET_UID_GID;
  let platformSpy: ReturnType<typeof spyOn>;
  let readSpy: ReturnType<typeof spyOn>;
  const realReadFileSync = fs.readFileSync;

  beforeEach(() => {
    delete process.env.SANDBOX_SET_UID_GID;
    platformSpy = spyOn(os, 'platform').mockReturnValue('linux');
  });

  afterEach(() => {
    platformSpy.mockRestore();
    readSpy?.mockRestore();
    if (savedSetUidGid === undefined) {
      delete process.env.SANDBOX_SET_UID_GID;
    } else {
      process.env.SANDBOX_SET_UID_GID = savedSetUidGid;
    }
  });

  function stubOsRelease(content: string | (() => never)): void {
    readSpy = spyOn(fs, 'readFileSync').mockImplementation((p) => {
      if (p === '/etc/os-release') {
        if (typeof content === 'function') {
          content();
        }
        return content as string;
      }
      return realReadFileSync(p);
    });
  }

  it('detects Debian via ID=debian', () => {
    stubOsRelease('ID=debian\nVERSION_ID="12"\n');
    expect(shouldUseCurrentUserInSandbox()).toBe(true);
  });

  it('detects Ubuntu via ID=ubuntu', () => {
    stubOsRelease('ID=ubuntu\nVERSION_ID="22.04"\n');
    expect(shouldUseCurrentUserInSandbox()).toBe(true);
  });

  it('detects a Debian derivative via ID_LIKE=debian', () => {
    stubOsRelease('ID=linuxmint\nID_LIKE=debian\n');
    expect(shouldUseCurrentUserInSandbox()).toBe(true);
  });

  it('does NOT auto-detect a non-Debian distro (Fedora)', () => {
    stubOsRelease('ID=fedora\nVERSION_ID="40"\n');
    expect(shouldUseCurrentUserInSandbox()).toBe(false);
  });

  it('returns false when /etc/os-release is unreadable', () => {
    stubOsRelease(() => {
      throw new Error('not found');
    });
    expect(shouldUseCurrentUserInSandbox()).toBe(false);
  });
});

describe('#3081 resolveSandboxContainerHome', () => {
  const savedSetUidGid = process.env.SANDBOX_SET_UID_GID;
  let platformSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    platformSpy = spyOn(os, 'platform').mockReturnValue('linux');
  });

  afterEach(() => {
    platformSpy.mockRestore();
    if (savedSetUidGid === undefined) {
      delete process.env.SANDBOX_SET_UID_GID;
    } else {
      process.env.SANDBOX_SET_UID_GID = savedSetUidGid;
    }
  });

  it('returns the host home (translated) on the current-user path', () => {
    process.env.SANDBOX_SET_UID_GID = '1';
    expect(resolveSandboxContainerHome()).toBe(getContainerPath(os.homedir()));
  });

  it('returns the image default home on the non-current-user path', () => {
    process.env.SANDBOX_SET_UID_GID = 'false';
    expect(resolveSandboxContainerHome()).toBe('/home/node');
  });
});

describe('#3081 getContainerPath — host path translation', () => {
  let platformSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    platformSpy?.mockRestore();
  });

  it('translates a Windows drive path to the /c/... POSIX form under win32', () => {
    platformSpy = spyOn(os, 'platform').mockReturnValue('win32');
    expect(getContainerPath('C:\\Users\\me\\llxprt-code')).toBe(
      '/c/Users/me/llxprt-code',
    );
  });

  it('does not translate a POSIX path on a non-win32 host', () => {
    platformSpy = spyOn(os, 'platform').mockReturnValue('linux');
    const p = '/home/node/.config/llxprt-code';
    expect(getContainerPath(p)).toBe(p);
  });
});
