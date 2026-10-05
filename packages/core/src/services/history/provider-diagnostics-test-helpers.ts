import { forbidHistoryMaterializationForTest } from '../../test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, vi } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigurationManager } from '@vybestack/llxprt-code-telemetry/debug/ConfigurationManager.js';
import { FileOutput } from '@vybestack/llxprt-code-telemetry/debug/FileOutput.js';
import { DebugLogger, type LogEntry } from '../../debug/index.js';
import type { IContent } from './IContent.js';
import { HistoryService } from './HistoryService.js';
import { providerFixtureRow } from './provider-curated-test-helpers.js';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import { buildProviderContent } from './historyProviderPipeline.js';
import { buildCuratedHistory } from './historyCuration.js';

const oracleLogger = new DebugLogger('llxprt:history:service');

export type Diagnostic = Pick<LogEntry, 'level' | 'message' | 'args'>;
export function useDiagnosticSink(): () => Diagnostic[] {
  let entries: Diagnostic[] = [];
  beforeEach(() => {
    ConfigurationManager.getInstance().setEphemeralConfig({
      enabled: true,
      namespaces: ['llxprt:history:service'],
      output: 'file',
      redactPatterns: ['token', 'password'],
    });
    vi.spyOn(FileOutput.prototype, 'write').mockImplementation(
      async (entry) => {
        entries.push(
          JSON.parse(
            JSON.stringify({
              level: entry.level,
              message: entry.message,
              args: entry.args,
            }),
          ),
        );
      },
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await DebugLogger.resetForTesting();
  });
  return () => {
    const result = entries;
    entries = [];
    return result;
  };
}

export class DiagnosticsCursorHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'eager diagnostics preparation');
  }
}

export function diagnosticsRow(index: number, bytes = 2048): IContent {
  const row = providerFixtureRow(index, bytes);
  return {
    ...row,
    metadata: { ...row.metadata, cacheAnchor: index % 8 === 6 },
  };
}

export async function providerDigest(
  rows: Iterable<IContent> | AsyncIterable<IContent>,
): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows) hash.update(JSON.stringify(row) + '\n');
  return hash.digest('hex');
}

export function saveDiagnostics(name: string, value: unknown): void {
  const output = process.env.PROVIDER_DIAGNOSTICS_OUTPUT;
  if (!output) return;
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, `${name}.json`), JSON.stringify(value, null, 2));
}

export function manyBlocksRow(): IContent {
  return {
    speaker: 'ai',
    blocks: Array.from({ length: 8192 }, () => ({
      type: 'text',
      text: 'safe prefix '.repeat(100) + 'PRIVATE_PAYLOAD',
    })),
  };
}
export function captureEagerDiagnostics(
  input: readonly IContent[],
  take: () => Diagnostic[],
  compressing = false,
): { rows: IContent[]; events: Diagnostic[] } {
  const rows = buildProviderContent(
    buildCuratedHistory(oracleLogger, input, compressing),
    [],
    oracleLogger,
  );
  return { rows, events: take() };
}

export async function captureMixedDiagnostics(
  size: number,
  take: () => Diagnostic[],
): Promise<{
  actual: string;
  expected: string;
  oldEvents: Diagnostic[];
  newEvents: Diagnostic[];
}> {
  const pending: IContent[] = [
    {
      speaker: 'human',
      blocks: [
        {
          type: 'tool_response',
          callId: 'dangling',
          toolName: 'lost',
          result: 'PRIVATE_RESULT',
        },
      ],
    },
  ];
  const expected = await providerDigest(
    buildProviderContent(
      buildCuratedHistory(
        oracleLogger,
        Array.from({ length: size }, (_, i) => diagnosticsRow(i)),
        false,
      ),
      pending,
      oracleLogger,
    ),
  );
  const oldEvents = take();
  return withSuffixFixture(
    size,
    async (history) => {
      const actual = await providerDigest(
        history.getCuratedForProviderStream(pending),
      );
      const newEvents = take();
      const result = { oldEvents, newEvents, expected, actual };
      saveDiagnostics(`mixed-${size}`, result);
      return result;
    },
    2048,
    diagnosticsRow,
    undefined,
    (options) => new DiagnosticsCursorHistory(options),
  );
}

export function expectedMixedSummary(size: number): Record<string, unknown> {
  return {
    totalHistory: size,
    curatedCount: (size / 8) * 7,
    breakdown: {
      aiMessages: {
        total: (size / 8) * 3,
        included: (size / 8) * 2,
        excluded: size / 8,
        exclusionRate: '33.3%',
      },
      humanMessages: size / 8,
      toolMessages: size / 2,
    },
    toolActivity: {
      toolCallsInCurated: size / 4,
      toolResponsesInCurated: size / 2,
    },
    isCompressing: false,
  };
}
