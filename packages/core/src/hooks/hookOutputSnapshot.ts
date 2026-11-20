/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, mkdtempSync, openSync, readSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { HookExecutionResult } from './types.js';
import {
  HookOutputJsonParser,
  JsonDiskCursor,
  scanJsonString,
  writeAll,
  type JsonSpan,
} from './hookOutputJsonParser.js';
import type { HookModelRowsInput } from './hookModelInputStream.js';
import { mergeHookLLMRequest } from './hookTranslator.js';

export interface HookSnapshotRows {
  readonly count: number;
  openReader(signal?: AbortSignal): AsyncGenerator<unknown, void, unknown>;
}

/** The returned result owns scratch until disposal; readers only borrow it. */
export interface HookSnapshotResult
  extends Omit<HookExecutionResult, 'output' | 'stdout' | 'stderr'> {
  readonly kind: 'disk-hook-output';
  readonly stdout: HookDiskText;
  readonly stderr: HookDiskText;
  readonly output?: HookOutputDocument;
  dispose(): void;
}

export class HookDiskText {
  private fd: number | undefined;
  constructor(readonly path: string) {
    this.fd = openSync(path, 'w+', 0o600);
  }
  descriptor(): number {
    if (this.fd === undefined) throw new Error('Hook output disposed');
    return this.fd;
  }
  append(bytes: Buffer): void {
    writeAll(this.descriptor(), bytes);
  }

  *chunks(): Generator<string, void, unknown> {
    const decoder = new StringDecoder('utf8');
    const buffer = Buffer.alloc(65536);
    let position = 0;
    let count = readSync(this.descriptor(), buffer, 0, buffer.length, position);
    while (count !== 0) {
      position += count;
      yield decoder.write(buffer.subarray(0, count));
      count = readSync(this.descriptor(), buffer, 0, buffer.length, position);
    }
    yield decoder.end();
  }

  hasText(): boolean {
    for (const chunk of this.chunks())
      if (chunk.trim().length !== 0) return true;
    return false;
  }

  /** Explicit consumer materialization; the owner never calls this while parsing. */
  readText(): string {
    return Array.from(this.chunks()).join('');
  }

  dispose(): void {
    if (this.fd === undefined) return;
    const fd = this.fd;
    this.fd = undefined;
    closeSync(fd);
  }
}

type Fallback = { readonly text: HookDiskText; readonly exitCode: number };
const CONTENTS_PATH = ['hookSpecificOutput', 'llm_request', 'contents'];

/** Raw streams, UTF-16 JSON, and row offsets belong to one execution, not its readers. */
export class HookOutputOwner {
  readonly stdout: HookDiskText;
  readonly stderr: HookDiskText;
  private readonly descriptors = new Set<number>();
  private disposed = false;
  readonly directory: string;

  constructor(root: string) {
    this.directory = mkdtempSync(join(root, 'hook-output-'));
    let stdout: HookDiskText | undefined;
    try {
      this.stdout = stdout = new HookDiskText(join(this.directory, 'stdout'));
      this.stderr = new HookDiskText(join(this.directory, 'stderr'));
    } catch (error) {
      try {
        stdout?.dispose();
      } finally {
        rmSync(this.directory, { recursive: true, force: true });
      }
      throw error;
    }
  }

  assertOpen(): void {
    if (this.disposed) throw new Error('Hook output disposed');
  }

  private file(name: string): number {
    this.assertOpen();
    const fd = openSync(join(this.directory, name), 'w+', 0o600);
    this.descriptors.add(fd);
    return fd;
  }

