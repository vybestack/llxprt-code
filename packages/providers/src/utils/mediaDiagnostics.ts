/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';

export type PhysicalMediaTransportMode =
  | 'full'
  | 'delta'
  | 'provider-file'
  | 'url';

export interface DiagnosticSanitizationOptions {
  readonly media?: 'summary' | 'raw';
  readonly mediaTransportMode?: Extract<
    PhysicalMediaTransportMode,
    'full' | 'delta'
  >;
}

interface MediaDiagnostic {
  readonly contentId?: string;
  readonly byteCount?: number;
  readonly mimeType?: string;
  readonly transportMode: PhysicalMediaTransportMode;
}

const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const OMITTED_DIAGNOSTIC_KEYS = new Set([
  'caption',
  'credentialhash',
  'filename',
  'password',
  'providermetadata',
  'secret',
  'sourcepath',
  'token',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(
  value: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === 'string' && field.length > 0) return field;
  }
  return undefined;
}

function numberField(
  value: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const field = value[key];
    if (
      typeof field === 'number' &&
      Number.isSafeInteger(field) &&
      field >= 0
    ) {
      return field;
    }
  }
  return undefined;
}

function base64Padding(payload: string): number {
  if (payload.endsWith('==')) return 2;
  return payload.endsWith('=') ? 1 : 0;
}

function base64Diagnostic(
  data: string,
  mimeType: string | undefined,
  transportMode: 'full' | 'delta',
): MediaDiagnostic {
  const comma = data.toLowerCase().startsWith('data:') ? data.indexOf(',') : -1;
  const payload = (comma < 0 ? data : data.slice(comma + 1)).replace(
    /\s+/g,
    '',
  );
  const dataUriMime =
    comma < 0 ? undefined : data.slice(5, comma).split(';', 1)[0];
  if (
    payload.length === 0 ||
    payload.length % 4 !== 0 ||
    !BASE64_PATTERN.test(payload)
  ) {
    return {
      ...((mimeType ?? dataUriMime)
        ? { mimeType: mimeType ?? dataUriMime }
        : {}),
      transportMode,
    };
  }
  const hash = createHash('sha256');
  const chunkCharacters = 64 * 1024;
  for (let offset = 0; offset < payload.length; offset += chunkCharacters) {
    hash.update(payload.slice(offset, offset + chunkCharacters), 'base64');
  }
  return {
    contentId: `sha256:${hash.digest('hex')}`,
    byteCount: (payload.length / 4) * 3 - base64Padding(payload),
    ...((mimeType ?? dataUriMime) ? { mimeType: mimeType ?? dataUriMime } : {}),
    transportMode,
  };
}

function externalReferenceDiagnostic(
  value: string,
  mimeType: string | undefined,
): MediaDiagnostic {
  if (value.toLowerCase().startsWith('data:')) {
    return base64Diagnostic(value, mimeType, 'full');
  }
  const transportMode = /^https?:\/\//i.test(value) ? 'url' : 'provider-file';
  return { ...(mimeType === undefined ? {} : { mimeType }), transportMode };
}

function neutralMediaDiagnostic(
  value: Readonly<Record<string, unknown>>,
  defaultMode: 'full' | 'delta',
): MediaDiagnostic | undefined {
  if (value['type'] !== 'media') return undefined;
  const encoding = value['encoding'];
  const mimeType = stringField(value, 'mimeType');
  if (encoding === 'reference') {
    const contentId = stringField(value, 'contentId', 'selectedContentId');
    const byteCount = numberField(value, 'byteLength');
    return {
      ...(contentId === undefined ? {} : { contentId }),
      ...(byteCount === undefined ? {} : { byteCount }),
      ...(mimeType === undefined ? {} : { mimeType }),
      transportMode: defaultMode,
    };
  }
  const data = stringField(value, 'data');
  if (encoding === 'base64' && data !== undefined) {
    return base64Diagnostic(data, mimeType, defaultMode);
  }
  if (encoding === 'url' && data !== undefined) {
    return externalReferenceDiagnostic(data, mimeType);
  }
  return {
    ...(mimeType === undefined ? {} : { mimeType }),
    transportMode: defaultMode,
  };
}

