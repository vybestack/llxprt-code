/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { ProjectionRuntime } from './__tests__/support/projection-ownership-fixture.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';
import { replayableContents } from '../utils/collectContents.js';
import {
  onlySnapshot,
  reopenSnapshot,
  snapshotWorkspaces,
  singleAttemptOptions,
  registerProjectionWorkspace,
  withWorkspaceRuntime,
  workspaceBody,
  workspaceRows,
} from './__tests__/support/projection-workspace-fixture.js';

async function drain(stream: AsyncIterableIterator<IContent>): Promise<void> {
  for await (const _row of stream) {
    /* Consume the actual SSE response. */
  }
}

async function requireRetiredToken(
  setup: ProjectionRuntime,
  options: GenerateChatOptions,
): Promise<void> {
  const stream = setup.provider.generateChatCompletion(options);
  try {
    await expect(stream.next()).rejects.toThrow(
      'Unknown OpenAI Responses prompt-envelope transport token',
    );
  } finally {
    await stream.return?.();
  }
}

const root = registerProjectionWorkspace();

describe('actual Responses workspace large rows and token retirement', () => {
  it('sends a valid row above 10 MiB byte-for-byte and removes its transferred workspace', async () => {
    await withWorkspaceRuntime(root(), async (setup, http) => {
      const text = 'large "row" \\ 雪.'.repeat(800_000);
      const row: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text }],
      };
      expect(Buffer.byteLength(text)).toBeGreaterThan(10 * 1024 * 1024);
      const rows = {
        count: 1,
        async *openReader(): AsyncGenerator<IContent, void> {
          yield row;
        },
      };
      const options = setup.options(rows);
      const projection = await setup.provider.projectPromptEnvelope(options);
      const name = onlySnapshot(root());
      const stream = setup.provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      });
      try {
        expect(reopenSnapshot(root(), name)).toStrictEqual([row]);
        http.readBody.release();
        http.respond.release();
        await drain(stream);
        expect(http.observations).toStrictEqual([
          { snapshots: [name], ...workspaceBody([row]) },
        ]);
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
        expect(activeRequestBodyCount()).toBe(0);
      } finally {
        await stream.return?.();
        await projection.releaseIfUnsent?.();
      }
    });
  });

  it('rejects an unused released token before any actual HTTP request', async () => {
    await withWorkspaceRuntime(root(), async (setup, http) => {
      const source = workspaceRows();
      const options = setup.options(source.rows);
      const projection = await setup.provider.projectPromptEnvelope(options);
      http.readBody.release();
      http.respond.release();
      await projection.releaseIfUnsent?.();
      await requireRetiredToken(setup, {
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      });
      expect(http.observations).toStrictEqual([]);
      expect(source.state.opened).toBe(1);
    });
  });
});

describe('actual Responses unused projection workspace', () => {
  it('keeps reopenable snapshot rows while live, then unused release removes the workspace and retires its token', async () => {
    await withWorkspaceRuntime(root(), async (setup) => {
      const source = workspaceRows();
      const options = setup.options(source.rows);
      const projection = await setup.provider.projectPromptEnvelope(options);
      const name = onlySnapshot(root());
      try {
        expect([
          reopenSnapshot(root(), name),
          reopenSnapshot(root(), name),
        ]).toStrictEqual([source.expected, source.expected]);
        expect(source.state).toStrictEqual({ active: 0, opened: 1, pulled: 2 });
        await projection.releaseIfUnsent?.();
        await projection.releaseIfUnsent?.();
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
        expect(activeRequestBodyCount()).toBe(0);
        await requireRetiredToken(setup, {
          ...options,
          promptEnvelopeTransportToken: projection.transportToken,
        });
      } finally {
        await projection.releaseIfUnsent?.();
      }
    });
  });
});

describe('actual Responses sent projection workspace', () => {
  it.each(['done', 'return'])(
    'transfers ownership on send and keeps the workspace until response %s',
    async (ending) => {
      await withWorkspaceRuntime(root(), async (setup, http) => {
        const source = workspaceRows();
        const options = setup.options(source.rows);
        const projection = await setup.provider.projectPromptEnvelope(options);
        const name = onlySnapshot(root());
        const sentOptions = {
          ...options,
          promptEnvelopeTransportToken: projection.transportToken,
        };
        const stream = setup.provider.generateChatCompletion(sentOptions);
        try {
          const first = stream.next();
          await http.arrived.wait;
          await projection.releaseIfUnsent?.();
          expect({
            workspaces: snapshotWorkspaces(root()),
            bodyLeases: activeRequestBodyCount(),
            uploads: http.observations,
          }).toStrictEqual({
            workspaces: [name],
            bodyLeases: 1,
            uploads: [],
          });
          expect(reopenSnapshot(root(), name)).toStrictEqual(source.expected);
          http.readBody.release();
          await http.uploaded.wait;
          expect({
            workspaces: snapshotWorkspaces(root()),
            uploads: http.observations,
          }).toStrictEqual({
            workspaces: [name],
            uploads: [{ snapshots: [name], ...workspaceBody(source.expected) }],
          });
          http.respond.release();
          expect({
            done: (await first).done,
            workspaces: snapshotWorkspaces(root()),
            bodyLeases: activeRequestBodyCount(),
          }).toStrictEqual({ done: false, workspaces: [name], bodyLeases: 1 });
          if (ending === 'done') await drain(stream);
          else await stream.return?.();
          expect(snapshotWorkspaces(root())).toStrictEqual([]);
          expect(activeRequestBodyCount()).toBe(0);
          expect(http.observations).toStrictEqual([
            { snapshots: [name], ...workspaceBody(source.expected) },
          ]);
          await requireRetiredToken(setup, sentOptions);
        } finally {
          http.readBody.release();
          http.respond.release();
          await stream.return?.();
          await projection.releaseIfUnsent?.();
        }
      });
    },
  );
});

