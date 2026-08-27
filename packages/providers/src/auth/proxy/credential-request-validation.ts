/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SanitizedOAuthTokenSchema } from '@vybestack/llxprt-code-auth';
import { z } from 'zod';

const RequiredStringSchema = z.string().min(1);
const OptionalStringSchema = z.string().optional();

export const ProviderRequestSchema = z.object({
  provider: RequiredStringSchema,
});

export const ProviderBucketRequestSchema = ProviderRequestSchema.extend({
  bucket: OptionalStringSchema,
});

export const SaveTokenRequestSchema = ProviderBucketRequestSchema.extend({
  token: SanitizedOAuthTokenSchema,
});

export const NameRequestSchema = z.object({
  name: RequiredStringSchema,
});

export const OAuthInitiateRequestSchema = ProviderBucketRequestSchema.extend({
  redirect_uri: OptionalStringSchema,
});

export const OAuthExchangeRequestSchema = z.object({
  session_id: RequiredStringSchema,
  code: RequiredStringSchema,
});

export const OAuthSessionRequestSchema = z.object({
  session_id: RequiredStringSchema,
});
