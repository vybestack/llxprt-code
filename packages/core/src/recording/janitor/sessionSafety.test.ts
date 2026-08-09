/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Behavioral tests for the shared session safety primitives used by the
 * janitor and lock manager to prevent path-traversal, symlink-redirect, and
 * unsafe session ID attacks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SAFE_SESSION_ID_RE,
  isValidSafeSessionId,
  isDirectChildPath,
  isPathContainedIn,
  assertSafeLockPath,
  isRegularNonSymlinkFile,
  isRegularNonSymlinkDir,
} from './sessionSafety.js';

describe('SAFE_SESSION_ID grammar', () => {
  it('accepts a standard UUID', () => {
    expect(isValidSafeSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(
      true,
    );
  });

  it('accepts alphanumeric, dash, and underscore identifiers', () => {
    expect(isValidSafeSessionId('session-abc_123')).toBe(true);
    expect(isValidSafeSessionId('a')).toBe(true);
  });

  it('rejects path separators', () => {
    expect(isValidSafeSessionId('a/b')).toBe(false);
    expect(isValidSafeSessionId('a\\b')).toBe(false);
  });

  it('rejects dot characters (path traversal prevention)', () => {
    expect(isValidSafeSessionId('..')).toBe(false);
    expect(isValidSafeSessionId('../etc/passwd')).toBe(false);
    expect(isValidSafeSessionId('a.b')).toBe(false);
  });

  it('rejects empty strings and whitespace', () => {
    expect(isValidSafeSessionId('')).toBe(false);
    expect(isValidSafeSessionId('   ')).toBe(false);
  });

  it('rejects null bytes and control characters', () => {
    expect(isValidSafeSessionId('a\x00b')).toBe(false);
    expect(isValidSafeSessionId('a\nb')).toBe(false);
  });

  it('rejects identifiers exceeding the maximum length', () => {
    expect(isValidSafeSessionId('a'.repeat(257))).toBe(false);
    expect(isValidSafeSessionId('a'.repeat(256))).toBe(true);
  });

  it('the exported regex matches the same grammar', () => {
    expect(SAFE_SESSION_ID_RE.test('valid-id_1')).toBe(true);
    expect(SAFE_SESSION_ID_RE.test('../evil')).toBe(false);
  });
});

describe('isDirectChildPath', () => {
  it('returns true for a direct child', () => {
    expect(isDirectChildPath('/tmp/chats', '/tmp/chats/session-abc.lock')).toBe(
      true,
    );
  });

  it('returns false for a nested grandchild', () => {
    expect(isDirectChildPath('/tmp/chats', '/tmp/chats/sub/session.lock')).toBe(
      false,
    );
  });

  it('returns false for a path outside the parent', () => {
    expect(isDirectChildPath('/tmp/chats', '/tmp/evil/session.lock')).toBe(
      false,
    );
  });

  it('returns false for path-traversal segments', () => {
    expect(
      isDirectChildPath('/tmp/chats', '/tmp/chats/../../../etc/passwd.lock'),
    ).toBe(false);
  });
});

describe('isPathContainedIn', () => {
  it('returns true when child is nested inside parent', () => {
    expect(isPathContainedIn('/tmp/root', '/tmp/root/a/b')).toBe(true);
  });

  it('returns true when child equals parent', () => {
    expect(isPathContainedIn('/tmp/root', '/tmp/root')).toBe(true);
  });

  it('returns false for a sibling outside the parent', () => {
    expect(isPathContainedIn('/tmp/root', '/tmp/evil')).toBe(false);
  });

  it('returns false for a path that merely prefixes the name', () => {
    expect(isPathContainedIn('/tmp/root', '/tmp/root-evil')).toBe(false);
  });
});

describe('assertSafeLockPath', () => {
  it('does not throw for a valid direct-child lock path', () => {
    expect(() =>
      assertSafeLockPath('/tmp/chats', '/tmp/chats/session-abc.lock'),
    ).not.toThrow();
  });

  it('throws for a lock path that escapes chatsDir', () => {
    expect(() =>
      assertSafeLockPath('/tmp/chats', '/tmp/evil/session.lock'),
    ).toThrow('Unsafe lock path');
  });

  it('throws for a path-traversal lock path', () => {
    expect(() =>
      assertSafeLockPath('/tmp/chats', '/tmp/chats/../../../etc/passwd.lock'),
    ).toThrow('Unsafe lock path');
  });
});

describe('isRegularNonSymlinkFile / isRegularNonSymlinkDir', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safety-fs-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('isRegularNonSymlinkFile returns true for a real file', async () => {
    const filePath = path.join(tempDir, 'real.txt');
    await fs.writeFile(filePath, 'data');
    expect(await isRegularNonSymlinkFile(filePath)).toBe(true);
  });

  it('isRegularNonSymlinkFile returns false for a symlink', async () => {
    const target = path.join(tempDir, 'target.txt');
    await fs.writeFile(target, 'data');
    const link = path.join(tempDir, 'link.txt');
    await fs.symlink(target, link);
    expect(await isRegularNonSymlinkFile(link)).toBe(false);
  });

  it('isRegularNonSymlinkFile returns false for a directory', async () => {
    expect(await isRegularNonSymlinkFile(tempDir)).toBe(false);
  });

  it('isRegularNonSymlinkFile returns false for a non-existent path', async () => {
    expect(await isRegularNonSymlinkFile(path.join(tempDir, 'nope.txt'))).toBe(
      false,
    );
  });

  it('isRegularNonSymlinkDir returns true for a real directory', async () => {
    expect(await isRegularNonSymlinkDir(tempDir)).toBe(true);
  });

  it('isRegularNonSymlinkDir returns false for a symlinked directory', async () => {
    const real = path.join(tempDir, 'realdir');
    await fs.mkdir(real);
    const link = path.join(tempDir, 'linkdir');
    await fs.symlink(real, link, 'dir');
    expect(await isRegularNonSymlinkDir(link)).toBe(false);
  });
});
