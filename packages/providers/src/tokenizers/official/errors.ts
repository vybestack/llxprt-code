/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Typed error classes for official-tokenizer asset and runtime failures.
 *
 * Registered models must never silently fall back to the generic
 * word/character estimator. Every failure path throws one of these
 * typed errors so callers receive actionable diagnostics.
 */

export type OfficialTokenizerErrorKind =
  | 'asset-missing'
  | 'asset-corrupt'
  | 'checksum-mismatch'
  | 'incompatible-format'
  | 'tokenization-failed';

export class OfficialTokenizerError extends Error {
  readonly kind: OfficialTokenizerErrorKind;
  readonly model: string;
  readonly assetPath?: string;

  constructor(
    kind: OfficialTokenizerErrorKind,
    model: string,
    message: string,
    assetPath?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OfficialTokenizerError';
    this.kind = kind;
    this.model = model;
    this.assetPath = assetPath;
  }
}

export function assetMissingError(
  model: string,
  assetPath: string,
): OfficialTokenizerError {
  return new OfficialTokenizerError(
    'asset-missing',
    model,
    `Tokenizer asset for ${model} not found at ${assetPath}. The pinned BPE file is required for offline tokenization.`,
    assetPath,
  );
}

export function assetCorruptError(
  model: string,
  assetPath: string,
  detail: string,
  cause?: unknown,
): OfficialTokenizerError {
  return new OfficialTokenizerError(
    'asset-corrupt',
    model,
    `Tokenizer asset for ${model} at ${assetPath} is corrupt or unreadable: ${detail}`,
    assetPath,
    { cause },
  );
}

export function checksumMismatchError(
  model: string,
  assetPath: string,
  expected: string,
  actual: string,
): OfficialTokenizerError {
  return new OfficialTokenizerError(
    'checksum-mismatch',
    model,
    `Checksum mismatch for ${model} tokenizer asset at ${assetPath}. Expected ${expected}, got ${actual}.`,
    assetPath,
  );
}

export function incompatibleFormatError(
  model: string,
  detail: string,
): OfficialTokenizerError {
  return new OfficialTokenizerError(
    'incompatible-format',
    model,
    `Tokenizer asset for ${model} is in an incompatible format: ${detail}`,
  );
}

export function tokenizationFailedError(
  model: string,
  detail: string,
  cause?: unknown,
): OfficialTokenizerError {
  return new OfficialTokenizerError(
    'tokenization-failed',
    model,
    `Tokenization failed for ${model}: ${detail}`,
    undefined,
    { cause },
  );
}
