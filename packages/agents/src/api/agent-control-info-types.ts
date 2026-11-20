/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Plain-data views the Agent controls return for auth, IDE, session and profile state. */

export interface AuthBucket {
  readonly name: string;
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly active: boolean;
}

// @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005
export interface AuthProviderDetail {
  readonly provider: string;
  readonly authenticated: boolean;
  readonly oauthEnabled: boolean;
  readonly expiry?: number;
}

// @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005
export interface AuthBucketStatus {
  readonly bucket: string;
  readonly authenticated: boolean;
  readonly expiry?: number;
  readonly isSessionBucket: boolean;
}

export interface KeyInfo {
  readonly name: string;
  readonly provider?: string;
}

export interface IdeInfo {
  readonly name: string;
  readonly version?: string;
  readonly trusted: boolean;
}

export interface IdeStatus {
  readonly current: IdeInfo | null;
  readonly detected: readonly IdeInfo[];
  readonly modeEnabled: boolean;
}

export interface CheckpointInfo {
  readonly checkpointId: string;
  readonly name: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly createdAt: string;
}

export interface SessionInfo {
  readonly id: string;
  readonly name: string | null;
  readonly title?: string | null;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly parentSessionId?: string;
  readonly parentSequence?: number;
  readonly checkpointId?: string;
  readonly checkpointName?: string;
}

export interface SessionRecordingState {
  readonly enabled: boolean;
  readonly path?: string;
  readonly format?: string;
}

export interface ProfileSummary {
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly isDefault: boolean;
  readonly isLoadBalancer?: boolean;
}

export interface ProfileDetail extends ProfileSummary {
  readonly modelParams?: Readonly<Record<string, unknown>>;
  readonly baseUrl?: string;
  readonly authKeyName?: string;
  readonly authKeyFile?: string;
}
