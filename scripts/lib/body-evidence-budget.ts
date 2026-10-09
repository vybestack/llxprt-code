/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const MAX_CAP = 100 * 1024 * 1024;
const RESERVE = 256 * 1024;
const MARKER = '.body-evidence-lane.json';

export interface Footprint {
  logical: number;
  allocated: number;
}

export function laneFootprint(root: string): Footprint {
  const total = { logical: 0, allocated: 0 };
  function visit(path: string): void {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1))
      throw new Error('Evidence lane cannot contain links');
    total.logical += stat.size;
    total.allocated += stat.blocks * 512;
    if (stat.isDirectory())
      for (const name of readdirSync(path)) visit(join(path, name));
  }
  visit(root);
  return total;
}

export function initializeEvidenceLane(root: string, cap = MAX_CAP): void {
  if (!Number.isSafeInteger(cap) || cap > MAX_CAP || cap <= RESERVE * 2)
    throw new Error('Invalid whole-lane budget');
  if (existsSync(root)) throw new Error('Evidence lane must be new');
  mkdirSync(root);
  writeFileSync(join(root, MARKER), JSON.stringify({ cap }), { flag: 'wx' });
}

function laneCap(root: string): number {
  const data: unknown = JSON.parse(readFileSync(join(root, MARKER), 'utf8'));
  if (
    typeof data !== 'object' ||
    data === null ||
    !('cap' in data) ||
    typeof data.cap !== 'number'
  )
    throw new Error('Invalid evidence lane marker');
  const cap = data.cap;
  if (!Number.isSafeInteger(cap) || cap > MAX_CAP || cap <= RESERVE * 2)
    throw new Error('Invalid evidence lane budget');
  return cap;
}

export function requireLanePath(root: string, path: string): void {
  if (realpathSync(root) !== resolve(root)) throw new Error('Linked lane root');
  const rel = relative(root, resolve(path));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Evidence output is outside declared lane');
  let current = resolve(path);
  while (current !== resolve(root)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error('Linked evidence output');
    current = resolve(current, '..');
  }
}

export function requireBudget(root: string, growth: number): void {
  const footprint = laneFootprint(root);
  const cap = laneCap(root);
  // Reserve covers terminal receipts, atomic metadata scratch and driver logs.
  const allocation = Math.ceil(growth / 65536) * 65536;
  if (
    footprint.logical + growth + RESERVE >= cap ||
    footprint.allocated + allocation + RESERVE >= cap
  )
    throw new Error('Whole-lane evidence budget refused');
}

export async function withLaneLock<T>(
  root: string,
  action: () => Promise<T>,
): Promise<T> {
  const lock = join(root, '.body-evidence-lock');
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      )
        throw error;
      if (Date.now() >= deadline)
        throw new Error('Evidence lane locked or interrupted');
      await setTimeout(10);
    }
  }
  try {
    return await action();
  } finally {
    rmdirSync(lock);
  }
}
