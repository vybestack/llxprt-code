/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import {
  ExternalAccountAuthorizedUserClient,
  ExternalAccountClient,
  gaxios,
  Impersonated,
  JWT,
  UserRefreshClient,
  type AuthClient,
  type ExternalAccountAuthorizedUserClientOptions,
  type ExternalAccountClientOptions,
  type JWTInput,
} from 'google-auth-library';
import type {
  GoogleCredentialEnvironment,
  GoogleCredentialJson,
} from './geminiWireTypes.js';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const MAX_IMPERSONATION_URL_LENGTH = 256;

type OwnerFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GoogleCredentialSelection {
  readonly fetch: OwnerFetch;
  readonly credentials?: GoogleCredentialJson;
  readonly environment: GoogleCredentialEnvironment;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function parseCredentialFile(path: string, text: string): GoogleCredentialJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Unable to parse the Google credential file ${path}: ${describeError(error)}`,
      { cause: error },
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`The Google credential file ${path} is not a JSON object`);
  }
  return parsed as GoogleCredentialJson;
}

async function readCredentialFile(
  path: string,
  missingIsAbsent: false,
): Promise<GoogleCredentialJson>;
async function readCredentialFile(
  path: string,
  missingIsAbsent: true,
): Promise<GoogleCredentialJson | undefined>;
async function readCredentialFile(
  path: string,
  missingIsAbsent: boolean,
): Promise<GoogleCredentialJson | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (missingIsAbsent && isMissingFile(error)) {
      return undefined;
    }
    throw new Error(
      `Unable to read the Google credential file ${path}: ${describeError(error)}`,
      { cause: error },
    );
  }
  return parseCredentialFile(path, text);
}

function buildImpersonated(
  json: GoogleCredentialJson,
  transporter: gaxios.Gaxios,
  source: string,
): Impersonated {
  const url = json['service_account_impersonation_url'];
  const sourceCredentials = json['source_credentials'];
  if (typeof url !== 'string') {
    throw new Error(
      `The impersonated Google credential in ${source} has no service_account_impersonation_url`,
    );
  }
  if (
    typeof sourceCredentials !== 'object' ||
    sourceCredentials === null ||
    Array.isArray(sourceCredentials)
  ) {
    throw new Error(
      `The impersonated Google credential in ${source} has no source_credentials`,
    );
  }
  if (url.length > MAX_IMPERSONATION_URL_LENGTH) {
    throw new RangeError(`Target principal is too long: ${url}`);
  }
  const targetPrincipal =
    /(?<target>[^/]+):(generateAccessToken|generateIdToken)$/.exec(url)
      ?.groups?.['target'];
  if (targetPrincipal === undefined) {
    throw new RangeError(`Cannot extract target principal from ${url}`);
  }
  return new Impersonated({
    ...json,
    sourceClient: buildCredentialClient(
      sourceCredentials as GoogleCredentialJson,
      transporter,
      source,
    ),
    targetPrincipal,
    targetScopes: [CLOUD_PLATFORM_SCOPE],
    transporter,
  });
}

function buildExternalAccount(
  json: GoogleCredentialJson,
  transporter: gaxios.Gaxios,
  source: string,
): AuthClient {
  const client = ExternalAccountClient.fromJSON({
    ...json,
    transporter,
    scopes: [CLOUD_PLATFORM_SCOPE],
  } as ExternalAccountClientOptions);
  if (client === null) {
    throw new Error(
      `The external account Google credential in ${source} is not supported`,
    );
  }
  return client;
}

function buildCredentialClient(
  json: GoogleCredentialJson,
  transporter: gaxios.Gaxios,
  source: string,
): AuthClient {
  switch (json['type']) {
    case 'service_account': {
      const client = new JWT({ transporter, scopes: [CLOUD_PLATFORM_SCOPE] });
      client.fromJSON(json as JWTInput);
      return client;
    }
    case 'authorized_user': {
      const client = new UserRefreshClient({ transporter });
      client.fromJSON(json as Parameters<UserRefreshClient['fromJSON']>[0]);
      return client;
    }
    case 'impersonated_service_account':
      return buildImpersonated(json, transporter, source);
    case 'external_account_authorized_user':
      return new ExternalAccountAuthorizedUserClient({
        ...json,
        transporter,
      } as ExternalAccountAuthorizedUserClientOptions);
    case 'external_account':
      return buildExternalAccount(json, transporter, source);
    default:
      throw new Error(
        `Unsupported Google credential type "${String(json['type'])}" in ${source}`,
      );
  }
}

function withEnvironmentQuotaProject(
  client: AuthClient,
  environment: GoogleCredentialEnvironment,
): AuthClient {
  if (environment.quotaProject) {
    client.quotaProjectId = environment.quotaProject;
  }
  return client;
}

/**
 * Selects the Google credential client for one API client, in the order the
 * library's default discovery uses, with every credential client sending its
 * requests through the owner's fetch. Returns `undefined` when no credential
 * source is configured, which leaves the metadata server to the library.
 */
export async function selectGoogleCredentialClient(
  selection: GoogleCredentialSelection,
): Promise<AuthClient | undefined> {
  const transporter = new gaxios.Gaxios({
    fetchImplementation: selection.fetch,
  });
  const { credentials, environment } = selection;
  if (credentials !== undefined) {
    return buildCredentialClient(
      credentials,
      transporter,
      'explicit credentials',
    );
  }
  if (environment.credentialsFile) {
    const json = await readCredentialFile(environment.credentialsFile, false);
    return buildCredentialClient(
      json,
      transporter,
      environment.credentialsFile,
    );
  }
  if (environment.wellKnownFile) {
    const json = await readCredentialFile(environment.wellKnownFile, true);
    if (json !== undefined) {
      return withEnvironmentQuotaProject(
        buildCredentialClient(json, transporter, environment.wellKnownFile),
        environment,
      );
    }
  }
  return undefined;
}
