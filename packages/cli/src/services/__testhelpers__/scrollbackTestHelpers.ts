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
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-001
 * Shared real-filesystem lifecycle for scrollback tests: registers one
 * temp-chats-dir beforeEach/afterEach pair per describe block and hands out
 * the directory lazily.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach } from 'bun:test';

export interface TempChatsDir {
  /** The per-test chats directory. */
  chatsDir(): string;
}

export function useTempChatsDir(): TempChatsDir {
  let dir: string | null = null;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-sb-test-'));
  });
  afterEach(() => {
    if (dir !== null) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });
  return {
    chatsDir(): string {
      if (dir === null) {
        throw new Error('temp chats dir not initialized for this test');
      }
      return dir;
    },
  };
}