  output(exitCode: number | null): HookOutputDocument | undefined {
    this.assertOpen();
    if (exitCode !== 0) {
      if (!this.stderr.hasText() && exitCode !== 2) return undefined;
      return new HookOutputDocument(this, undefined, undefined, undefined, {
        text: this.stderr,
        exitCode: exitCode ?? 1,
      });
    }
    if (!this.stdout.hasText()) return undefined;
    const document = this.file('document.utf16');
    for (const chunk of this.stdout.chunks())
      writeAll(document, Buffer.from(chunk, 'utf16le'));
    const index = this.file('rows.index');
    try {
      const parsed = new HookOutputJsonParser(
        document,
        CONTENTS_PATH,
        index,
        true,
      ).parse();
      if (parsed.root.kind === 'string')
        return this.decodeDocumentString(document, parsed.root);
      if (parsed.root.kind === 'null') return undefined;
      return new HookOutputDocument(this, document, index, parsed.selected);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return new HookOutputDocument(this, undefined, undefined, undefined, {
        text: this.stdout,
        exitCode: 0,
      });
    }
  }

  private decodeDocumentString(
    document: number,
    root: JsonSpan,
  ): HookOutputDocument | undefined {
    const decoded = this.file('decoded.utf16');
    const cursor = new JsonDiskCursor(document);
    cursor.position = root.start;
    const buffer = Buffer.alloc(65536);
    let length = 0;
    const flush = (): void => {
      writeAll(decoded, buffer.subarray(0, length));
      length = 0;
    };
    scanJsonString(cursor, (unit) => {
      buffer.writeUInt16LE(unit, length);
      length += 2;
      if (length === buffer.length) flush();
    });
    flush();
    const index = this.file('decoded-rows.index');
    const parsed = new HookOutputJsonParser(
      decoded,
      CONTENTS_PATH,
      index,
    ).parse();
    if (parsed.root.kind === 'null') return undefined;
    return new HookOutputDocument(this, decoded, index, parsed.selected);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    const cleanup = (action: () => void): void => {
      try {
        action();
      } catch (error) {
        failure ??= error;
      }
    };
    cleanup(() => this.stdout.dispose());
    cleanup(() => this.stderr.dispose());
    for (const fd of this.descriptors) cleanup(() => closeSync(fd));
    this.descriptors.clear();
    cleanup(() => rmSync(this.directory, { recursive: true, force: true }));
    if (failure !== undefined) throw failure;
  }
}

export class HookOutputDocument {
  readonly replacement: HookSnapshotRows | undefined;

  constructor(
    private readonly owner: HookOutputOwner,
    private readonly document: number | undefined,
    index: number | undefined,
    selected: JsonSpan | undefined,
    private readonly fallback?: Fallback,
  ) {
    if (
      selected?.kind === 'array' &&
      document !== undefined &&
      index !== undefined
    ) {
      const count = selected.count;
      this.replacement = {
        count,
        openReader: (signal?: AbortSignal) => {
          owner.assertOpen();
          signal?.throwIfAborted();
          return new HookSnapshotReader(
            owner,
            document,
            index,
            selected.indexOffset,
            count,
            signal,
          );
        },
      };
    }
  }

  mergeRequestRows(
    target: HookModelRowsInput['llm_request'],
  ): HookModelRowsInput['llm_request'] {
    this.owner.assertOpen();
    if (this.document === undefined) return target;
    const parent = ['hookSpecificOutput', 'llm_request'];
    const span = new HookOutputJsonParser(
      this.document,
      parent,
      undefined,
      true,
    ).parse().selected;
    if (span === undefined || (span.kind !== 'object' && span.kind !== 'array'))
      return target;
    const override = {
      model: this.readValue([...parent, 'model']),
      tools: this.readValue([...parent, 'tools']),
      settings: this.readValue([...parent, 'settings']),
    };
    const merged = mergeHookLLMRequest({ ...target, contents: [] }, override);
    return { ...merged, contents: this.replacement ?? target.contents };
  }

  private valueSpan(
    path: ReadonlyArray<string | number>,
  ): JsonSpan | undefined {
    this.owner.assertOpen();
    if (this.document === undefined) return undefined;
    const parsed = new HookOutputJsonParser(
      this.document,
      path,
      undefined,
      true,
    ).parse();
    return path.length === 0 ? parsed.root : parsed.selected;
  }

  valueKind(path: ReadonlyArray<string | number>): string | undefined {
    return this.valueSpan(path)?.kind;
  }

  valueMemberCount(path: ReadonlyArray<string | number>): number | undefined {
    return this.valueSpan(path)?.count;
  }

