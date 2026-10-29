/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
export function fieldOf(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}
export function isSpeakerContent(value: unknown): value is IContent {
  const speaker = fieldOf(value, 'speaker');
  if (speaker !== 'human' && speaker !== 'ai' && speaker !== 'tool')
    return false;
  return Array.isArray(fieldOf(value, 'blocks'));
}
export function isValidSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function isSpeakerContentArray(
  value: unknown,
): value is readonly IContent[] {
  return Array.isArray(value) && value.every(isSpeakerContent);
}
export interface DensityReplacementRecordShape {
  readonly replacedSeq: number;
  readonly replacement: IContent;
}
export function isDensityReplacementRecord(
  value: unknown,
): value is DensityReplacementRecordShape {
  if (!isRecord(value)) return false;
  if (!isValidSequence(value['replacedSeq'])) return false;
  return isSpeakerContent(value['replacement']);
}
