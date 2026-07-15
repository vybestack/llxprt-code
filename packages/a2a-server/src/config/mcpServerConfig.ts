/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuthProviderType,
  type LlxprtExtension,
  type MCPOAuthConfig,
  type MCPServerConfig,
} from '@vybestack/llxprt-code-core';

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value);
  return entries.every(([, entry]) => typeof entry === 'string')
    ? Object.fromEntries(entries)
    : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
    ? value
    : undefined;
}

function readOAuthConfig(value: unknown): MCPOAuthConfig | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const config: MCPOAuthConfig = {};
  const enabled = Reflect.get(value, 'enabled');
  if (typeof enabled === 'boolean') config.enabled = enabled;
  for (const key of [
    'clientId',
    'clientSecret',
    'authorizationUrl',
    'tokenUrl',
    'redirectUri',
    'tokenParamName',
    'registrationUrl',
  ] as const) {
    const field = Reflect.get(value, key);
    if (typeof field === 'string') config[key] = field;
  }
  const scopes = readStringArray(Reflect.get(value, 'scopes'));
  if (scopes !== undefined) config.scopes = scopes;
  const audiences = readStringArray(Reflect.get(value, 'audiences'));
  if (audiences !== undefined) config.audiences = audiences;
  return config;
}

function readNestedExtension(value: unknown): LlxprtExtension | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const name = Reflect.get(value, 'name');
  const version = Reflect.get(value, 'version');
  const isActive = Reflect.get(value, 'isActive');
  const extensionPath = Reflect.get(value, 'path');
  const contextFiles = readStringArray(Reflect.get(value, 'contextFiles'));
  if (typeof name !== 'string' || typeof version !== 'string') {
    return undefined;
  }
  if (typeof isActive !== 'boolean' || typeof extensionPath !== 'string') {
    return undefined;
  }
  if (contextFiles === undefined) {
    return undefined;
  }
  return { name, version, isActive, path: extensionPath, contextFiles };
}

type MutableMcpServerConfig = {
  -readonly [K in keyof MCPServerConfig]: MCPServerConfig[K];
};

function assignTransportFields(
  result: MutableMcpServerConfig,
  value: object,
): void {
  const command = Reflect.get(value, 'command');
  if (typeof command === 'string') result.command = command;
  const args = readStringArray(Reflect.get(value, 'args'));
  if (args !== undefined) result.args = args;
  const env = readStringRecord(Reflect.get(value, 'env'));
  if (env !== undefined) result.env = env;
  const headers = readStringRecord(Reflect.get(value, 'headers'));
  if (headers !== undefined) result.headers = headers;
  for (const key of ['cwd', 'url', 'httpUrl', 'tcp'] as const) {
    const field = Reflect.get(value, key);
    if (typeof field === 'string') result[key] = field;
  }
  const type = Reflect.get(value, 'type');
  if (type === 'http' || type === 'sse') result.type = type;
}

function assignMetadataFields(
  result: MutableMcpServerConfig,
  value: object,
): void {
  const timeout = Reflect.get(value, 'timeout');
  if (typeof timeout === 'number') result.timeout = timeout;
  for (const key of [
    'description',
    'extensionName',
    'targetAudience',
    'targetServiceAccount',
  ] as const) {
    const field = Reflect.get(value, key);
    if (typeof field === 'string') result[key] = field;
  }
  const extension = readNestedExtension(Reflect.get(value, 'extension'));
  if (extension !== undefined) result.extension = extension;
  const includeTools = readStringArray(Reflect.get(value, 'includeTools'));
  if (includeTools !== undefined) result.includeTools = includeTools;
  const excludeTools = readStringArray(Reflect.get(value, 'excludeTools'));
  if (excludeTools !== undefined) result.excludeTools = excludeTools;
  const oauth = readOAuthConfig(Reflect.get(value, 'oauth'));
  if (oauth !== undefined) result.oauth = oauth;
  const authProviderType = Reflect.get(value, 'authProviderType');
  if (Object.values(AuthProviderType).includes(authProviderType)) {
    result.authProviderType = authProviderType;
  }
}

export function readMcpServerConfig(
  value: object,
): MCPServerConfig | undefined {
  const result: MutableMcpServerConfig = {};
  assignTransportFields(result, value);
  if (
    result.command === undefined &&
    result.url === undefined &&
    result.httpUrl === undefined &&
    result.tcp === undefined
  ) {
    return undefined;
  }
  assignMetadataFields(result, value);
  return result;
}
