/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config, type MCPResource } from '@vybestack/llxprt-code-core';
import { toConfigParameters } from '@vybestack/llxprt-code-agents';
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
import { cleanup, renderHook, waitFor } from '../../__tests__/render.js';
import { useTestHarnessForAtCompletion } from './__tests__/useAtCompletion-test-helpers.js';
import { MAX_SUGGESTIONS_TO_SHOW } from '../components/SuggestionsDisplay.js';
import { searchCompletionCandidates } from './completion-fuzzy-search.js';

class CompletionConfig extends Config {
  constructor(
    directory: string,
    private readonly resources: MCPResource[],
  ) {
    super(
      toConfigParameters({
        provider: 'openai',
        model: 'local-only',
        workingDir: directory,
        folderTrust: true,
        mcpEnabled: false,
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
    );
  }

  listResources(): MCPResource[] {
    return this.resources;
  }
}

describe('completion fuzzy search', () => {
  let directory = '';
  let config: Config | undefined;
  const compose = installWorkspaceRuntimeFixture(() => directory);

  afterEach(async () => {
    cleanup();
    await compose.dispose();
    await config?.dispose();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('rejects an already aborted completion request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchCompletionCandidates(
        [
          {
            searchKey: 'alpha',
            suggestion: { label: 'alpha', value: 'alpha' },
          },
        ],
        'alp',
        3,
        controller.signal,
      ),
    ).rejects.toHaveProperty('name', 'AbortError');
  });

  it('joins cancellation of a physical-file fuzzy search without cancelling its replacement', async () => {
    directory = await mkdtemp(join(tmpdir(), 'completion-fuzzy-abort-'));
    for (let index = 0; index < 12000; index += 1) {
      await writeFile(join(directory, `record-${index}.txt`), `${index}\n`);
    }
    const candidates = (await readdir(directory)).map((name) => ({
      searchKey: name,
      suggestion: { label: name, value: name },
    }));
    const controller = new AbortController();
    const cancelled = searchCompletionCandidates(
      candidates,
      'record',
      24,
      controller.signal,
    );
    const replacement = searchCompletionCandidates(
      candidates,
      'record-11999.txt',
      1,
      new AbortController().signal,
    );
    controller.abort();
    await expect(cancelled).rejects.toHaveProperty('name', 'AbortError');
    expect(
      (await replacement).map((suggestion) => suggestion.value),
    ).toStrictEqual(['record-11999.txt']);
    const ranked = await searchCompletionCandidates(
      candidates,
      'record-11.txt',
      24,
      new AbortController().signal,
    );
    expect(ranked).toHaveLength(24);
    expect(ranked[0]?.value).toBe('record-11.txt');
    expect(ranked.map((suggestion) => suggestion.value)).not.toContain(
      'record-2.txt',
    );
  });

  it('bounds resource completion from physical files while retaining file-first result order', async () => {
    directory = await mkdtemp(join(tmpdir(), 'completion-fuzzy-'));
    for (let index = 0; index < 3000; index += 1) {
      await writeFile(join(directory, `record-${index}.txt`), `${index}\n`);
    }
    await writeFile(join(directory, 'docs.txt'), 'visible\n');
    await writeFile(join(directory, '.llxprtignore'), 'docs-ignored.txt\n');
    await writeFile(join(directory, 'docs-ignored.txt'), 'hidden\n');
    const resources = (await readdir(directory))
      .filter((name) => name.startsWith('record-'))
      .map((name) => ({
        serverName: 'docs',
        uri: `file://${join(directory, name)}`,
        name,
        discoveredAt: Date.now(),
      }));
    const source = new CompletionConfig(directory, resources);
    config = source;
    const runtime = compose(source);
    const { result } = renderHook(() =>
      useTestHarnessForAtCompletion(true, 'docs', runtime, directory),
    );
    await waitFor(() => {
      expect(result.current.suggestions.length).toBeGreaterThan(1);
    });
    const suggestions = result.current.suggestions;
    expect(suggestions[0]?.value).toBe('docs.txt');
    expect(suggestions.map((suggestion) => suggestion.value)).not.toContain(
      'docs-ignored.txt',
    );
    expect(
      suggestions.filter((suggestion) => suggestion.value.startsWith('docs:')),
    ).toHaveLength(MAX_SUGGESTIONS_TO_SHOW * 3);
  });
});
