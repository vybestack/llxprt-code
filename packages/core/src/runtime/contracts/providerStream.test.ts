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
 * @plan PLAN-20260917-ISSUE854.P05
 * @requirement G6, G2
 *
 * RED session for P05b3 (implementation-plan.md §6): the provider-facing
 * history contracts become streaming. HistoryService holds no array, so
 * provider assembly is a pass over the journal — rows flow through
 * JournalCursor → JournalResolver → provider transformer with nothing held
 * in memory (issue-854-design.md §5c).
 *
 * Pinned contracts (assumed surface, named for the green session):
 *
 *   RuntimeGenerateChatOptions.contents: AsyncIterable<IContent>
 *     (today: IContent[] — the array contract this session deletes)
 *   RuntimeProvider.generateChatCompletion(...): the history parameter is
 *     async-iterable; no overload declares an IContent[] history parameter
 *   HistoryService.getCuratedForProviderStream(tailContents?: IContent[]):
 *     AsyncIterable<IContent>
 *     — yields the same sequence getCuratedForProvider() builds today from
 *       the same rows: the eager reference in these tests applies the exact
 *       helper chain of the current sync method (buildCuratedHistory →
 *       buildProviderContent) to a full JournalResolver fold, so equivalence
 *       against it is equivalence against today's array result.
 *
 * Where a provider SDK needs a request body array, the transport builds it
 * request-scoped from the stream and releases it after the call (P05b4 owns
 * the transport side; this file pins the core contract).
 *
 * No production code is modified in this session.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import ts from 'typescript';
import { HistoryService } from '../../services/history/HistoryService.js';
import type { IContent } from '../../services/history/IContent.js';
import { buildCuratedHistory } from '../../services/history/historyCuration.js';
import { buildProviderContent } from '../../services/history/historyProviderPipeline.js';
import { DebugLogger } from '../../debug/index.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import {
  JournalResumeBoot,
  resumePointOf,
} from '../../recording/journalResume.js';
import { JournalSession } from '../../services/history/journalSession.js';

const PROJECT_HASH = 'p05b3-provider-stream-hash';

function textContent(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function toolCallContent(callId: string, text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text },
      { type: 'tool_call', id: callId, name: 'runner', parameters: { q: 1 } },
    ],
  };
}

function toolResponseContent(callId: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName: 'runner',
        result: { ok: true },
      },
    ],
  };
}

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

interface ProjectedRow {
  readonly speaker: IContent['speaker'];
  readonly text: string;
}

function project(contents: readonly IContent[]): ProjectedRow[] {
  return contents.map((content) => ({
    speaker: content.speaker,
    text: textOf(content),
  }));
}

let tempDir: string;
const logger = new DebugLogger('llxprt:test:providerStream');

const histories: HistoryService[] = [];
const recordings: JournalRecordingService[] = [];

function makeRecorder(id: string): JournalRecordingService {
  const recorder = JournalRecordingService.create({
    sessionId: `p05b3-stream-${id}`,
    projectHash: PROJECT_HASH,
    chatsDir: tempDir,
    workspaceDirs: [tempDir],
    provider: 'test-provider',
    model: 'test-model',
  });
  recordings.push(recorder);
  return recorder;
}

async function resumedHistory(
  recorder: JournalRecordingService,
): Promise<HistoryService> {
  const service = new HistoryService({});
  histories.push(service);
  await service.adoptResumeBoot(
    recorder,
    new JournalResumeBoot(recorder, await resumePointOf(recorder)),
  );
  return service;
}

/** Seeds native rows through the durable write path. */
async function seedJournal(
  id: string,
  contents: readonly IContent[],
): Promise<JournalRecordingService> {
  const recorder = makeRecorder(id);
  await (await recorder.session()).append(contents);
  await recorder.flush();
  expect(recorder.getFilePath()).not.toBeNull();
  return recorder;
}

/** Reads the durable rows independently before applying the assembly helpers. */
async function eagerReference(
  filePath: string,
): Promise<{ readonly rows: ProjectedRow[]; readonly contents: IContent[] }> {
  const session = await JournalSession.open(filePath);
  const rows: IContent[] = [];
  try {
    for await (const entry of session.rows()) {
      rows.push(entry.content);
    }
  } finally {
    await session.close();
  }
  // Exactly the chain getCuratedForProvider() runs today over the array.
  const curated = buildCuratedHistory(logger, rows, false);
  const assembled = buildProviderContent(curated, [], logger);
  return { rows: project(assembled), contents: assembled };
}

// ---------------------------------------------------------------------------
// B.6 — Type-level pin: provider history parameters are async-iterable
// ---------------------------------------------------------------------------

/**
 * True when a type node is an array of IContent (the contract this session
 * deletes). Async iterables of IContent never match.
 */
function isArrayIContentType(
  typeNode: ts.Node,
  source: ts.SourceFile,
): boolean {
  const typeText = typeNode.getText(source);
  const isArray =
    /\[\s*\]/.test(typeText) ||
    /\bArray\s*</.test(typeText) ||
    /\bReadonlyArray\s*</.test(typeText);
  if (!isArray) return false;
  return !/\bAsync(?:Iterable|Generator|Iterator)\s*</.test(typeText);
}

/**
 * Names of the parameters (recursively, including function-type parameters)
 * inside `interfaceName.methodName` whose type is an array of IContent.
 * Scoping to one method keeps unrelated array contracts (e.g. the
 * compression-guard callback) out of this pin's blast radius.
 */
