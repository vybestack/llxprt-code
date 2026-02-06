/**
 * Copyright 2025 Vybestack LLC
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

import { readFileSync } from 'node:fs';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IModel } from '../IModel.js';
import type { IContent } from '../../services/history/IContent.js';

/**
 * Each line in a .responses file is a JSON object representing one model turn.
 * The `chunks` array contains the IContent objects that generateChatCompletion
 * will yield for that turn.
 */
export interface FakeResponseTurn {
  chunks: IContent[];
}

/**
 * Recursively replace `{{CWD}}` in all string values of a parsed object.
 * Performed after JSON.parse so that backslashes in `cwd` (Windows paths)
 * don't break the JSON syntax.
 */
function substituteCwd<T>(value: T, cwd: string): T {
  if (typeof value === 'string') {
    return value.replaceAll('{{CWD}}', cwd) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteCwd(item, cwd)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        substituteCwd(v, cwd),
      ]),
    ) as T;
  }
  return value;
}

/**
 * A provider that replays canned responses from a JSONL file.
 *
 * Intended for deterministic integration tests — the CLI runs tools for real
 * but model responses come from a golden file instead of a live LLM.
 *
 * The file format is newline-delimited JSON (JSONL).  Each line is a
 * {@link FakeResponseTurn} object.
 *
 * Paths inside tool-call parameters often need to match the ephemeral test
 * directory.  Use the literal string `{{CWD}}` in the golden file; the
 * provider replaces it with `cwd` at load time.
 */
export class FakeProvider implements IProvider {
  name = 'fake';
  isDefault = true;

  // Satisfy ProviderManager.normalizeRuntimeInputs validation: provides a
  // dummy baseURL so the provider passes the baseURL-required check.
  baseProviderConfig = { baseURL: 'http://fake-provider.local' };

  private turns: FakeResponseTurn[];
  private callCounter = 0;

  constructor(filePath: string, cwd?: string) {
    const raw = readFileSync(filePath, 'utf-8');
    this.turns = raw
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const turn = JSON.parse(line) as FakeResponseTurn;
        return cwd ? substituteCwd(turn, cwd) : turn;
      });
  }

  async *generateChatCompletion(
    _optionsOrContent: GenerateChatOptions | IContent[],
  ): AsyncIterableIterator<IContent> {
    const turnIndex = this.callCounter++;
    const turn = this.turns[turnIndex];
    if (!turn) {
      throw new Error(
        `FakeProvider: no more canned responses (call #${turnIndex + 1}, only ${this.turns.length} turn(s) available)`,
      );
    }
    for (const chunk of turn.chunks) {
      yield chunk;
    }
  }

  // Satisfy ProviderManager.normalizeRuntimeInputs auth validation so the
  // provider doesn't need a real API key or OAuth token.
  async getAuthToken(): Promise<string> {
    return 'fake-auth-token';
  }

  async getModels(): Promise<IModel[]> {
    return [
      {
        id: 'fake-model',
        name: 'fake-model',
        provider: 'fake',
        supportedToolFormats: ['auto'],
      },
    ];
  }

  getDefaultModel(): string {
    return 'fake-model';
  }

  getCurrentModel(): string {
    return 'fake-model';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(): Promise<unknown> {
    throw new Error('FakeProvider does not support server tools');
  }
}
