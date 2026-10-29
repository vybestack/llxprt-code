/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { ProjectionRuntime } from './__tests__/support/projection-ownership-fixture.js';
import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import {
  projectSourcePrompt,
  sourcePromptText,
} from './__tests__/support/source-prompt-text.js';
import {
  promptKeyWorkspaces,
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

describe('actual Responses native large rows and token retirement', () => {
  it('sends a valid row above 10 MiB byte-for-byte without scratch workspaces', async () => {
    await withWorkspaceRuntime(root(), async (setup, http) => {
      const text = 'large "row" \\ 雪.'.repeat(800_000);
      const row: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text }],
      };
      expect(Buffer.byteLength(text)).toBeGreaterThan(10 * 1024 * 1024);
      const rows = {
        count: 1,
        readAt: () => row,
        async *openReader(): AsyncGenerator<IContent, void> {
          yield row;
        },
      };
      const options = setup.options(rows);
      const projection = await projectSourcePrompt(setup.provider, options);
      expect(snapshotWorkspaces(root())).toStrictEqual([]);
      const stream = setup.provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      });
      try {
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
        http.readBody.release();
        http.respond.release();
        await drain(stream);
        expect(http.observations).toStrictEqual([
          { snapshots: [], ...workspaceBody([row]) },
        ]);
        expect(promptKeyWorkspaces(root())).toStrictEqual([]);
        await setup.closeRows();
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
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
      const projection = await projectSourcePrompt(setup.provider, options);
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

describe('actual Responses unused native projection', () => {
  it('keeps reopenable journal rows while live, then unused release retires its token without scratch workspaces', async () => {
    await withWorkspaceRuntime(root(), async (setup) => {
      const source = workspaceRows();
      const options = setup.options(source.rows);
      const projection = await projectSourcePrompt(setup.provider, options);
      expect(snapshotWorkspaces(root())).toStrictEqual([]);
      try {
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
        expect(promptKeyWorkspaces(root())).toStrictEqual([]);
        expect(source.state).toStrictEqual({ active: 0, opened: 1, pulled: 2 });
        await projection.releaseIfUnsent?.();
        await projection.releaseIfUnsent?.();
        expect(promptKeyWorkspaces(root())).toStrictEqual([]);
        await requireRetiredToken(setup, {
          ...options,
          promptEnvelopeTransportToken: projection.transportToken,
        });
        await setup.closeRows();
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
      } finally {
        await projection.releaseIfUnsent?.();
      }
    });
  });
});

describe('actual Responses sent native projection', () => {
  it.each(['done', 'return'])(
    'transfers ownership on send without scratch workspaces through response %s',
    async (ending) => {
      await withWorkspaceRuntime(root(), async (setup, http) => {
        const source = workspaceRows();
        const options = setup.options(source.rows);
        const projection = await projectSourcePrompt(setup.provider, options);
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
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
            promptKeysLive: promptKeyWorkspaces(root()).length > 0,
            uploads: http.observations,
          }).toStrictEqual({
            workspaces: [],
            promptKeysLive: false,
            uploads: [],
          });
          http.readBody.release();
          await http.uploaded.wait;
          expect({
            workspaces: snapshotWorkspaces(root()),
            uploads: http.observations,
          }).toStrictEqual({
            workspaces: [],
            uploads: [{ snapshots: [], ...workspaceBody(source.expected) }],
          });
          http.respond.release();
          expect({
            done: (await first).done,
            workspaces: snapshotWorkspaces(root()),
            promptKeysLive: promptKeyWorkspaces(root()).length > 0,
          }).toStrictEqual({
            done: false,
            workspaces: [],
            promptKeysLive: false,
          });
          if (ending === 'done') await drain(stream);
          else await stream.return?.();
          expect(promptKeyWorkspaces(root())).toStrictEqual([]);
          expect(http.observations).toStrictEqual([
            { snapshots: [], ...workspaceBody(source.expected) },
          ]);
          await requireRetiredToken(setup, sentOptions);
          await setup.closeRows();
          expect(snapshotWorkspaces(root())).toStrictEqual([]);
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

describe('actual Responses aborted native projection', () => {
  it('retires the native request on abort while the actual receiver is paused', async () => {
    await withWorkspaceRuntime(root(), async (setup, http) => {
      const controller = new AbortController();
      const source = workspaceRows();
      const options = setup.options(source.rows, controller.signal);
      const projection = await projectSourcePrompt(setup.provider, options);
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
        expect(promptKeyWorkspaces(root())).toStrictEqual([]);
        await setup.closeRows();
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
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
        const preparation = projectSourcePrompt(setup.provider, {
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
        // An abort surfaces as the standard AbortError carrying the reason.
        const expectedErrors: Readonly<Record<string, object>> = {
          source: {
            message: expect.stringContaining('projection source failed'),
          },
          abort: {
            name: 'AbortError',
            cause: { message: 'projection source cancelled' },
          },
          finalized: { message: expect.stringContaining('BigInt') },
        };
        const failed = await preparation.then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(failed).toMatchObject(expectedErrors[failure]);
        await setup.closeRows();
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
        expect(source.state.active).toBe(0);
        expect(promptKeyWorkspaces(root())).toStrictEqual([]);
      });
    },
  );
});

describe('actual Responses in-transport native retry', () => {
  it('retries byte-identical BODY from pinned rows and a later projection reuses the same pin without scratch workspaces', async () => {
    await withWorkspaceRuntime(
      root(),
      async (setup, http) => {
        const source = workspaceRows();
        const options = setup.options(source.rows);
        const firstProjection = await projectSourcePrompt(
          setup.provider,
          options,
        );
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
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
            promptKeys: promptKeyWorkspaces(root()),
            uploads: http.observations,
          }).toStrictEqual({
            workspaces: [],
            promptKeys: [],
            uploads: [
              { snapshots: [], ...workspaceBody(source.expected) },
              { snapshots: [], ...workspaceBody(source.expected) },
            ],
          });
          const nextProjection = await projectSourcePrompt(
            setup.provider,
            options,
          );
          try {
            expect(nextProjection.transportToken).not.toBe(
              firstProjection.transportToken,
            );
            expect(snapshotWorkspaces(root())).toStrictEqual([]);
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
              { snapshots: [], ...workspaceBody(source.expected) },
              { snapshots: [], ...workspaceBody(source.expected) },
              { snapshots: [], ...workspaceBody(source.expected) },
            ]);
            expect(source.state.opened).toBe(1);
            expect(promptKeyWorkspaces(root())).toStrictEqual([]);
            await setup.closeRows();
            expect(snapshotWorkspaces(root())).toStrictEqual([]);
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

describe('actual Responses failed-attempt native retry', () => {
  it('a retry after a failed sent attempt sends the same BODY from pinned rows without scratch workspaces', async () => {
    await withWorkspaceRuntime(
      root(),
      async (setup, http) => {
        const source = workspaceRows();
        const options = singleAttemptOptions(setup.options(source.rows));
        const failed = await projectSourcePrompt(setup.provider, options);
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
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
            promptKeys: promptKeyWorkspaces(root()),
            uploads: http.observations,
          }).toStrictEqual({
            workspaces: [],
            promptKeys: [],
            uploads: [{ snapshots: [], ...workspaceBody(source.expected) }],
          });
          const retried = await projectSourcePrompt(setup.provider, options);
          const retryStream = setup.provider.generateChatCompletion({
            ...options,
            promptEnvelopeTransportToken: retried.transportToken,
          });
          try {
            expect(retried.transportToken).not.toBe(failed.transportToken);
            expect(snapshotWorkspaces(root())).toStrictEqual([]);
            await drain(retryStream);
            expect(http.observations).toStrictEqual([
              { snapshots: [], ...workspaceBody(source.expected) },
              { snapshots: [], ...workspaceBody(source.expected) },
            ]);
            expect(source.state.opened).toBe(1);
            expect(promptKeyWorkspaces(root())).toStrictEqual([]);
            await setup.closeRows();
            expect(snapshotWorkspaces(root())).toStrictEqual([]);
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
  it('preserves the admission failure and source disposal error together without scratch workspaces', async () => {
    await withWorkspaceRuntime(root(), async (setup) => {
      const controller = new AbortController();
      let pulled = 0;
      const row: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'before failure' }],
      };
      const contents = {
        async openProviderRequest() {
          const reader = contents[Symbol.asyncIterator]();
          await reader.next();
          return {
            callerOwned: true,
            count: 1,
            readAt: () => row,
            async *openReader(): AsyncGenerator<IContent, void> {
              yield row;
            },
            async close(): Promise<void> {
              await reader.return?.();
            },
          };
        },
        [Symbol.asyncIterator](): AsyncIterator<IContent> {
          return {
            async next(): Promise<IteratorResult<IContent>> {
              if (pulled++ > 0) throw new Error('source must stay suspended');
              queueMicrotask(() =>
                controller.abort(new Error('source primary error')),
              );
              return { done: false, value: row };
            },
            async return(): Promise<IteratorResult<IContent>> {
              throw new Error('source disposal error');
            },
          };
        },
      };
      const options = {
        ...setup.options(workspaceRows().rows, controller.signal),
        contents,
        requestRows: undefined,
      };
      const outcome = await projectSourcePrompt(setup.provider, options).then(
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
      ).toStrictEqual(['Aborted', 'source disposal error']);
      expect(snapshotWorkspaces(root())).toStrictEqual([]);
      expect(promptKeyWorkspaces(root())).toStrictEqual([]);
    });
  });
});

describe('actual Responses disabled media native projection', () => {
  it('releases a native selection containing disabled PDF media without changing unsupported-media reporting', async () => {
    await withWorkspaceRuntime(root(), async (setup) => {
      const disabledPdf: IContent = {
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
      const rows = {
        count: 1,
        readAt: () => disabledPdf,
        async *openReader(): AsyncGenerator<IContent, void> {
          yield disabledPdf;
        },
      };
      const options = setup.options(rows, undefined, {
        'media.pdf.enabled': false,
      });
      const eagerRows: IContent[] = [];
      for await (const row of rows.openReader()) eagerRows.push(row);
      const eager = await projectSourcePrompt(setup.provider, {
        ...options,
        contents: callerOwnedRawProviderSource(eagerRows),
      });
      let eagerText = '';
      try {
        expect(
          eager.unsupportedMedia.map((entry) => entry.mediaType),
        ).toStrictEqual(['pdf']);
        eagerText = await sourcePromptText(eager);
      } finally {
        await eager.releaseIfUnsent?.();
      }
      const projection = await projectSourcePrompt(setup.provider, options);
      try {
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
        expect(await sourcePromptText(projection)).toBe(eagerText);
        await projection.releaseIfUnsent?.();
        expect(promptKeyWorkspaces(root())).toStrictEqual([]);
        await setup.closeRows();
        expect(snapshotWorkspaces(root())).toStrictEqual([]);
      } finally {
        await projection.releaseIfUnsent?.();
      }
    });
  });
});
