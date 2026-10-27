/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ROW_BLOCK_TYPE } from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import type { NativeFactIndexWriter } from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import { readAnthropicMeasurementFact } from './anthropic-measurement-facts.js';
import type {
  AnthropicStreamRepair,
  LazyRepairAtom,
} from './anthropic-stream-repair.js';

async function purgeWindow(
  engine: AnthropicStreamRepair,
  atom: LazyRepairAtom,
  writer: NativeFactIndexWriter,
): Promise<boolean> {
  if (atom.repair) return false;
  const at = atom.end ?? Math.floor(atom.key / 4);
  const tail = await engine.source.query.planAt(at);
  if (tail.header.metadata?.semanticMediaPurgeBoundary !== undefined)
    return true;
  let media = false;
  for (let unit = Math.floor(atom.key / 4); unit <= at && !media; unit++) {
    const plan = unit === at ? tail : await engine.source.query.planAt(unit);
    media = plan.blocks.some(
      (ref) =>
        ref.kind === 'source' &&
        (plan.sourceIds?.(ref.at.label)?.header.blocks[ref.at.block].type ??
          ROW_BLOCK_TYPE.media) === ROW_BLOCK_TYPE.media,
    );
  }
  if (!media) return false;
  const measured = await readAnthropicMeasurementFact(writer, atom.key);
  return measured.kept.some(
    (piece) =>
      piece.form === 'array' &&
      piece.blocks.some((block) => block.kind === 'image'),
  );
}

async function counter(
  writer: NativeFactIndexWriter,
  key: string,
  from: number,
): Promise<number> {
  return from === 0 ? 0 : ((await writer.get([key]))?.[0] ?? 0);
}

export class AnthropicCacheWindowWriter {
  private constructor(
    private readonly writer: NativeFactIndexWriter,
    private run: number,
    private start: number,
    private end: number,
    private role: LazyRepairAtom['role'] | undefined,
    private anchors: number,
    private purgeWindows: number,
  ) {}

  static async create(
    writer: NativeFactIndexWriter,
    from = 0,
  ): Promise<AnthropicCacheWindowWriter> {
    const previous = from === 0 ? undefined : await writer.get(['cache-runs']);
    const run = previous === undefined ? -1 : previous[0] - 1;
    const tail = run < 0 ? undefined : await writer.get(['cache-run', run]);
    const previousRole = tail?.[2] === 0 ? 'user' : 'assistant';
    return new AnthropicCacheWindowWriter(
      writer,
      run,
      tail?.[0] ?? 0,
      from,
      tail === undefined ? undefined : previousRole,
      await counter(writer, 'cache-anchors', from),
      await counter(writer, 'cache-purge-windows', from),
    );
  }

  async add(
    atom: LazyRepairAtom,
    purge: boolean,
    anchor: boolean,
  ): Promise<void> {
    const at = Math.floor(atom.key / 4);
    if (this.role !== atom.role) {
      if (this.run >= 0) await this.saveRun(this.end);
      this.run++;
      this.role = atom.role;
      this.start = at;
    }
    this.end = (atom.end ?? at) + 1;
    if (purge)
      await this.writer.set(
        ['cache-purge-window', this.purgeWindows++],
        [at, this.end],
      );
    if (anchor)
      await this.writer.set(['cache-anchor', this.anchors++], [at, this.end]);
  }

  private saveRun(end: number): Promise<void> {
    return this.writer.set(
      ['cache-run', this.run],
      [this.start, end, Number(this.role === 'assistant')],
    );
  }

  async finish(count: number): Promise<void> {
    if (this.run >= 0) await this.saveRun(Math.max(this.end, count));
    await this.writer.set(['cache-runs'], [this.run + 1]);
    await this.writer.set(['cache-anchors'], [this.anchors]);
    await this.writer.set(['cache-purge-windows'], [this.purgeWindows]);
  }
}

export async function writeAnthropicCacheWindows(
  engine: AnthropicStreamRepair,
  writer: NativeFactIndexWriter,
  from = 0,
): Promise<void> {
  const windows = await AnthropicCacheWindowWriter.create(writer, from);
  for await (const atom of engine.atoms(from * 4))
    await windows.add(
      atom,
      await purgeWindow(engine, atom, writer),
      !atom.repair &&
        (await engine.source.query.planAt(atom.end ?? Math.floor(atom.key / 4)))
          .header.metadata?.cacheAnchor === true,
    );
  await windows.finish(engine.source.query.count);
}
