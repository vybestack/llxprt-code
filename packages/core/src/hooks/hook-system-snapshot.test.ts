/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect, spyOn } from 'bun:test';

import * as fs from 'node:fs';

import { join } from 'node:path';

import { Config } from '../config/config.js';

import { HookSystem } from './hookSystem.js';

import {
  HookEventName,
  BeforeModelHookOutput,
  type HookConfig,
} from './types.js';

import { HookDiskText } from './hookOutputSnapshot.js';

import { command, fixture, rich } from './hookRunner-test-helpers.js';

import { providerRequestRows } from '../services/history/provider-request-snapshot.js';

import type { HookSnapshotRows } from './hookOutputSnapshot.js';

const rows = Array.from({ length: 64 }, (_, index) => ({
  ...rich,
  metadata: { ...rich.metadata, id: `row-${index}` },
}));

const readInput = `process.stdin.setEncoding('utf8'); let body='';
  for await (const chunk of process.stdin) body += chunk;
  const input = JSON.parse(body); const request = input.llm_request;`;

function script(action: string): HookConfig {
  return command(`(async () => { ${readInput} ${action} })();`);
}

function system(
  root: string,
  hooks: HookConfig[],
  sequential = true,
): HookSystem {
  return new HookSystem(
    new Config({
      sessionId: 'snapshot-orchestration',
      targetDir: root,
      cwd: root,
      debugMode: false,
      model: 'test',
      trustedFolder: true,
      enableHooks: true,
      hooks: {
        [HookEventName.BeforeModel]: [{ sequential, hooks }],
        [HookEventName.AfterModel]: [{ sequential, hooks }],
      },
    }),
  );
}

function scratch(root: string): string[] {
  return fs.readdirSync(root).filter((name) => name.startsWith('hook-output-'));
}

async function collect(source: HookSnapshotRows): Promise<unknown[]> {
  const result: unknown[] = [];
  for await (const row of source.openReader()) result.push(row);
  return result;
}

function receipt(root: string, name: string): unknown {
  return JSON.parse(fs.readFileSync(join(root, name), 'utf8'));
}