function findArrayTypeParameterNames(
  sourceText: string,
  interfaceName: string,
  methodName: string,
): string[] {
  const source = ts.createSourceFile(
    'probe.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const offenders: string[] = [];
  const visitParameters = (node: ts.Node): void => {
    if (
      ts.isParameter(node) &&
      node.type !== undefined &&
      isArrayIContentType(node.type, source)
    ) {
      offenders.push(node.name.getText(source));
    }
    ts.forEachChild(node, visitParameters);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (
          ts.isMethodSignature(member) &&
          member.name.getText(source) === methodName
        ) {
          ts.forEachChild(member, visitParameters);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return offenders;
}

describe('provider history streaming contract (P05b3)', () => {
  it('RuntimeGenerateChatOptions.contents is an async iterable of IContent', async () => {
    const sourcePath = path.join(import.meta.dir, 'RuntimeProviderChat.ts');
    const sourceText = await fs.readFile(sourcePath, 'utf8');
    const source = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
    );

    let contentsType: string | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isInterfaceDeclaration(node) &&
        node.name.text === 'RuntimeGenerateChatOptions'
      ) {
        for (const member of node.members) {
          if (
            ts.isPropertySignature(member) &&
            member.name.getText(source) === 'contents'
          ) {
            contentsType = member.type?.getText(source);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);

    expect(contentsType).toBeDefined();
    // The array contract must be gone; the streaming contract must be here.
    expect(contentsType ?? '').toMatch(/\bAsync(?:Iterable|Generator)\s*</);
    expect(contentsType ?? '').not.toMatch(/\[\s*\]|\bArray\s*</);
    expect(contentsType).toBe('AsyncIterable<IContent>');
  });

  it('no RuntimeProvider.generateChatCompletion overload takes an IContent[] history parameter', async () => {
    const sourcePath = path.join(import.meta.dir, 'RuntimeProvider.ts');
    const sourceText = await fs.readFile(sourcePath, 'utf8');
    const offenders = findArrayTypeParameterNames(
      sourceText,
      'RuntimeProvider',
      'generateChatCompletion',
    );
    // The contract: generateChatCompletion carries no IContent[] history
    // parameter on any overload. Today the second overload declares
    // `content: IContent[]`, so this fails until the flip.
    expect(offenders).toStrictEqual([]);
  });

  it('type predicate flags array parameters and accepts async iterables (negative controls)', () => {
    const arrayStub = [
      'interface Probe {',
      '  probe(contents: IContent[], fallback: Array<IContent>): void;',
      '  streaming(raw: AsyncIterable<IContent>): void;',
      '}',
    ].join('\n');
    expect(
      findArrayTypeParameterNames(arrayStub, 'Probe', 'probe'),
    ).toStrictEqual(['contents', 'fallback']);
    expect(
      findArrayTypeParameterNames(arrayStub, 'Probe', 'streaming'),
    ).toStrictEqual([]);

    const streamingStub = [
      'interface Probe {',
      '  probe(contents: AsyncIterable<IContent>): void;',
      '}',
    ].join('\n');
    expect(
      findArrayTypeParameterNames(streamingStub, 'Probe', 'probe'),
    ).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B.7 — getCuratedForProviderStream: streaming equivalence with the eager
// full-fold reference (which equals today's array result for the same rows)
// ---------------------------------------------------------------------------

describe('getCuratedForProviderStream equivalence (P05b3)', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p05b3-stream-'));
  });

  afterEach(async () => {
    for (const history of histories.splice(0)) await history.dispose();
    for (const recorder of recordings.splice(0)) await recorder.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('yields the same sequence as the eager full-fold reference for a seeded journal', async () => {
    const seeded: IContent[] = [
      textContent('human', 'plan the fix'),
      toolCallContent('call-7', 'running build'),
      toolResponseContent('call-7'),
      textContent('ai', 'build is green'),
      textContent('human', 'ship it'),
    ];
    const recorder = await seedJournal('equivalence', seeded);

    const service = await resumedHistory(recorder);
    await service.waitForCommit();

    const streamed: IContent[] = [];
    for await (const row of service.getCuratedForProviderStream()) {
      streamed.push(row);
    }

    const file = recorder.getFilePath();
    if (file === null) throw new Error('Missing native recording');
    const reference = await eagerReference(file);
    expect(project(streamed)).toStrictEqual(reference.rows);
    // Sanity: the journal actually carried the seeded conversation.
    expect(reference.rows.length).toBeGreaterThanOrEqual(seeded.length);
  }, 20000);

  it('sanitizes cyclic tool-call parameters in the stream without mutating stored rows', async () => {
    const service = await resumedHistory(makeRecorder('cyclic'));
    interface CyclicValue {
      label: string;
      self?: CyclicValue;
    }
    const parameters: CyclicValue = { label: 'parameters' };
    parameters.self = parameters;
    service.add({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'stream-cyclic-pin',
          name: 'cyclic_tool',
          parameters,
        },
      ],
    });
    await service.waitForCommit();

    const streamed: IContent[] = [];
    for await (const row of service.getCuratedForProviderStream()) {
      streamed.push(row);
    }

    expect(() => JSON.stringify(streamed)).not.toThrow();
    expect(JSON.stringify(streamed)).toContain('"_circular":true');
    // The row the caller handed over is untouched.
    expect(parameters.self).toBe(parameters);
  }, 20000);
});
