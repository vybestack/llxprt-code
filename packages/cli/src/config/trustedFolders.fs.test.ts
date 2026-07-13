/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveTrustedFolders, TrustLevel } from './trustedFolders.js';

const temporaryDirectories: string[] = [];

describe('saveTrustedFolders filesystem permissions', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'repairs an existing permissive file to mode 0600',
    () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'llxprt-trusted-folders-'),
      );
      temporaryDirectories.push(directory);
      const filePath = path.join(directory, 'trustedFolders.json');
      fs.writeFileSync(filePath, '{}', { mode: 0o644 });
      fs.chmodSync(filePath, 0o644);

      saveTrustedFolders({
        path: filePath,
        config: { '/workspace': TrustLevel.TRUST_FOLDER },
      });

      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toStrictEqual({
        '/workspace': TrustLevel.TRUST_FOLDER,
      });
    },
  );
});
