/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import {
  AuthClient,
  BaseExternalAccountClient,
  Compute,
  ExternalAccountAuthorizedUserClient,
  ExternalAccountClient,
  gaxios,
  gcpMetadata,
  Impersonated,
  JWT,
  UserRefreshClient,
  type Credentials,
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
const DEFAULT_METADATA_PRIMARY = 'http://169.254.169.254';
const DEFAULT_METADATA_SECONDARY = 'http://metadata.google.internal.';
const METADATA_PROBE_TIMEOUT_MS = 3000;
const METADATA_ABSENCE_CODES: ReadonlySet<string> = new Set([
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOENT',
  'ENOTFOUND',
  'ECONNREFUSED',
]);
const NO_ADC_FOUND =
  'Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.';

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

const X509_SOURCE_UNSUPPORTED =
  'Vertex external account credentials with an X.509 certificate source are not supported: the owner transport cannot present a client certificate';
const STS_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const STS_REQUESTED_TOKEN_TYPE =
  'urn:ietf:params:oauth:token-type:access_token';
const DEFAULT_IMPERSONATION_LIFETIME_SECONDS = 3600;

interface StsTokenResponse {
  readonly access_token: string;
  readonly expires_in?: number;
}

interface ImpersonationResponse {
  readonly accessToken: string;
  readonly expireTime: string;
}

function optionalString(
  json: GoogleCredentialJson,
  name: string,
): string | undefined {
  const value = json[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function oauthFailure(action: string, error: unknown): unknown {
  if (!(error instanceof gaxios.GaxiosError) || !error.response) {
    return error;
  }
  const body = error.response.data as
    | { error?: unknown; error_description?: unknown }
    | undefined;
  const code = typeof body?.error === 'string' ? body.error : undefined;
  const description =
    typeof body?.error_description === 'string'
      ? body.error_description
      : undefined;
  const detail = [code, description].filter(Boolean).join(': ');
  return new Error(
    `${action} failed with status ${String(error.response.status)}${detail ? `: ${detail}` : ''}`,
    { cause: error },
  );
}

/**
 * The library's external account client builds its STS exchanger on a `Gaxios`
 * it creates itself, so the exchange would bypass the owner transport. The
 * library client is kept only for its subject token retrieval, whose file,
 * executable, URL and AWS sources already use the transporter it was given.
 * The RFC 8693 exchange and the optional service account impersonation are
 * sent here through the owner's transporter.
 */
class OwnerExternalAccountClient extends AuthClient {
  readonly #json: GoogleCredentialJson;
  readonly #library: BaseExternalAccountClient;
  readonly #tokenUrl: string;
  #cached: Credentials | undefined;
  #pending: Promise<Credentials> | undefined;

  constructor(
    json: GoogleCredentialJson,
    library: BaseExternalAccountClient,
    transporter: gaxios.Gaxios,
  ) {
    super({
      transporter,
      quotaProjectId: library.quotaProjectId,
      universeDomain: library.universeDomain,
    });
    this.#json = json;
    this.#library = library;
    this.#tokenUrl =
      optionalString(json, 'token_url') ??
      `https://sts.${this.universeDomain}/v1/token`;
  }

  async getAccessToken(): Promise<{ token: string | null | undefined }> {
    const cached = this.#cached;
    if (cached !== undefined && !this.#isExpired(cached)) {
      return { token: cached.access_token };
    }
    this.#pending ??= this.#refresh().finally(() => {
      this.#pending = undefined;
    });
    return { token: (await this.#pending).access_token };
  }

  async getRequestHeaders(): Promise<Headers> {
    const { token } = await this.getAccessToken();
    return this.addSharedMetadataHeaders(
      new Headers({ authorization: `Bearer ${String(token)}` }),
    );
  }

  async request<T>(opts: gaxios.GaxiosOptions): gaxios.GaxiosPromise<T> {
    const headers = new Headers(opts.headers);
    for (const [name, value] of await this.getRequestHeaders()) {
      headers.set(name, value);
    }
    return this.transporter.request<T>({ ...opts, headers });
  }

  #isExpired(credentials: Credentials): boolean {
    return (
      credentials.expiry_date != null &&
      Date.now() >= credentials.expiry_date - this.eagerRefreshThresholdMillis
    );
  }

  async #refresh(): Promise<Credentials> {
    const stsToken = await this.#exchange(
      await this.#library.retrieveSubjectToken(),
    );
    const impersonationUrl = optionalString(
      this.#json,
      'service_account_impersonation_url',
    );
    const credentials =
      impersonationUrl === undefined
        ? {
            access_token: stsToken.access_token,
            ...(stsToken.expires_in === undefined
              ? {}
              : { expiry_date: Date.now() + stsToken.expires_in * 1000 }),
          }
        : await this.#impersonate(impersonationUrl, stsToken.access_token);
    this.#cached = credentials;
    this.credentials = credentials;
    return credentials;
  }

  async #exchange(subjectToken: string): Promise<StsTokenResponse> {
    const clientId = optionalString(this.#json, 'client_id');
    const userProject = optionalString(
      this.#json,
      'workforce_pool_user_project',
    );
    const form = new URLSearchParams({
      grant_type: STS_GRANT_TYPE,
      audience: String(this.#json['audience']),
      scope: CLOUD_PLATFORM_SCOPE,
      requested_token_type: STS_REQUESTED_TOKEN_TYPE,
      subject_token: subjectToken,
      subject_token_type: String(this.#json['subject_token_type']),
    });
    const headers = new Headers({
      'content-type': 'application/x-www-form-urlencoded',
    });
    if (clientId !== undefined) {
      const secret = optionalString(this.#json, 'client_secret') ?? '';
      headers.set(
        'authorization',
        `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      );
    } else if (userProject !== undefined) {
      form.set('options', JSON.stringify({ userProject }));
    }
    try {
      const response = await this.transporter.request<StsTokenResponse>({
        url: this.#tokenUrl,
        method: 'POST',
        headers,
        data: form.toString(),
        responseType: 'json',
      });
      return response.data;
    } catch (error) {
      throw oauthFailure('The Google STS token exchange', error);
    }
  }

  async #impersonate(url: string, stsToken: string): Promise<Credentials> {
    const impersonation = this.#json['service_account_impersonation'];
    const configured =
      typeof impersonation === 'object' && impersonation !== null
        ? (impersonation as { token_lifetime_seconds?: unknown })
            .token_lifetime_seconds
        : undefined;
    const lifetime =
      typeof configured === 'number'
        ? configured
        : DEFAULT_IMPERSONATION_LIFETIME_SECONDS;
    try {
      const response = await this.transporter.request<ImpersonationResponse>({
        url,
        method: 'POST',
        headers: { authorization: `Bearer ${stsToken}` },
        data: {
          scope: [CLOUD_PLATFORM_SCOPE],
          lifetime: `${String(lifetime)}s`,
        },
        responseType: 'json',
      });
      return {
        access_token: response.data.accessToken,
        expiry_date: new Date(response.data.expireTime).getTime(),
      };
    } catch (error) {
      throw oauthFailure('The Google service account impersonation', error);
    }
  }
}

function buildExternalAccount(
  json: GoogleCredentialJson,
  transporter: gaxios.Gaxios,
  source: string,
): AuthClient {
  const credentialSource = json['credential_source'];
  if (
    typeof credentialSource === 'object' &&
    credentialSource !== null &&
    'certificate' in credentialSource
  ) {
    throw new Error(X509_SOURCE_UNSUPPORTED);
  }
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
  return new OwnerExternalAccountClient(json, client, transporter);
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

interface MetadataBases {
  readonly primary: string;
  readonly secondary?: string;
}

type MetadataProbe =
  | { readonly present: true; readonly base: string }
  | { readonly present: false; readonly cause: unknown };

function metadataBases(host: string | undefined): MetadataBases {
  if (!host) {
    return {
      primary: DEFAULT_METADATA_PRIMARY,
      secondary: DEFAULT_METADATA_SECONDARY,
    };
  }
  return { primary: /^https?:\/\//.test(host) ? host : `http://${host}` };
}

function metadataUrl(
  base: string,
  path: string,
  params?: Readonly<Record<string, string>>,
): URL {
  const url = new URL(`${gcpMetadata.BASE_PATH}/${path}`, base);
  for (const [name, value] of Object.entries(params ?? {})) {
    url.searchParams.set(name, value);
  }
  return url;
}

function missingMetadataFlavor(response: gaxios.GaxiosResponse): Error | null {
  const flavor = response.headers.get(gcpMetadata.HEADER_NAME);
  if (flavor === gcpMetadata.HEADER_VALUE) {
    return null;
  }
  return new Error(
    `Invalid response from metadata service: incorrect ${gcpMetadata.HEADER_NAME} header. Expected '${gcpMetadata.HEADER_VALUE}', got ${flavor ? `'${flavor}'` : 'no header'}`,
  );
}

function isConnectionFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && METADATA_ABSENCE_CODES.has(code)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof gaxios.GaxiosError &&
    (error.status === 404 || error.response?.status === 404)
  );
}

async function probeMetadataBase(
  transporter: gaxios.Gaxios,
  base: string,
  aborter: AbortController,
  timeoutMs: number,
): Promise<MetadataProbe> {
  const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  const signal =
    timeout === undefined
      ? aborter.signal
      : AbortSignal.any([aborter.signal, timeout]);
  try {
    const response = await transporter.request({
      url: metadataUrl(base, 'instance').href,
      headers: { [gcpMetadata.HEADER_NAME]: gcpMetadata.HEADER_VALUE },
      responseType: 'text',
      signal,
    });
    const mismatch = missingMetadataFlavor(response);
    return mismatch === null
      ? { present: true, base }
      : { present: false, cause: mismatch };
  } catch (error) {
    if (timeout?.aborted || isNotFound(error) || isConnectionFailure(error)) {
      return { present: false, cause: error };
    }
    throw error;
  }
}

/**
 * Settles with the first probe that found the server, or with the first
 * address's absence once every address has reported absent. A probe that
 * throws (an owner abort or an unexpected error) ends the selection.
 */
function firstPresentProbe(
  attempts: readonly Promise<MetadataProbe>[],
): Promise<MetadataProbe> {
  return new Promise((resolve, reject) => {
    const absences: MetadataProbe[] = [];
    let pending = attempts.length;
    attempts.forEach((attempt, index) => {
      attempt.then((probe) => {
        if (probe.present) {
          resolve(probe);
          return;
        }
        absences[index] = probe;
        pending -= 1;
        if (pending === 0) {
          resolve(absences[0]);
        }
      }, reject);
    });
  });
}

/**
 * Probes the metadata server through the owner transport. Without an
 * explicit host the IP and the DNS name are probed together: the IP is slow
 * to fail off GCP and DNS is slow on some GCP hosts. The first address that
 * answers wins, a failed address never cancels its peer, and the remaining
 * probe is aborted and joined once the selection is made.
 */
async function probeMetadataServer(
  transporter: gaxios.Gaxios,
  bases: MetadataBases,
): Promise<MetadataProbe> {
  const timeoutMs = gcpMetadata.getGCPResidency()
    ? 0
    : METADATA_PROBE_TIMEOUT_MS;
  const aborters = [new AbortController(), new AbortController()];
  const attempts = [
    probeMetadataBase(transporter, bases.primary, aborters[0], timeoutMs),
  ];
  if (bases.secondary !== undefined) {
    attempts.push(
      probeMetadataBase(transporter, bases.secondary, aborters[1], timeoutMs),
    );
  }
  try {
    return await firstPresentProbe(attempts);
  } finally {
    for (const aborter of aborters) {
      aborter.abort();
    }
    await Promise.allSettled(attempts);
  }
}

async function metadataServerPresent(
  transporter: gaxios.Gaxios,
  bases: MetadataBases,
  detection: string | undefined,
): Promise<MetadataProbe> {
  const mode = detection?.trim().toLocaleLowerCase();
  const knownModes = Object.keys(gcpMetadata.METADATA_SERVER_DETECTION);
  if (mode && !knownModes.includes(mode)) {
    throw new RangeError(
      `Unknown \`METADATA_SERVER_DETECTION\` env variable. Got \`${mode}\`, but it should be \`${knownModes.join('`, `')}\`, or unset`,
    );
  }
  switch (mode) {
    case 'assume-present':
      return { present: true, base: bases.primary };
    case 'none':
      return { present: false, cause: undefined };
    case 'bios-only':
      return gcpMetadata.getGCPResidency()
        ? { present: true, base: bases.primary }
        : { present: false, cause: undefined };
    case 'ping-only':
      return probeMetadataServer(transporter, bases);
    default:
      return gcpMetadata.getGCPResidency()
        ? { present: true, base: bases.primary }
        : probeMetadataServer(transporter, bases);
  }
}

/**
 * The library's `Compute` client fetches tokens with `gcpMetadata.instance`,
 * which always uses the global gaxios instance. This one sends the same
 * requests through the owner's transporter.
 */
class OwnerMetadataClient extends Compute {
  readonly #base: string;

  constructor(base: string, transporter: gaxios.Gaxios) {
    super({ transporter, scopes: [CLOUD_PLATFORM_SCOPE] });
    this.#base = base;
  }

  protected override async refreshTokenNoCache(): Promise<{
    tokens: Credentials;
    res: null;
  }> {
    const data = (await this.#get(
      `instance/service-accounts/${this.serviceAccountEmail}/token`,
      this.scopes.length > 0 ? { scopes: this.scopes.join(',') } : undefined,
      'json',
    )) as Credentials & { expires_in?: number };
    const { expires_in: expiresIn, ...tokens } = data;
    const credentials: Credentials =
      expiresIn === undefined
        ? tokens
        : { ...tokens, expiry_date: Date.now() + expiresIn * 1000 };
    this.emit('tokens', credentials);
    return { tokens: credentials, res: null };
  }

  override async fetchIdToken(targetAudience: string): Promise<string> {
    return (await this.#get(
      `instance/service-accounts/${this.serviceAccountEmail}/identity`,
      { format: 'full', audience: targetAudience },
      'text',
    )) as string;
  }

  async #get(
    path: string,
    params: Readonly<Record<string, string>> | undefined,
    responseType: 'json' | 'text',
  ): Promise<unknown> {
    const response = await this.transporter.request<unknown>({
      url: metadataUrl(this.#base, path, params).href,
      headers: { [gcpMetadata.HEADER_NAME]: gcpMetadata.HEADER_VALUE },
      responseType,
    });
    const mismatch = missingMetadataFlavor(response);
    if (mismatch !== null) {
      throw mismatch;
    }
    return response.data;
  }
}

async function selectMetadataClient(
  transporter: gaxios.Gaxios,
  environment: GoogleCredentialEnvironment,
): Promise<AuthClient> {
  const bases = metadataBases(environment.metadataHost);
  const probe = await metadataServerPresent(
    transporter,
    bases,
    environment.metadataDetection,
  );
  if (!probe.present) {
    throw new Error(NO_ADC_FOUND, { cause: probe.cause });
  }
  return new OwnerMetadataClient(probe.base, transporter);
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
 * requests through the owner's fetch. When no credential file exists the
 * metadata server is the source; its absence is an error.
 */
export async function selectGoogleCredentialClient(
  selection: GoogleCredentialSelection,
): Promise<AuthClient> {
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
    return withEnvironmentQuotaProject(
      buildCredentialClient(json, transporter, environment.credentialsFile),
      environment,
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
  return withEnvironmentQuotaProject(
    await selectMetadataClient(transporter, environment),
    environment,
  );
}
