import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DensityConfig } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';

export class DensityDiskHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'density materialization forbidden',
    );
  }
}

export function densityConfig(mask = 7): DensityConfig {
  return {
    readWritePruning: (mask & 1) !== 0,
    fileDedupe: (mask & 2) !== 0,
    recencyPruning: (mask & 4) !== 0,
    recencyRetention: 3,
    workspaceRoot: process.cwd(),
  };
}
export function densityHandler(
  history: HistoryService,
  mask = 7,
): CompressionHandler {
  history.setTokenizerFactory(exactTokenizer());
  const config = densityConfig(mask);
  return new CompressionHandler(
    buildRuntimeContext(history, {
      compressionStrategy: 'high-density',
      contextLimit: 100,
      'compression.density.optimizeThreshold': 0,
      'compression.density.readWritePruning': config.readWritePruning,
      'compression.density.fileDedupe': config.fileDedupe,
      'compression.density.recencyPruning': config.recencyPruning,
      'compression.density.recencyRetention': config.recencyRetention,
    }),
    history,
    {},
    () => {
      throw new Error('density must not resolve an LLM');
    },
    async () => {},
  );
}

export function densityRow(index: number, bytes = 2048): IContent {
  const path = `density-file-${Math.floor(index / 12) % 31}.ts`;
  const callId = `duplicate-${Math.floor(index / 12) % 19}`;
  const text = `${index}:${'x'.repeat(bytes)}`;
  const phase = index % 12;
  const metadata = {
    id: `density-${index}`,
    chronology: {
      seq: index + 1,
      userTurn: Math.floor(index / 12) + 1,
      step: phase,
      recordedAt: 0,
    },
    ...(phase === 1 || phase === 3
      ? { responsesStored: true, cacheAnchor: index === 1 }
      : {}),
  };
  if (phase === 1 || phase === 3)
    return {
      speaker: 'ai',
      metadata,
      blocks: [
        {
          type: 'tool_call',
          id: phase === 1 ? callId : `write-${index}`,
          name: phase === 1 ? 'read_file' : 'write_file',
          parameters: { file_path: path, content: text },
        },
        ...(index % 24 === 1 ? [{ type: 'text' as const, text }] : []),
      ],
    };
  if (phase === 2 || phase === 4 || phase === 8)
    return {
      speaker: 'tool',
      metadata,
      blocks: [
        {
          type: 'tool_response',
          callId: phase === 2 ? callId : `write-${index - 1}`,
          toolName: phase === 2 ? 'read_file' : 'write_file',
          result: { text, nested: [index] },
          ...(phase === 8 ? { error: 'external failure' } : {}),
        },
        ...(phase === 8 ? [{ type: 'text' as const, text: 'side text' }] : []),
      ],
    };
  return {
    speaker: phase === 7 ? 'ai' : 'human',
    metadata,
    blocks: [
      {
        type: 'text',
        text:
          phase === 0 || phase === 6
            ? `${text}\n--- ${path} ---\nfirst\n--- End of content ---\n--- ${path} ---\nsecond\n--- End of content ---\n`
            : text,
      },
      ...(phase === 5
        ? [
            {
              type: 'media' as const,
              encoding: 'base64' as const,
              mimeType: 'audio/wav',
              data: 'aGVsbG8=',
              caption: String(index),
            },
          ]
        : []),
    ],
  };
}

export function densityOracle(size: number, mask = 7): IContent[] {
  const rows = Array.from({ length: size }, (_, index) => densityRow(index));
  const result = new HighDensityStrategy().optimize(rows, densityConfig(mask));
  const removed = new Set(result.removals);
  if (result.removals.length === 0 && result.replacements.size === 0)
    return rows;
  return [
    ...invalidateResponsesStatefulChain(
      rows.flatMap((row, index) =>
        removed.has(index) ? [] : [result.replacements.get(index) ?? row],
      ),
    ),
  ];
}
export function digestRows(rows: Iterable<IContent>): string {
  const hash = createHash('sha256');
  for (const row of rows)
    hash.update(
      JSON.stringify({
        speaker: row.speaker,
        blocks: row.blocks,
        metadata: row.metadata,
      }) + '\n',
    );
  return hash.digest('hex');
}
export async function digestStream(
  rows: AsyncIterable<IContent>,
): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows)
    hash.update(
      JSON.stringify({
        speaker: row.speaker,
        blocks: row.blocks,
        metadata: row.metadata,
      }) + '\n',
    );
  return hash.digest('hex');
}
