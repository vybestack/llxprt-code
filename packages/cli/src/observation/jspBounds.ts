/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function utf8ByteLength(input: string): number {
  return Buffer.byteLength(input, 'utf8');
}

export function withinByteBound(input: string, maxBytes: number): boolean {
  return utf8ByteLength(input) <= maxBytes;
}

export const JSP_BOUNDS = {
  documentBytes: 256 * 1024,
  idBytes: 128,
  todoEntries: 256,
  todoTextBytes: 2 * 1024,
  displayedContentBytes: 16 * 1024,
  diagnosticSummaryBytes: 2 * 1024,
  toolLabelBytes: 256,
  repositoryBytes: 256,
  pathBytes: 4 * 1024,
  agentKindBytes: 64,
  displayNameBytes: 256,
  diagnosticCodeBytes: 128,
  sourceErrorCodeBytes: 128,
};