describe('actual Responses aborted projection workspace', () => {
  it('cleans the transferred snapshot on abort while the actual receiver is paused', async () => {
    await withWorkspaceRuntime(root(), async (setup, http) => {
      const controller = new AbortController();
      const source = workspaceRows();
      const options = setup.options(source.rows, controller.signal);
      const projection = await setup.provider.projectPromptEnvelope(options);
      const stream = setup.provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      });
      try {
        const pending = stream.next();
        const outcome = pending.then(
          () => 'unexpected response',
          (error: unknown) =>
            error instanceof Error ? error.message : String(error),
        );
        await http.arrived.wait;
        controller.abort(new Error('workspace upload cancelled'));
        expect(await outcome).toBe('workspace upload cancelled');
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
        expect(activeRequestBodyCount()).toBe(0);
        expect(source.state.active).toBe(0);
      } finally {
        http.readBody.release();
        http.respond.release();
        await stream.return?.();
        await projection.releaseIfUnsent?.();
      }
    });
  });
});

describe('actual Responses failed projection preparation', () => {
  it.each(['source', 'abort', 'finalized'])(
    'cleans partial projection resources when %s preparation fails',
    async (failure) => {
      await withWorkspaceRuntime(root(), async (setup) => {
        const controller = new AbortController();
        const source = workspaceRows(
          failure === 'finalized'
            ? undefined
            : () => {
                if (failure === 'abort')
                  controller.abort(new Error('projection source cancelled'));
                else throw new Error('projection source failed');
              },
        );
        const options = setup.options(source.rows, controller.signal);
        const preparation = setup.provider.projectPromptEnvelope({
          ...options,
          ...(failure === 'finalized'
            ? {
                tools: [
                  {
                    name: 'invalid_default',
                    parametersJsonSchema: { type: 'object', default: 1n },
                  },
                ],
              }
            : {}),
        });
        const expectedErrors: Readonly<Record<string, string>> = {
          source: 'projection source failed',
          abort: 'projection source cancelled',
          finalized: 'BigInt',
        };
        await expect(preparation).rejects.toThrow(expectedErrors[failure]);
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
        expect(source.state.active).toBe(0);
        expect(activeRequestBodyCount()).toBe(0);
      });
    },
  );
});

describe('actual Responses in-transport retry workspace', () => {
  it('retries byte-identical BODY while owned and a later projection acquires a fresh owner with no orphan', async () => {
    await withWorkspaceRuntime(
      root(),
      async (setup, http) => {
        const source = workspaceRows();
        const options = setup.options(source.rows);
        const firstProjection =
          await setup.provider.projectPromptEnvelope(options);
        const firstOwner = onlySnapshot(root());
        const stream = setup.provider.generateChatCompletion({
          ...options,
          promptEnvelopeTransportToken: firstProjection.transportToken,
        });
        http.readBody.release();
        http.respond.release();
        try {
          await drain(stream);
          expect({
            workspaces: snapshotWorkspaces(root()),
            bodyLeases: activeRequestBodyCount(),
            uploads: http.observations,
          }).toStrictEqual({
            workspaces: [],
            bodyLeases: 0,
            uploads: [
              { snapshots: [firstOwner], ...workspaceBody(source.expected) },
              { snapshots: [firstOwner], ...workspaceBody(source.expected) },
            ],
          });
          const nextProjection =
            await setup.provider.projectPromptEnvelope(options);
          const nextOwner = onlySnapshot(root());
          try {
            expect(nextProjection.transportToken).not.toBe(
              firstProjection.transportToken,
            );
            expect(nextOwner).not.toBe(firstOwner);
            expect(reopenSnapshot(root(), nextOwner)).toStrictEqual(
              source.expected,
            );
            const nextStream = setup.provider.generateChatCompletion({
              ...options,
              promptEnvelopeTransportToken: nextProjection.transportToken,
            });
            try {
              await drain(nextStream);
            } finally {
              await nextStream.return?.();
            }
            expect(http.observations).toStrictEqual([
              { snapshots: [firstOwner], ...workspaceBody(source.expected) },
              { snapshots: [firstOwner], ...workspaceBody(source.expected) },
              { snapshots: [nextOwner], ...workspaceBody(source.expected) },
            ]);
            expect(snapshotWorkspaces(root())).toStrictEqual([]);
            expect(activeRequestBodyCount()).toBe(0);
          } finally {
            await nextProjection.releaseIfUnsent?.();
          }
        } finally {
          await stream.return?.();
          await firstProjection.releaseIfUnsent?.();
        }
      },
      true,
    );
  });
});

