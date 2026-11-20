/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Readable } from 'node:stream';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
// Replies to the startup capability queries (Kitty flags, DA1, modifyOtherKeys,
// OSC 11 background colour, XTVERSION). Key presses never take these forms, and
// the queries run while typed input is held here, so they must not reach the
// composer.
const TERMINAL_REPLY = new RegExp(
  [
    `${ESC}\\[\\?[0-9;]*[uc]`,
    `${ESC}\\[>[0-9;]*m`,
    `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
    `${ESC}P[^${ESC}]*${ESC}\\\\`,
  ].join('|'),
  'g',
);

export function stripTerminalReplies(input: string): string {
  return input.replace(TERMINAL_REPLY, '');
}

/** Owns terminal input until both the key decoder and the composer can accept it. */
export class StartupStdinBuffer {
  private readonly pending: string[] = [];
  private listener: ((chunk: string) => void) | undefined;
  private ready = false;
  private dialogActive = false;
  isReplaying = false;

  constructor(
    private readonly stdin: Pick<Readable, 'setEncoding' | 'on' | 'off'>,
  ) {
    stdin.setEncoding('utf8');
    stdin.on('data', this.capture);
  }

  private readonly capture = (chunk: string): void => {
    if (this.listener && this.acceptsLiveInput()) {
      this.listener(chunk);
      return;
    }
    this.pending.push(chunk);
    this.flush();
  };

  private acceptsLiveInput(): boolean {
    if (this.isReplaying) return false;
    return this.dialogActive || (this.ready && this.pending.length === 0);
  }

  /** Receives the key decoder; returns its disconnect. */
  connect(listener: (chunk: string) => void): () => void {
    this.listener = listener;
    this.flush();
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }

  /** The composer has focus: replay held input in arrival order, then go live. */
  release(): void {
    this.ready = true;
    this.flush();
  }

  /**
   * A startup dialog owns the keyboard: new keys reach it directly, while input
   * typed before the dialog appeared stays queued for the composer.
   */
  acceptDialogInput(): () => void {
    this.dialogActive = true;
    return () => {
      this.dialogActive = false;
    };
  }

  private flush(): void {
    const listener = this.listener;
    if (!this.ready || !listener || this.isReplaying) return;
    if (this.pending.length === 0) return;
    const held = stripTerminalReplies(this.pending.join(''));
    this.pending.length = 0;
    if (held.length === 0) return;
    this.isReplaying = true;
    try {
      listener(held);
    } finally {
      this.isReplaying = false;
    }
  }

  dispose(): void {
    this.stdin.off('data', this.capture);
    this.pending.length = 0;
    this.listener = undefined;
  }
}

export function captureStartupStdin(): StartupStdinBuffer | undefined {
  if (!process.versions.bun || !process.stdin.isTTY || !process.stdout.isTTY)
    return undefined;
  return new StartupStdinBuffer(process.stdin);
}
