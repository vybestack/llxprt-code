/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import type { OutputLimitConfig } from '../utils/toolOutputLimiter.js';
import type { RowEntry } from './rowEntry.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import type { Version } from './version.js';
import type { SlotSummary } from './slotSummary.js';
import type { NativeFactIndexRegistration } from './nativeFactIndex.js';

export interface RowFormatSettings {
  readonly formatId:
    | 'openai-chat:plain'
    | 'openai-chat:openai'
    | 'openai-chat:kimi'
    | 'openai-chat:mistral'
    | 'responses'
    | 'anthropic';
  readonly formatRev: number;
  readonly model: string;
  readonly endpoint: string;
  readonly isOAuth: boolean;
  readonly toolNameTransform: 'none' | 'oauth';
  readonly supportsUrlImages: boolean;
  readonly reasoningEnabled: boolean;
  readonly reasoningFieldName: string;
  readonly mediaPdfEnabled: boolean;
  readonly unsupportedMedia: 'notice' | 'reject';
  readonly outputLimits: Readonly<OutputLimitConfig> | null;
  readonly chat?: {
    readonly includeInContext: boolean;
    readonly toolFormat?: 'openai' | 'mistral' | 'kimi';
    readonly mistralRevision?: string;
    readonly estimatorKey?: string;
  };
  readonly anthropic?: {
    readonly cache: 'off' | '5m' | '1h';
    readonly cacheFacts?: boolean;
    readonly imageBudget: {
      readonly maxDimension?: number;
      readonly maxPixels?: number;
    } | null;
  };
}

function ordered(value: unknown): string {
  if (value === undefined)
    throw new TypeError('Format settings must be JSON values');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(ordered).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
    .map(([key, item]) => `${JSON.stringify(key)}:${ordered(item)}`)
    .join(',')}}`;
}

export function rowFormatKey(settings: RowFormatSettings): bigint {
  return createHash('sha256')
    .update(ordered(settings))
    .digest()
    .readBigUInt64LE(0);
}

export interface RowLengthFacts {
  readonly summary: SlotSummary;
  readonly lens: Uint8Array;
  readonly pdfBytes?: number;
}

export interface RowFormatFill {
  readonly measure: RowFormatRegistration['measure'];
  finish(): Promise<Uint8Array>;
  close(): void | Promise<void>;
}

export interface RowFormatRegistration {
  readonly settings: RowFormatSettings;
  readonly incremental?: 'unsupported' | 'append';
  readonly nativeFactScope?: string;
  readonly nativeFacts?: NativeFactIndexRegistration;
  readonly mistralSlot?: number;
  readonly mistral?: boolean;
  readonly prepareAppend?: (
    snapshot: VersionSnapshot,
    settings: RowFormatSettings,
    previous: Version,
  ) => Promise<RowFormatFill>;
  readonly prepare?: (
    snapshot: VersionSnapshot,
    settings: RowFormatSettings,
  ) => Promise<RowFormatFill>;
  readonly measure: (
    snapshot: VersionSnapshot,
    entry: RowEntry,
    settings: RowFormatSettings,
  ) => Promise<RowLengthFacts>;
}

export function captureRowFormatSettings(
  input: RowFormatSettings,
): RowFormatSettings {
  const settings = structuredClone(input);
  if (settings.outputLimits !== null) {
    Object.freeze(settings.outputLimits.tokenLimit);
    Object.freeze(settings.outputLimits);
  }
  if (settings.chat !== undefined) Object.freeze(settings.chat);
  if (settings.anthropic !== undefined) {
    Object.freeze(settings.anthropic.imageBudget);
    Object.freeze(settings.anthropic);
  }
  return Object.freeze(settings);
}

export function captureRowFormat(
  registration: RowFormatRegistration,
): RowFormatRegistration {
  return {
    settings: captureRowFormatSettings(registration.settings),
    measure: registration.measure,
    prepare: registration.prepare,
    prepareAppend: registration.prepareAppend,
    incremental: registration.incremental,
    nativeFactScope: registration.nativeFactScope,
    nativeFacts: registration.nativeFacts,
    mistralSlot: registration.mistralSlot,
    mistral: registration.mistral,
  };
}

export function rowFormatAuxKey(slot: number): string {
  return `format:aux:${slot}`;
}