  hasValue(path: ReadonlyArray<string | number>): boolean {
    this.owner.assertOpen();
    if (this.fallback !== undefined)
      return (
        path.length === 1 &&
        (path[0] === 'decision' ||
          path[0] ===
            (this.fallback.exitCode === 2 ? 'reason' : 'systemMessage'))
      );
    if (this.document === undefined) return false;
    const parsed = new HookOutputJsonParser(
      this.document,
      path,
      undefined,
      true,
    ).parse();
    return (path.length === 0 ? parsed.root : parsed.selected) !== undefined;
  }

  /** Select a field or row, never materialize a replacement's ancestor object. */
  readValue(path: ReadonlyArray<string | number>): unknown {
    this.owner.assertOpen();
    if (
      path.length < CONTENTS_PATH.length &&
      path.every((key, index) => key === CONTENTS_PATH[index])
    )
      throw new Error(
        'Select a hook output field or row, not its replacement ancestor',
      );
    if (this.fallback !== undefined) return this.fallbackValue(path);
    if (this.document === undefined) return undefined;
    if (
      path.length === CONTENTS_PATH.length &&
      path.every((key, index) => key === CONTENTS_PATH[index])
    )
      return this.replacement;
    const parsed = new HookOutputJsonParser(
      this.document,
      path,
      undefined,
      true,
    ).parse();
    const selected = path.length === 0 ? parsed.root : parsed.selected;
    return selected === undefined
      ? undefined
      : JSON.parse(
          new JsonDiskCursor(this.document).text(selected.start, selected.end),
        );
  }

  private fallbackValue(path: ReadonlyArray<string | number>): unknown {
    const fallback = this.fallback;
    if (fallback === undefined || path.length !== 1) return undefined;
    const blocking = fallback.exitCode === 2;
    if (path[0] === 'decision') return blocking ? 'deny' : 'allow';
    if (path[0] !== (blocking ? 'reason' : 'systemMessage')) return undefined;
    const text = fallback.text.readText().trim();
    if (blocking)
      return text || 'Hook exited with code 2 without an error message';
    return fallback.exitCode === 0 ? text : `Warning: ${text}`;
  }
}

/** A suspended async generator can retain its last yielded row. This cursor does not. */
class HookSnapshotReader implements AsyncGenerator<unknown, void, unknown> {
  private row = 0;
  private finished = false;
  private readonly cursor: JsonDiskCursor;
  private readonly pointer = Buffer.alloc(16);

  constructor(
    private readonly owner: HookOutputOwner,
    document: number,
    private readonly index: number,
    private readonly base: number,
    private readonly count: number,
    private readonly signal?: AbortSignal,
  ) {
    this.cursor = new JsonDiskCursor(document);
  }

  [Symbol.asyncIterator](): AsyncGenerator<unknown, void, unknown> {
    return this;
  }
  [Symbol.asyncDispose](): Promise<void> {
    this.finished = true;
    return Promise.resolve();
  }

  next(): Promise<IteratorResult<unknown, void>> {
    try {
      this.owner.assertOpen();
      if (this.finished)
        return Promise.resolve({ done: true, value: undefined });
      this.signal?.throwIfAborted();
      if (this.row === this.count) return this.return();
      let offset = 0;
      while (offset < this.pointer.length) {
        const count = readSync(
          this.index,
          this.pointer,
          offset,
          this.pointer.length - offset,
          this.base + this.row * 16 + offset,
        );
        if (count === 0) throw new Error('Missing hook replacement row offset');
        offset += count;
      }
      this.row++;
      const value: unknown = JSON.parse(
        this.cursor.text(
          this.pointer.readDoubleLE(0),
          this.pointer.readDoubleLE(8),
        ),
      );
      return Promise.resolve({ done: false, value });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return(): Promise<IteratorResult<unknown, void>> {
    this.finished = true;
    return Promise.resolve({ done: true, value: undefined });
  }
  throw(error?: unknown): Promise<IteratorResult<unknown, void>> {
    this.finished = true;
    return Promise.reject(error);
  }
}
