/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  getScratchRoot,
  type IContent,
  type RowOwnership,
} from '@vybestack/llxprt-code-core';

const responseSchema = z.object({
  callId: z.string(),
  toolName: z.string(),
  result: z.unknown(),
  error: z.string().optional(),
  seq: z.number().optional(),
});

export class ToolResponseIndex {
  private readonly directory: string;

  constructor(
    root = getScratchRoot(),
    private readonly ownership?: RowOwnership,
  ) {
    this.directory = mkdtempSync(join(root, 'llxprt-tool-responses-'));
  }

  private path(callId: string): string {
    return join(
      this.directory,
      createHash('sha256').update(callId).digest('hex'),
    );
  }

  add(row: IContent): void {
    for (const block of row.blocks) {
      if (block.type !== 'tool_response') continue;
      const stored = {
        callId: block.callId,
        toolName: block.toolName,
        result: block.result,
        error: block.error,
        seq: row.metadata?.chronology?.seq,
      };
      this.ownership?.retain(stored);
      try {
        writeFileSync(this.path(block.callId), JSON.stringify(stored), {
          mode: 0o600,
        });
      } finally {
        this.ownership?.release(stored);
      }
    }
  }

  get(callId: string): IContent | undefined {
    let text: string;
    try {
      text = readFileSync(this.path(callId), 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return undefined;
      throw error;
    }
    const response = responseSchema.parse(JSON.parse(text));
    return {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: response.callId,
          toolName: response.toolName,
          result: response.result,
          ...(response.error !== undefined ? { error: response.error } : {}),
        },
      ],
      ...(response.seq !== undefined
        ? {
            metadata: {
              chronology: {
                seq: response.seq,
                userTurn: 0,
                step: 0,
                recordedAt: 0,
              },
            },
          }
        : {}),
    };
  }

  close(): void {
    rmSync(this.directory, { recursive: true, force: true });
  }
}
