/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { JSP_BOUNDS, utf8ByteLength } from './jspBounds.js';

const SCHEMA_VERSION = 1;
const PROTOCOL = 'jsp/1';

export type JspErrorCode =
  | 'JSP-E001'
  | 'JSP-E002'
  | 'JSP-E003'
  | 'JSP-E004'
  | 'JSP-E005'
  | 'JSP-E006';

export interface JspError {
  readonly code: JspErrorCode;
  readonly message: string;
}

export type JspResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: JspError };

export function ok<T>(value: T): JspResult<T> {
  return { ok: true, value };
}

export function err<T>(code: JspErrorCode, message: string): JspResult<T> {
  return { ok: false, error: { code, message } };
}

const opaqueIdRegex = /^[A-Za-z0-9._-]+$/;

// The protocol contract bounds IDs by inclusive UTF-8 bytes, not UTF-16 code
// units. agent_id is ASCII-constrained by the regex above so it is safe, but
// registration_id has no such constraint and must be checked explicitly.
function withinIdBytes(value: string): boolean {
  return utf8ByteLength(value) <= JSP_BOUNDS.idBytes;
}

const BootstrapSchema = z
  .object({
    schema: z.literal(SCHEMA_VERSION),
    protocol: z.literal(PROTOCOL),
    endpoint: z.string().min(1),
    registration_id: z.string().min(1).refine(withinIdBytes, {
      message: 'registration_id exceeds the UTF-8 byte bound',
    }),
    publisher_credential: z.string().min(1),
    agent_id: z.string().min(1).max(128).regex(opaqueIdRegex),
    lifecycle_generation: z.number().int().positive(),
  })
  .strict();

export type JspBootstrapInput = {
  schema: typeof SCHEMA_VERSION;
  protocol: typeof PROTOCOL;
  endpoint: string;
  registration_id: string;
  publisher_credential: string;
  agent_id: string;
  lifecycle_generation: number;
};

export interface JspBootstrap {
  readonly schema: typeof SCHEMA_VERSION;
  readonly protocol: typeof PROTOCOL;
  readonly endpoint: string;
  readonly registrationId: string;
  readonly publisherCredential: string;
  readonly agentId: string;
  readonly lifecycleGeneration: number;
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost') return true;
  if (lower.endsWith('.localhost')) return true;
  // URL parsing keeps an IPv6 literal wrapped in brackets, so comparing the
  // hostname directly against "::1" never matches. It also compresses the
  // long form, but both are handled here so the check does not depend on
  // that normalisation.
  const host =
    lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host === '127.0.0.1') return true;
  const octet = '(?:25[0-5]|2[0-4]\\d|1\\d{2}|0\\d{2}|\\d{1,2})';
  return new RegExp(`^127\\.${octet}\\.${octet}\\.${octet}$`).test(host);
}

function classifyEndpoint(
  endpoint: string,
): { ok: true; url: URL } | { ok: false; code: JspErrorCode } {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { ok: false, code: 'JSP-E001' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, code: 'JSP-E004' };
  }
  if (!isLoopbackHost(parsed.hostname)) {
    return { ok: false, code: 'JSP-E004' };
  }
  // The publisher appends the "/jsp/1" route segment to this endpoint. A query
  // or fragment would end up before that segment and produce a malformed URL,
  // so reject it here rather than silently building a broken request target.
  if (parsed.search !== '' || parsed.hash !== '') {
    return { ok: false, code: 'JSP-E001' };
  }
  return { ok: true, url: parsed };
}

function zodToJspError(issue: z.ZodIssue): JspErrorCode {
  const code = issue.code;
  const lastPath = issue.path[issue.path.length - 1];
  if (code === z.ZodIssueCode.too_big) return 'JSP-E002';
  if (code === z.ZodIssueCode.too_small) {
    if (lastPath === 'lifecycle_generation') return 'JSP-E004';
    return 'JSP-E002';
  }
  if (
    code === z.ZodIssueCode.invalid_literal ||
    code === z.ZodIssueCode.invalid_type
  ) {
    if (lastPath === 'protocol' || lastPath === 'schema') return 'JSP-E003';
    return 'JSP-E001';
  }
  return 'JSP-E001';
}

export function parseBootstrap(input: unknown): JspResult<JspBootstrap> {
  const parsed = BootstrapSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    if (first.code === z.ZodIssueCode.unrecognized_keys) {
      return err('JSP-E001', 'unknown field');
    }
    return err(zodToJspError(first), first.message);
  }
  const endpointCheck = classifyEndpoint(parsed.data.endpoint);
  if (!endpointCheck.ok) {
    return err(endpointCheck.code, 'endpoint not loopback');
  }
  return ok({
    schema: parsed.data.schema,
    protocol: parsed.data.protocol,
    endpoint: parsed.data.endpoint,
    registrationId: parsed.data.registration_id,
    publisherCredential: parsed.data.publisher_credential,
    agentId: parsed.data.agent_id,
    lifecycleGeneration: parsed.data.lifecycle_generation,
  });
}

export interface JspProducerIdentity {
  readonly agentId: string;
  readonly lifecycleGeneration: number;
  readonly sourceEpoch: string;
  readonly startedAtMs: number;
  readonly pid: number;
}

function generateSourceEpoch(): string {
  const crypto = globalThis.crypto;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return `ep-${out}`;
}

export function createProducerIdentity(
  bootstrap: JspBootstrap,
  now: () => number,
): JspProducerIdentity {
  return {
    agentId: bootstrap.agentId,
    lifecycleGeneration: bootstrap.lifecycleGeneration,
    sourceEpoch: generateSourceEpoch(),
    startedAtMs: now(),
    pid: process.pid,
  };
}