async function ready(root: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(join(root, 'ready'))) {
    if (Date.now() >= deadline) throw new Error('Child did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
describe('real HookSystem snapshot chain', () => {
  it('chains 64 disk rows through full replacement then merged model/settings/tools without stdout materialization', async () => {
    await fixture(rows, async (snapshot, owners, root) => {
      const hooks = [
        script(`request.contents.reverse(); request.model='replacement';
          request.settings={temperature:0.2};
          process.stdout.write(JSON.stringify({hookSpecificOutput:{llm_request:request}}));`),
        script(`require('node:fs').writeFileSync('second.json', JSON.stringify(request));
          process.stdout.write(JSON.stringify({hookSpecificOutput:{llm_request:{
            model:'third-model',tools:[],settings:{topP:0.8},contents:'wrong'}}}));`),
        script(`require('node:fs').writeFileSync('third.json', JSON.stringify(request));
          process.stdout.write(JSON.stringify({hookSpecificOutput:{additionalContext:'complete'}}));`),
      ];
      const hooksSystem = system(root, hooks);
      await hooksSystem.initialize();
      const materialize = spyOn(
        HookDiskText.prototype,
        'readText',
      ).mockImplementation(() => {
        throw new Error('Eager hook stdout/stderr materialization');
      });
      try {
        const target = {
          model: 'original',
          contents: providerRequestRows(snapshot),
          tools: [
            {
              name: 'search',
              parametersJsonSchema: { type: 'object', properties: {} },
            },
          ],
          settings: { temperature: 0.1 },
        };
        const result = await hooksSystem.fireBeforeModelSnapshotEvent(target);
        try {
          expect(result.errors.map((error) => error.message)).toStrictEqual([]);
          expect(result.success).toBe(true);
          expect(receipt(root, 'second.json')).toStrictEqual({
            version: 2,
            model: 'replacement',
            contents: JSON.parse(JSON.stringify([...rows].reverse())),
            tools: target.tools,
            settings: { temperature: 0.2 },
          });
          expect(receipt(root, 'third.json')).toStrictEqual({
            version: 2,
            model: 'third-model',
            contents: JSON.parse(JSON.stringify([...rows].reverse())),
            tools: [],
            settings: { temperature: 0.2, topP: 0.8 },
          });
          // The final llm_request field replaces earlier fields, just as the legacy aggregator does.
          const selected = result.finalOutput?.applyRequestRows({
            ...target,
            version: 2,
          });
          expect(selected?.model).toBe('third-model');
          expect(selected?.contents).toBe(target.contents);
          expect(
            result.finalOutput?.readValue([
              'hookSpecificOutput',
              'additionalContext',
            ]),
          ).toBe('complete');
          expect(owners.snapshot().liveRows).toBe(0);
        } finally {
          result.close();
        }
        expect(scratch(root)).toStrictEqual([]);
      } finally {
        materialize.mockRestore();
        hooksSystem.dispose();
      }
    });
  });
});

describe('real HookSystem snapshot final replacement', () => {
  for (const contents of ['[]', 'request.contents.reverse()']) {
    it(`retains a final disk replacement (${contents}) through independent reads and consumer close`, async () => {
      await fixture(rows, async (snapshot, owners, root) => {
        const hooksSystem = system(root, [
          script(
            `process.stdout.write(JSON.stringify({hookSpecificOutput:{llm_request:{contents:${contents}}}}));`,
          ),
        ]);
        await hooksSystem.initialize();
        const result = await hooksSystem.fireBeforeModelSnapshotEvent({
          model: 'original',
          contents: providerRequestRows(snapshot),
        });
        try {
          const source = result.finalOutput?.applyRequestRows({
            version: 2,
            model: 'original',
            contents: providerRequestRows(snapshot),
          }).contents;
          if (source === undefined)
            throw new Error('Missing final replacement');
          expect(scratch(root).length).toBe(1);
          const [left, right] = await Promise.all([
            collect(source),
            collect(source),
          ]);
          const expected: unknown[] = JSON.parse(
            JSON.stringify(contents === '[]' ? [] : [...rows].reverse()),
          );
          expect({ left, right }).toStrictEqual({
            left: expected,
            right: expected,
          });
          result.close();
          expect(() => source.openReader()).toThrow('Hook output disposed');
          expect(owners.snapshot().liveRows).toBe(0);
          expect(scratch(root)).toStrictEqual([]);
        } finally {
          result.close();
          hooksSystem.dispose();
        }
      });
    });
  }
});

describe('real HookSystem snapshot AfterModel receipt', () => {
  for (const sequential of [false, true]) {
    it(`gives AfterModel commands the full original request and v2 response (${sequential ? 'sequential' : 'parallel'})`, async () => {
      await fixture(rows, async (snapshot, owners, root) => {
        const hooksSystem = system(
          root,
          ['left', 'right'].map((name) =>
            script(`
          require('node:fs').writeFileSync('${name}.json', JSON.stringify(input));
          process.stdout.write(JSON.stringify({hookSpecificOutput:{llm_request:{contents:[]},llm_response:input.llm_response}}));`),
          ),
          sequential,
        );
        await hooksSystem.initialize();
        const result = await hooksSystem.fireAfterModelSnapshotEvent(
          { model: 'after-model', contents: providerRequestRows(snapshot) },
          { content: rich, finishReason: 'stop' },
        );
        try {
          for (const name of ['left', 'right']) {
            expect(receipt(root, `${name}.json`)).toMatchObject({
              hook_event_name: 'AfterModel',
              session_id: 'snapshot-orchestration',
              cwd: root,
              llm_request: {
                version: 2,
                model: 'after-model',
                contents: JSON.parse(JSON.stringify(rows)),
              },
              llm_response: JSON.parse(
                JSON.stringify({
                  version: 2,
                  content: rich,
                  finishReason: 'stop',
                }),
              ),
            });
          }
          expect(
            result.finalOutput?.readValue([
              'hookSpecificOutput',
              'llm_response',
            ]),
          ).toStrictEqual(
            JSON.parse(
              JSON.stringify({
                version: 2,
                content: rich,
                finishReason: 'stop',
              }),
            ),
          );
          expect(owners.snapshot().liveRows).toBe(0);
        } finally {
          result.close();
          hooksSystem.dispose();
        }
        expect(scratch(root)).toStrictEqual([]);
      });
    });
  }
});

describe('real HookSystem snapshot parallel receipt', () => {
  it('lets concurrent BeforeModel hooks independently receipt the same 64 disk rows', async () => {
    await fixture(rows, async (snapshot, owners, root) => {
      const hooksSystem = system(
        root,
        ['left', 'right'].map((name) =>
          script(
            `require('node:fs').writeFileSync('${name}.json',JSON.stringify(request));`,
          ),
        ),
        false,
      );
      await hooksSystem.initialize();
      const result = await hooksSystem.fireBeforeModelSnapshotEvent({
        model: 'parallel',
        contents: providerRequestRows(snapshot),
      });
      try {
        expect(result.success).toBe(true);
        expect(receipt(root, 'left.json')).toStrictEqual({
          version: 2,
          model: 'parallel',
          contents: JSON.parse(JSON.stringify(rows)),
        });
        expect(receipt(root, 'right.json')).toStrictEqual(
          receipt(root, 'left.json'),
        );
        expect(owners.snapshot().liveRows).toBe(0);
      } finally {
        result.close();
        hooksSystem.dispose();
      }
      expect(scratch(root)).toStrictEqual([]);
    });
  });
});

describe('real HookSystem snapshot stop/block', () => {
  for (const action of [
    `process.stdout.write(JSON.stringify({continue:false,stopReason:'stop',hookSpecificOutput:{llm_request:request}}));`,
    `process.stderr.write('denied 雪');process.exitCode=2;`,
  ]) {
    it(`releases output scratch on stop/block (${action}) without losing its decision`, async () => {
      await fixture(rows, async (snapshot, owners, root) => {
        const hooksSystem = system(root, [script(action)]);
        await hooksSystem.initialize();
        const result = await hooksSystem.fireBeforeModelSnapshotEvent({
          model: 'stop',
          contents: providerRequestRows(snapshot),
        });
        try {
          expect(
            result.finalOutput?.shouldStopExecution() === true ||
              result.finalOutput?.isBlockingDecision() === true,
          ).toBe(true);
          expect(result.finalOutput?.getEffectiveReason()).toMatch(
            /stop|denied 雪/,
          );
          expect(scratch(root)).toStrictEqual([]);
          expect(owners.snapshot().liveRows).toBe(0);
        } finally {
          result.close();
          hooksSystem.dispose();
        }
      });
    });
  }
});

describe('real HookSystem snapshot chain cancellation', () => {
  for (const mode of ['abort', 'timeout', 'dispose']) {
    it(`releases chain replacement and child output on ${mode}`, async () => {
      await fixture(rows, async (snapshot, owners, root) => {
        const controller = new AbortController();
        const blocked = command(
          `require('node:fs').writeFileSync('ready',String(process.pid));process.stdin.resume();setInterval(()=>{},1000);`,
        );
        const hooksSystem = system(root, [
          script(
            `process.stdout.write(JSON.stringify({hookSpecificOutput:{llm_request:request}}));`,
          ),
          { ...blocked, timeout: mode === 'timeout' ? 200 : 5000 },
        ]);
        await hooksSystem.initialize();
        const pending = hooksSystem.fireBeforeModelSnapshotEvent(
          { model: 'cancel', contents: providerRequestRows(snapshot) },
          controller.signal,
        );
        await ready(root);
        if (mode === 'abort')
          controller.abort(new Error('cancel orchestration'));
        if (mode === 'dispose') hooksSystem.dispose();
        const outcome = await pending.then(
          (result) => {
            const summary = {
              success: result.success,
              message: result.errors[0]?.message,
            };
            result.close();
            return summary;
          },
          (error: unknown) => ({
            success: false,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        expect(outcome.success).toBe(false);
        expect(outcome.message).toMatch(
          /cancel orchestration|disposed|timed out/,
        );
        expect(scratch(root)).toStrictEqual([]);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(() =>
          process.kill(Number(fs.readFileSync(join(root, 'ready'), 'utf8')), 0),
        ).toThrow('ESRCH');
        hooksSystem.dispose();
      });
    });
  }
});

describe('real HookSystem snapshot final cancellation', () => {
  it('closes an outstanding final disk replacement when its event signal aborts', async () => {
    await fixture(rows, async (snapshot, _owners, root) => {
      const hooksSystem = system(root, [
        script(
          `process.stdout.write(JSON.stringify({hookSpecificOutput:{llm_request:request}}));`,
        ),
      ]);
      await hooksSystem.initialize();
      const controller = new AbortController();
      const result = await hooksSystem.fireBeforeModelSnapshotEvent(
        { model: 'cancel-final', contents: providerRequestRows(snapshot) },
        controller.signal,
      );
      const selected = result.finalOutput?.applyRequestRows({
        version: 2,
        model: 'cancel-final',
        contents: providerRequestRows(snapshot),
      }).contents;
      if (selected === undefined) throw new Error('No selected replacement');
      expect(scratch(root).length).toBe(1);
      controller.abort(new Error('consumer aborted'));
      expect(scratch(root)).toStrictEqual([]);
      expect(() => selected.openReader()).toThrow('Hook output disposed');
      result.close();
      hooksSystem.dispose();
    });
  });
});

class ArrayCallbackSystem extends HookSystem {
  override async fireBeforeModelEvent(): Promise<BeforeModelHookOutput> {
    return new BeforeModelHookOutput({
      continue: false,
      reason: 'array callback',
    });
  }
}
describe('real HookSystem snapshot array callback', () => {
  it('reports a missing snapshot callback rather than skipping the existing array callback', async () => {
    await fixture(rows, async (snapshot, _owners, root) => {
      const config = new Config({
        sessionId: 'callback',
        targetDir: root,
        cwd: root,
        debugMode: false,
        model: 'test',
      });
      const hooksSystem = new ArrayCallbackSystem(config);
      await hooksSystem.initialize();
      expect(
        (await hooksSystem.fireBeforeModelEvent()).getEffectiveReason(),
      ).toBe('array callback');
      await expect(
        hooksSystem.fireBeforeModelSnapshotEvent({
          model: 'test',
          contents: providerRequestRows(snapshot),
        }),
      ).rejects.toMatchObject({
        name: 'MissingSnapshotHookCallbackError',
        message: 'Missing snapshot callback: fireBeforeModelSnapshotEvent',
      });
      expect(scratch(root)).toStrictEqual([]);
      hooksSystem.dispose();
    });
  });
});

describe('real HookSystem snapshot wire bytes', () => {
  it('preserves external v2 JSON bytes except the event timestamp', async () => {
    await fixture(rows, async (snapshot, _owners, root) => {
      const hooksSystem = system(root, [
        script(`require('node:fs').writeFileSync('bytes.json',body);`),
      ]);
      await hooksSystem.initialize();
      const target = {
        model: 'byte-雪',
        contents: providerRequestRows(snapshot),
        tools: [],
        settings: { temperature: 0 },
      };
      const result = await hooksSystem.fireBeforeModelSnapshotEvent(target);
      try {
        const bytes = fs.readFileSync(join(root, 'bytes.json'), 'utf8');
        const timestamp: unknown = JSON.parse(bytes).timestamp;
        const oracle = JSON.stringify({
          session_id: 'snapshot-orchestration',
          cwd: root,
          timestamp,
          hook_event_name: 'BeforeModel',
          transcript_path: '',
          llm_request: { ...target, contents: rows, version: 2 },
        });
        fs.writeFileSync(
          join(root, 'byte-receipt.txt'),
          String(bytes === oracle),
        );
        expect(bytes).toBe(oracle);
      } finally {
        result.close();
        hooksSystem.dispose();
      }
    });
  });
});

describe('real snapshot reducer parity', () => {
  for (const override of [
    {},
    null,
    { contents: [] },
    { contents: 'wrong', model: 12, tools: null, settings: 'wrong' },
    { model: 'last', settings: { topP: 0.9 }, tools: [] },
  ]) {
    it(`matches legacy final field replacement for ${JSON.stringify(override)}`, async () => {
      await fixture(rows, async (snapshot, owners, root) => {
        const makeHooks = (file: string): HookConfig[] => [
          script(
            `request.contents.reverse();process.stdout.write(JSON.stringify({continue:false,decision:'deny',reason:'first',hookSpecificOutput:{llm_request:request,additionalContext:'first'}}));`,
          ),
          script(
            `process.stdout.write(JSON.stringify({continue:true,decision:'allow',reason:'last',hookSpecificOutput:{llm_request:${JSON.stringify(override)}}}));`,
          ),
          script(
            `require('node:fs').writeFileSync(${JSON.stringify(file)},JSON.stringify(request));`,
          ),
        ];
        const hooksSystem = system(root, makeHooks('snapshot-chain.json'));
        const legacy = system(root, makeHooks('legacy-chain.json'));
        await hooksSystem.initialize();
        await legacy.initialize();
        const sourceTarget = {
          version: 2,
          model: 'original',
          contents: providerRequestRows(snapshot),
          tools: [],
          settings: { temperature: 0.2 },
        } satisfies import('./hookModelInputStream.js').HookModelRowsInput['llm_request'];
        const result =
          await hooksSystem.fireBeforeModelSnapshotEvent(sourceTarget);
        try {
          const chained = receipt(root, 'snapshot-chain.json');
          const legacyTarget = { ...sourceTarget, contents: rows };
          const old = await legacy.fireBeforeModelEvent(legacyTarget);
          const selected = result.finalOutput?.applyRequestRows(sourceTarget);
          if (selected === undefined || old === undefined)
            throw new Error('Missing reduced output');
          expect(receipt(root, 'legacy-chain.json')).toStrictEqual(chained);
          expect({
            ...selected,
            contents: await collect(selected.contents),
          }).toStrictEqual(
            JSON.parse(
              JSON.stringify(old.applyLLMRequestModifications(legacyTarget)),
            ),
          );
          expect(
            result.finalOutput?.readValue([
              'hookSpecificOutput',
              'additionalContext',
            ]),
          ).toBe(old.getAdditionalContext());
          expect(result.finalOutput?.shouldStopExecution()).toBe(
            old.shouldStopExecution(),
          );
          expect(result.finalOutput?.isBlockingDecision()).toBe(
            old.isBlockingDecision(),
          );
          expect(result.finalOutput?.getEffectiveReason()).toBe(
            old.getEffectiveReason(),
          );
          expect(scratch(root).length).toBe(3);
          expect(owners.snapshot().liveRows).toBe(0);
        } finally {
          result.close();
          hooksSystem.dispose();
          legacy.dispose();
        }
        expect(scratch(root)).toStrictEqual([]);
      });
    });
  }
});

describe('snapshot source ownership', () => {
  it('invalidates active final readers on system disposal without closing borrowed input', async () => {
    await fixture(rows, async (snapshot, owners, root) => {
      const hooksSystem = system(root, [
        script(
          `process.stdout.write(JSON.stringify({hookSpecificOutput:{llm_request:request}}));`,
        ),
      ]);
      await hooksSystem.initialize();
      const target = {
        version: 2,
        model: 'reader',
        contents: providerRequestRows(snapshot),
      } satisfies import('./hookModelInputStream.js').HookModelRowsInput['llm_request'];
      const result = await hooksSystem.fireBeforeModelSnapshotEvent(target);
      const source = result.finalOutput?.applyRequestRows(target).contents;
      if (source === undefined) throw new Error('Missing replacement');
      const reader = source.openReader();
      expect((await reader.next()).done).toBe(false);
      hooksSystem.dispose();
      await expect(reader.next()).rejects.toThrow('Hook output disposed');
      expect(scratch(root)).toStrictEqual([]);
      const borrowed = snapshot.openReader();
      expect((await borrowed.next()).done).toBe(false);
      await borrowed.return();
      expect(owners.snapshot().liveRows).toBe(0);
      result.close();
    });
  });

  it('keeps no-hook snapshot events lazy and rejects an already aborted event', async () => {
    await fixture(rows, async (snapshot, owners, root) => {
      const hooksSystem = system(root, []);
      await hooksSystem.initialize();
      const request = {
        model: 'none',
        contents: providerRequestRows(snapshot),
      };
      const result = await hooksSystem.fireBeforeModelSnapshotEvent(request);
      expect(result.success).toBe(true);
      expect(result.finalOutput).toBeUndefined();
      expect(owners.snapshot().peakRows).toBe(0);
      result.close();
      const controller = new AbortController();
      controller.abort(new Error('already aborted'));
      await expect(
        hooksSystem.fireBeforeModelSnapshotEvent(request, controller.signal),
      ).rejects.toThrow('already aborted');
      expect(scratch(root)).toStrictEqual([]);
      hooksSystem.dispose();
    });
  });
});

describe('snapshot output selection boundaries', () => {
  it('leaves a plain stdout message on disk until explicit consumer access', async () => {
    await fixture(rows, async (snapshot, _owners, root) => {
      const hooksSystem = system(root, [
        script(`process.stdout.write('plain 雪');`),
      ]);
      await hooksSystem.initialize();
      const materialize = spyOn(
        HookDiskText.prototype,
        'readText',
      ).mockImplementation(() => {
        throw new Error('eager stdout');
      });
      const result = await hooksSystem.fireBeforeModelSnapshotEvent({
        model: 'plain',
        contents: providerRequestRows(snapshot),
      });
      materialize.mockRestore();
      try {
        expect(result.success).toBe(true);
        expect(result.finalOutput?.readValue(['systemMessage'])).toBe(
          'plain 雪',
        );
        expect(() =>
          result.finalOutput?.readValue(['hookSpecificOutput']),
        ).toThrow('not an ancestor');
      } finally {
        result.close();
        hooksSystem.dispose();
      }
      expect(scratch(root)).toStrictEqual([]);
    });
  });
});

describe('snapshot parallel disk failure cleanup', () => {
  it('awaits cancelled siblings and releases every output owner when parsing fails', async () => {
    await fixture(rows, async (snapshot, owners, root) => {
      const open = fs.openSync;
      const fault = spyOn(fs, 'openSync').mockImplementation(
        (path, flags, mode) => {
          if (String(path).endsWith('/document.utf16')) {
            throw new Error('parallel document failed');
          }
          return open(path, flags, mode);
        },
      );
      const hooksSystem = system(
        root,
        [
          script(
            `while(require('node:fs').existsSync('ready')===false)await new Promise(r=>setTimeout(r,5));process.stdout.write(JSON.stringify({hookSpecificOutput:{llm_request:request}}));`,
          ),
          command(
            `require('node:fs').writeFileSync('ready',String(process.pid));process.stdin.resume();setInterval(()=>{},1000);`,
          ),
        ],
        false,
      );
      await hooksSystem.initialize();
      try {
        await expect(
          hooksSystem.fireBeforeModelSnapshotEvent({
            model: 'fault',
            contents: providerRequestRows(snapshot),
          }),
        ).rejects.toThrow('parallel document failed');
        expect(scratch(root)).toStrictEqual([]);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(() =>
          process.kill(Number(fs.readFileSync(join(root, 'ready'), 'utf8')), 0),
        ).toThrow('ESRCH');
      } finally {
        fault.mockRestore();
        hooksSystem.dispose();
      }
    });
  });
});

class ArrayAfterCallbackSystem extends HookSystem {
  override async fireAfterModelEvent(): Promise<
    import('./types.js').AfterModelHookOutput
  > {
    const { AfterModelHookOutput } = await import('./types.js');
    return new AfterModelHookOutput({
      decision: 'deny',
      reason: 'array after callback',
    });
  }
}
describe('AfterModel snapshot callback contract', () => {
  it('rejects a missing AfterModel snapshot callback and preserves the old callback', async () => {
    await fixture(rows, async (snapshot, _owners, root) => {
      const hooksSystem = new ArrayAfterCallbackSystem(
        new Config({
          sessionId: 'after-callback',
          targetDir: root,
          cwd: root,
          debugMode: false,
          model: 'test',
        }),
      );
      await hooksSystem.initialize();
      expect(
        (await hooksSystem.fireAfterModelEvent()).getEffectiveReason(),
      ).toBe('array after callback');
      await expect(
        hooksSystem.fireAfterModelSnapshotEvent(
          { model: 'test', contents: providerRequestRows(snapshot) },
          { content: rich },
        ),
      ).rejects.toMatchObject({
        name: 'MissingSnapshotHookCallbackError',
        message: 'Missing snapshot callback: fireAfterModelSnapshotEvent',
      });
      expect(scratch(root)).toStrictEqual([]);
      hooksSystem.dispose();
    });
  });
});
