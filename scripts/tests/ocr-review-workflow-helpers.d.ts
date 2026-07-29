/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function readRootFile(relPath: string): string;
export function normalize(value: unknown): string;
export function commandText(step: unknown): string;
export function stepNamed(job: unknown, name: string): unknown;
export function expectContainsAll(value: string, snippets: string[]): void;
export function hasPerl(): boolean;
export function hasBashAndPerl(): boolean;
export function commonCredentialInput(): string;
export function expectCommonCredentialsRedacted(sanitized: string): void;
export function extractFunctionSource(
  source: string,
  functionName: string,
): string;
export function makePostSanitizer(
  postScript: string,
  token: string,
  url?: string,
  context?: Record<string, unknown>,
): unknown;
export function executeNotifySanitizer(
  notifyRun: string,
  input: string,
  token: string,
  extraEnv?: Record<string, string>,
): string;
export function runNotifySanitizer(
  notifyRun: string,
  input: string,
  token: string,
  extraEnv?: Record<string, string>,
): string;
export const WORKFLOW_PATH: string;