function anthropicMediaDiagnostic(
  value: Readonly<Record<string, unknown>>,
  defaultMode: 'full' | 'delta',
): MediaDiagnostic | undefined {
  if (value['type'] !== 'image' && value['type'] !== 'document')
    return undefined;
  const source = value['source'];
  if (!isRecord(source)) return undefined;
  const mimeType = stringField(source, 'media_type', 'mime_type');
  const data = stringField(source, 'data');
  if (source['type'] === 'base64' && data !== undefined) {
    return base64Diagnostic(data, mimeType, defaultMode);
  }
  const url = stringField(source, 'url');
  if (url !== undefined) return externalReferenceDiagnostic(url, mimeType);
  if (source['type'] === 'file' || stringField(source, 'file_id', 'fileId')) {
    return {
      ...(mimeType === undefined ? {} : { mimeType }),
      transportMode: 'provider-file',
    };
  }
  return undefined;
}

function openAIMediaDiagnostic(
  value: Readonly<Record<string, unknown>>,
  defaultMode: 'full' | 'delta',
): MediaDiagnostic | undefined {
  const type = value['type'];
  if (type !== 'image_url' && type !== 'input_image' && type !== 'input_file') {
    return undefined;
  }
  const imageURL = value['image_url'];
  if (typeof imageURL === 'string') {
    return externalReferenceDiagnostic(imageURL, undefined);
  }
  if (isRecord(imageURL)) {
    const url = stringField(imageURL, 'url');
    if (url !== undefined) return externalReferenceDiagnostic(url, undefined);
  }
  const fileData = stringField(value, 'file_data');
  const mimeType = stringField(value, 'mime_type', 'mimeType');
  if (fileData !== undefined) {
    return base64Diagnostic(fileData, mimeType, defaultMode);
  }
  if (stringField(value, 'file_id', 'fileId', 'file_url')) {
    return {
      ...(mimeType === undefined ? {} : { mimeType }),
      transportMode: 'provider-file',
    };
  }
  return {
    ...(mimeType === undefined ? {} : { mimeType }),
    transportMode: defaultMode,
  };
}

function inlineDataMediaDiagnostic(
  value: Readonly<Record<string, unknown>>,
  defaultMode: 'full' | 'delta',
): MediaDiagnostic | undefined {
  const inlineData = value['inlineData'] ?? value['inline_data'];
  if (!isRecord(inlineData)) return undefined;
  const data = stringField(inlineData, 'data');
  if (data === undefined) return undefined;
  return base64Diagnostic(
    data,
    stringField(inlineData, 'mimeType', 'mime_type'),
    defaultMode,
  );
}

function mediaDiagnostic(
  value: Readonly<Record<string, unknown>>,
  defaultMode: 'full' | 'delta',
): MediaDiagnostic | undefined {
  return (
    neutralMediaDiagnostic(value, defaultMode) ??
    anthropicMediaDiagnostic(value, defaultMode) ??
    openAIMediaDiagnostic(value, defaultMode) ??
    inlineDataMediaDiagnostic(value, defaultMode)
  );
}

const SENSITIVE_DIAGNOSTIC_SUFFIXES = [
  'apikey',
  'credential',
  'password',
  'secret',
  'token',
] as const;

function shouldOmitKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, '').toLowerCase();
  return (
    OMITTED_DIAGNOSTIC_KEYS.has(normalized) ||
    SENSITIVE_DIAGNOSTIC_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function sanitizeValue(
  value: unknown,
  defaultMode: 'full' | 'delta',
  rawMedia: boolean,
  ancestors: WeakSet<object>,
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (ancestors.has(value)) return '[unserializable]';
  ancestors.add(value);
  if (Array.isArray(value)) {
    const sanitized = value.map((entry) =>
      sanitizeValue(entry, defaultMode, rawMedia, ancestors),
    );
    ancestors.delete(value);
    return sanitized;
  }
  if (!isRecord(value)) {
    throw new TypeError('Diagnostic object could not be traversed');
  }
  if (!rawMedia) {
    const diagnostic = mediaDiagnostic(value, defaultMode);
    if (diagnostic !== undefined) {
      ancestors.delete(value);
      return diagnostic;
    }
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (shouldOmitKey(key)) continue;
    sanitized[key] = sanitizeValue(entry, defaultMode, rawMedia, ancestors);
  }
  ancestors.delete(value);
  return sanitized;
}

export function sanitizeDiagnosticData(
  value: unknown,
  options: DiagnosticSanitizationOptions = {},
): unknown {
  return sanitizeValue(
    value,
    options.mediaTransportMode ?? 'full',
    options.media === 'raw',
    new WeakSet<object>(),
  );
}