describe('actual Responses failed-attempt retry workspace', () => {
  it('a retry after a failed sent attempt acquires a different owner and sends the same BODY without an orphan', async () => {
    await withWorkspaceRuntime(
      root(),
      async (setup, http) => {
        const source = workspaceRows();
        const options = singleAttemptOptions(setup.options(source.rows));
        const failed = await setup.provider.projectPromptEnvelope(options);
        const firstOwner = onlySnapshot(root());
        const firstStream = setup.provider.generateChatCompletion({
          ...options,
          promptEnvelopeTransportToken: failed.transportToken,
        });
        http.readBody.release();
        http.respond.release();
        try {
          await expect(firstStream.next()).rejects.toThrow('retry');
          expect({
            workspaces: snapshotWorkspaces(root()),
            bodyLeases: activeRequestBodyCount(),
            uploads: http.observations,
          }).toStrictEqual({
            workspaces: [],
            bodyLeases: 0,
            uploads: [
              { snapshots: [firstOwner], ...workspaceBody(source.expected) },
            ],
          });
          const retried = await setup.provider.projectPromptEnvelope(options);
          const retryOwner = onlySnapshot(root());
          const retryStream = setup.provider.generateChatCompletion({
            ...options,
            promptEnvelopeTransportToken: retried.transportToken,
          });
          try {
            expect(retried.transportToken).not.toBe(failed.transportToken);
            expect(retryOwner).not.toBe(firstOwner);
            await drain(retryStream);
            expect(http.observations).toStrictEqual([
              { snapshots: [firstOwner], ...workspaceBody(source.expected) },
              { snapshots: [retryOwner], ...workspaceBody(source.expected) },
            ]);
            expect(snapshotWorkspaces(root())).toStrictEqual([]);
            expect(activeRequestBodyCount()).toBe(0);
          } finally {
            await retryStream.return?.();
            await retried.releaseIfUnsent?.();
          }
        } finally {
          await firstStream.return?.();
          await failed.releaseIfUnsent?.();
        }
      },
      true,
    );
  });
});

describe('actual Responses projection cleanup failures', () => {
  it('preserves source and disposal errors together while removing the failed snapshot', async () => {
    await withWorkspaceRuntime(root(), async (setup) => {
      let pulled = 0;
      const row: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'before failure' }],
      };
      const contents: AsyncIterable<IContent> = {
        [Symbol.asyncIterator](): AsyncIterator<IContent> {
          return {
            async next(): Promise<IteratorResult<IContent>> {
              if (pulled++ === 0) return { done: false, value: row };
              throw new Error('source primary error');
            },
            async return(): Promise<IteratorResult<IContent>> {
              throw new Error('source disposal error');
            },
          };
        },
      };
      const options = {
        ...setup.options(workspaceRows().rows),
        contents,
        requestRows: undefined,
      };
      const outcome = await setup.provider.projectPromptEnvelope(options).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(outcome).toBeInstanceOf(AggregateError);
      if (!(outcome instanceof AggregateError))
        throw new Error('Expected both failure causes');
      expect(
        outcome.errors.map((error: unknown) =>
          error instanceof Error ? error.message : String(error),
        ),
      ).toStrictEqual(['source primary error', 'source disposal error']);
      expect(snapshotWorkspaces(root())).toStrictEqual([]);
      expect(activeRequestBodyCount()).toBe(0);
    });
  });
});

describe('actual Responses disabled media workspace', () => {
  it('releases a snapshot containing disabled PDF media without changing unsupported-media reporting', async () => {
    await withWorkspaceRuntime(root(), async (setup) => {
      const rows = {
        count: 1,
        async *openReader(): AsyncGenerator<IContent, void> {
          yield {
            speaker: 'human',
            blocks: [
              {
                type: 'media',
                mimeType: 'application/pdf',
                data: 'JVBERi0=',
                encoding: 'base64',
                filename: 'disabled.pdf',
              },
            ],
          };
        },
      };
      const options = setup.options(rows);
      options.settings?.set('media.pdf.enabled', false);
      const eagerRows: IContent[] = [];
      for await (const row of rows.openReader()) eagerRows.push(row);
      const eager = await setup.provider.projectPromptEnvelope({
        ...options,
        contents: replayableContents(eagerRows),
      });
      try {
        expect(
          eager.unsupportedMedia.map((entry) => entry.mediaType),
        ).toStrictEqual(['pdf']);
      } finally {
        await eager.releaseIfUnsent?.();
      }
      const projection = await setup.provider.projectPromptEnvelope(options);
      try {
        onlySnapshot(root());
        expect(projection.finalizedProjection).toStrictEqual(
          eager.finalizedProjection,
        );
        await projection.releaseIfUnsent?.();
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
        expect(activeRequestBodyCount()).toBe(0);
      } finally {
        await projection.releaseIfUnsent?.();
      }
    });
  });
});
