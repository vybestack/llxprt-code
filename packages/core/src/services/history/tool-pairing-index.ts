/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ToolCallBlock } from './IContent.js';
import { getScratchRoot } from '../../storage/scratch-root.js';

const callSchema = z
  .object({
    type: z.literal('tool_call'),
    id: z.string(),
    name: z.string(),
    parameters: z.unknown(),
    description: z.string().optional(),
    providerMetadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

function mark(path: string): boolean {
  try {
    writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
      return false;
    throw error;
  }
}

export class ToolPairingIndex {
  private readonly directory: string;
  private count = 0;

  constructor(root = getScratchRoot()) {
    this.directory = mkdtempSync(join(root, 'llxprt-tool-pairing-'));
  }

  private path(prefix: string, id: string): string {
    return join(
      this.directory,
      prefix + createHash('sha256').update(id).digest('hex'),
    );
  }

  respond(id: string): void {
    if (id !== '') mark(this.path('response-', id));
  }

  add(block: ToolCallBlock): void {
    if (!mark(this.path('seen-', block.id))) return;
    writeFileSync(
      join(this.directory, `call-${this.count}`),
      JSON.stringify(block),
      { mode: 0o600 },
    );
    this.count += 1;
  }

  private readCall(index: number): ToolCallBlock {
    const parsed = callSchema.parse(
      JSON.parse(readFileSync(join(this.directory, `call-${index}`), 'utf8')),
    );
    return { ...parsed, parameters: parsed.parameters };
  }

  private responded(id: string): boolean {
    try {
      readFileSync(this.path('response-', id));
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return false;
      throw error;
    }
  }

  *unmatched(): Generator<ToolCallBlock, void, unknown> {
    for (let index = 0; index < this.count; index += 1) {
      const block = this.readCall(index);
      if (!this.responded(block.id)) yield block;
    }
  }

  close(): void {
    rmSync(this.directory, { recursive: true, force: true });
  }
}
