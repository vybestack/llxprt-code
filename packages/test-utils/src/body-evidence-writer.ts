/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  requireBudget,
  requireLanePath,
  withLaneLock,
} from './body-evidence-budget.js';
import {
  initialStats,
  streamBody,
  type BodyInput,
  type StreamStats,
} from './body-evidence-stream.js';
export { initializeEvidenceLane } from './body-evidence-budget.js';

export interface BodyIdentity {
  attempt: string;
  case: string;
  side: string;
  signal?: AbortSignal;
}
export interface BodyReceipt extends StreamStats {
  mode: 'sha256+gzip-stream';
  id: string;
  attempt: string;
  case: string;
  side: string;
  compressedPath: string;
  receiptPath: string;
  incomplete: boolean;
  exit: number | null;
  exitScope: 'evidence-write';
  error: string | null;
}

function saveReceipt(receipt: BodyReceipt): void {
  const temporary = receipt.receiptPath + '.tmp';
  const fd = openSync(temporary, 'wx');
  try {
    writeFileSync(fd, JSON.stringify(receipt) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, receipt.receiptPath);
  const directory = openSync(dirname(receipt.receiptPath), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function validateIdentity(identity: BodyIdentity): void {
  for (const text of [identity.attempt, identity.case, identity.side])
    if (typeof text !== 'string' || text.length === 0 || text.length > 2048)
      throw new Error('Invalid BODY evidence identity');
}

export async function writeCompactBody(
  root: string,
  input: BodyInput,
  identity: BodyIdentity,
): Promise<BodyReceipt> {
  validateIdentity(identity);
  requireLanePath(root, join(root, '.validation'));
  return withLaneLock(root, async () => {
    requireBudget(root, 32768);
    const id = randomUUID();
    const finalPath = join(root, id + '.body.gz');
    const receipt: BodyReceipt = {
      ...initialStats(input),
      mode: 'sha256+gzip-stream',
      id,
      attempt: identity.attempt,
      case: identity.case,
      side: identity.side,
      compressedPath: finalPath + '.part',
      receiptPath: join(root, id + '.receipt.json'),
      incomplete: true,
      exit: null,
      exitScope: 'evidence-write',
      error: 'started; terminal status pending',
    };
    saveReceipt(receipt);
    try {
      await streamBody(
        root,
        receipt.compressedPath,
        input,
        receipt,
        identity.signal,
      );
      renameSync(receipt.compressedPath, finalPath);
      receipt.compressedPath = finalPath;
      receipt.incomplete = false;
      receipt.exit = 0;
      receipt.error = null;
      saveReceipt(receipt);
      return receipt;
    } catch (error) {
      receipt.exit = 1;
      receipt.error = error instanceof Error ? error.message : String(error);
      saveReceipt(receipt);
      throw error;
    }
  });
}

function compactRoot(env: NodeJS.ProcessEnv): string | undefined {
  if (env.BODY_EVIDENCE_MODE === undefined) return undefined;
  if (env.BODY_EVIDENCE_MODE !== 'sha256+gzip-stream')
    throw new Error('Unknown BODY evidence mode');
  if (!env.BODY_EVIDENCE_ROOT || !env.BODY_EVIDENCE_ATTEMPT)
    throw new Error('Declare BODY evidence root and attempt');
  return env.BODY_EVIDENCE_ROOT;
}

export async function writeBodyFile(
  path: string,
  body: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const root = compactRoot(env);
  if (root === undefined) {
    writeFileSync(path, body);
    return;
  }
  requireLanePath(root, path);
  const name = basename(path);
  let side = 'artifact';
  if (name.includes('actual')) side = 'actual';
  if (name.includes('expected')) side = 'expected';
  await writeCompactBody(root, body, {
    attempt: env.BODY_EVIDENCE_ATTEMPT ?? '',
    case: name,
    side,
  });
}

export async function appendBodyEvidence(
  path: string,
  record: Record<string, unknown>,
  actual: string,
  expected: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const root = compactRoot(env);
  if (root === undefined) {
    appendFileSync(path, JSON.stringify(record) + '\n');
    return;
  }
  requireLanePath(root, path);
  const dimensions = Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) =>
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        (typeof value === 'string' && value.length <= 128),
    ),
  );
  const identity = {
    attempt: env.BODY_EVIDENCE_ATTEMPT ?? '',
    case: basename(path) + ':' + JSON.stringify(dimensions),
  };
  const evidence: BodyReceipt[] = [];
  for (const [side, body] of [
    ['actual', actual],
    ['expected', expected],
  ])
    evidence.push(await writeCompactBody(root, body, { ...identity, side }));
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.length > 4096)
      summary[key] = await writeCompactBody(root, value, {
        ...identity,
        side: key,
      });
    else summary[key] = value;
  }
  const line =
    JSON.stringify({ ...summary, mode: 'sha256+gzip-stream', evidence }) + '\n';
  if (Buffer.byteLength(line) > 16384)
    throw new Error('Oversized BODY evidence metadata');
  await withLaneLock(root, async () => {
    requireBudget(root, Buffer.byteLength(line) + 16384);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line);
  });
}

export async function recordTransportBody(
  body: string,
  provider: string,
  transportAttempt: number,
  captureId: string,
): Promise<void> {
  const root = compactRoot(process.env);
  if (root === undefined) return;
  await writeCompactBody(root, body, {
    attempt: process.env.BODY_EVIDENCE_ATTEMPT ?? '',
    case: `${process.env.BODY_EVIDENCE_CASE ?? 'unspecified'}:${provider}:${captureId}`,
    side: `transport-${transportAttempt}`,
  });
}

export async function captureBodyAttempt(
  bodies: string[],
  body: BodyInit | null,
  provider: string,
  captureId: string,
): Promise<void> {
  bodies.push(await new Response(body).text());
  await recordTransportBody(
    bodies[bodies.length - 1],
    provider,
    bodies.length,
    captureId,
  );
}
