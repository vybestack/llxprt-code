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
 * @requirement REQ-854-005
 * Wiring behavior: journal derives its sidecar base from the session
 * recording path, wrap journalling onto turn store commit points, and the
 * flag-off path yields no journal and untouched commands. Journal creation
 * is lazy: the recording path is null until the first content event
 * materializes the session file, so the wrapped commands retry creation at
 * each commit and reopen onto a new base when the path changes.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { useTempChatsDir } from '../__testhelpers__/scrollbackTestHelpers.js';
import { createTurnStore } from '../../ui/stores/turn/turnStore.js';
import {
  createLazyScrollbackJournal,
  createScrollbackJournalForSession,
  wrapTurnCommandsWithJournal,
} from './journalWiring.js';
import { ScrollbackJournal } from './ScrollbackJournal.js';

describe('journalWiring', () => {
  const tempDir = useTempChatsDir();

  it('derives chatsDir and session base from the recording file path', () => {
    const chatsDir = tempDir.chatsDir();
    const journal = createScrollbackJournalForSession(
      { getFilePath: () => `${chatsDir}/session-t9-id42.jsonl` },
      true,
    );
    expect(journal).not.toBeNull();
    journal?.append({ id: 1, type: 'info', text: 'hello' });
    journal?.close();
    const files = fs.readdirSync(chatsDir);
    expect(files).toContain('sb-t9-id42.jsonl');
    expect(files).toContain('sb-t9-id42.idx.jsonl');
  });

  it('returns null when the flag is off or no recording is active', () => {
    expect(createScrollbackJournalForSession(null, true)).toBeNull();
    expect(
      createScrollbackJournalForSession({ getFilePath: () => null }, true),
    ).toBeNull();
    expect(
      createScrollbackJournalForSession(
        { getFilePath: () => '/x/session-a-b.jsonl' },
        false,
      ),
    ).toBeNull();
  });

  it('journals items committed through wrapped addItem/updateItem', () => {
    const chatsDir = tempDir.chatsDir();
    const lazyJournal = createLazyScrollbackJournal(
      { getFilePath: () => `${chatsDir}/session-w1.jsonl` },
      true,
    );
    const turnStore = createTurnStore();
    const wrapped = wrapTurnCommandsWithJournal(turnStore, lazyJournal);
    const id = wrapped.addItem({ type: 'info', text: 'first' });
    wrapped.updateItem(id, { text: 'first revised' });
    lazyJournal.close();

    const page = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 'w1',
      enabled: true,
    });
    const meta = page.getRangeMeta();
    expect(meta.count).toBe(2);
    page.close();
    const committed = turnStore.store.getState().history;
    expect(committed[0]?.text).toBe('first revised');
  });

  it('creates the journal lazily at the first commit after the path materializes', () => {
    const chatsDir = tempDir.chatsDir();
    // The real SessionRecordingService returns null from getFilePath() until
    // its first content-class event materializes the session file — the
    // bootstrap wiring must not create the journal before that.
    let filePath: string | null = null;
    const lazyJournal = createLazyScrollbackJournal(
      { getFilePath: () => filePath },
      true,
    );
    const turnStore = createTurnStore();
    const wrapped = wrapTurnCommandsWithJournal(turnStore, lazyJournal);

    const idBefore = wrapped.addItem({ type: 'info', text: 'before path' });
    expect(fs.existsSync(path.join(chatsDir, 'sb-lazy1.jsonl'))).toBe(false);

    filePath = `${chatsDir}/session-lazy1.jsonl`;
    wrapped.addItem({ type: 'info', text: 'after path' });
    const files = fs.readdirSync(chatsDir);
    expect(files).toContain('sb-lazy1.jsonl');
    expect(files).toContain('sb-lazy1.idx.jsonl');

    lazyJournal.close();
    const page = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 'lazy1',
      enabled: true,
    });
    // Only the post-materialization commit is journaled; the earlier item
    // predates the journal and stays out of the sidecar.
    expect(page.getRangeMeta().count).toBe(1);
    page.close();
    expect(turnStore.store.getState().history[0]?.id).toBe(idBefore);
  });

  it('reopens onto the new session base when the recording path changes', () => {
    const chatsDir = tempDir.chatsDir();
    let filePath: string | null = `${chatsDir}/session-res1.jsonl`;
    const lazyJournal = createLazyScrollbackJournal(
      { getFilePath: () => filePath },
      true,
    );
    const turnStore = createTurnStore();
    const wrapped = wrapTurnCommandsWithJournal(turnStore, lazyJournal);

    wrapped.addItem({ type: 'info', text: 'into res1' });
    filePath = `${chatsDir}/session-res2.jsonl`;
    wrapped.addItem({ type: 'info', text: 'into res2' });
    lazyJournal.close();

    const files = fs.readdirSync(chatsDir);
    expect(files).toContain('sb-res1.jsonl');
    expect(files).toContain('sb-res1.idx.jsonl');
    expect(files).toContain('sb-res2.jsonl');
    expect(files).toContain('sb-res2.idx.jsonl');

    const first = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 'res1',
      enabled: true,
    });
    expect(first.getRangeMeta().count).toBe(1);
    first.close();
    const second = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 'res2',
      enabled: true,
    });
    expect(second.getRangeMeta().count).toBe(1);
    second.close();
  });

  it('never creates files when the flag is off', () => {
    const chatsDir = tempDir.chatsDir();
    let filePath: string | null = null;
    const lazyJournal = createLazyScrollbackJournal(
      { getFilePath: () => filePath },
      false,
    );
    const turnStore = createTurnStore();
    const wrapped = wrapTurnCommandsWithJournal(turnStore, lazyJournal);

    const id = wrapped.addItem({ type: 'info', text: 'unjournaled' });
    wrapped.updateItem(id, { text: 'still unjournaled' });
    filePath = `${chatsDir}/session-off.jsonl`;
    wrapped.addItem({ type: 'info', text: 'still unjournaled too' });

    expect(fs.readdirSync(chatsDir)).toStrictEqual([]);
    const committed = turnStore.store.getState().history;
    expect(committed.length).toBe(2);
    expect(committed[0]?.text).toBe('still unjournaled');
    lazyJournal.close();
  });
});
