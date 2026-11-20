/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open } from 'node:fs/promises';

class PersistedSessionSelector {
  private readonly tokenLimit: number;
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private token: string | undefined;
  private key: string | undefined;
  private stage: 'key' | 'colon' | 'value' | 'after' = 'key';
  private sessionMatches = false;
  private projectMatches = false;

  constructor(
    private readonly sessionId: string,
    private readonly projectHash: string,
  ) {
    this.tokenLimit =
      Math.max(sessionId.length, projectHash.length, 16) * 6 + 2;
  }

  consume(bytes: Uint8Array): boolean | undefined {
    for (const byte of bytes) {
      const selected = this.consumeByte(byte);
      if (selected !== undefined) return selected;
    }
    return;
  }

  private consumeByte(byte: number): boolean | undefined {
    if (this.quoted) return this.consumeQuoted(byte);
    if (byte === 9 || byte === 10 || byte === 13 || byte === 32) return;
    if (this.depth === 0) {
      if (byte !== 123) return false;
      this.depth = 1;
    } else if (byte === 34) {
      this.quoted = true;
      this.token = this.depth === 1 ? '"' : undefined;
    } else if (byte === 123 || byte === 91) {
      this.depth++;
    } else if (byte === 125 || byte === 93) {
      this.depth--;
      if (this.depth === 0) return false;
      if (this.depth === 1) this.stage = 'after';
    } else if (this.depth === 1 && byte === 58) {
      this.stage = 'value';
    } else if (this.depth === 1 && byte === 44) {
      this.stage = 'key';
    }
    return;
  }

  private consumeQuoted(byte: number): boolean | undefined {
    if (this.token !== undefined) {
      this.token += String.fromCharCode(byte);
      if (this.token.length > this.tokenLimit) this.token = undefined;
    }
    if (this.escaped) this.escaped = false;
    else if (byte === 92) this.escaped = true;
    else if (byte === 34) {
      this.quoted = false;
      if (this.depth === 1) return this.completeString();
    }
    return;
  }

  private completeString(): boolean | undefined {
    let value: unknown;
    if (this.token !== undefined) {
      try {
        value = JSON.parse(Buffer.from(this.token, 'latin1').toString('utf8'));
      } catch (error) {
        if (error instanceof SyntaxError) return false;
        throw error;
      }
    }
    if (this.stage === 'key') {
      this.key = typeof value === 'string' ? value : undefined;
      this.stage = 'colon';
    } else {
      if (this.key === 'sessionId')
        this.sessionMatches = value === this.sessionId;
      if (this.key === 'projectHash')
        this.projectMatches = value === this.projectHash;
      if (this.sessionMatches && this.projectMatches) return true;
      this.stage = 'after';
    }
    return;
  }
}

/** Discover ownership without materializing unrelated legacy histories. */
export async function matchesPersistedSession(
  path: string,
  sessionId: string,
  projectHash: string,
): Promise<boolean> {
  const handle = await open(path, 'r');
  const buffer = Buffer.alloc(65536);
  const selector = new PersistedSessionSelector(sessionId, projectHash);
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) return false;
      const selected = selector.consume(buffer.subarray(0, bytesRead));
      if (selected !== undefined) return selected;
    }
  } finally {
    await handle.close();
  }
}
