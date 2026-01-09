/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export enum WizardStep {
  PROVIDER_SELECT,
  BASE_URL_CONFIG,
  MODEL_SELECT,
  AUTHENTICATION,
  ADVANCED_PARAMS,
  SAVE_PROFILE,
  SUCCESS_SUMMARY,
}

export interface WizardState {
  currentStep: WizardStep;
  stepHistory: WizardStep[];
  config: {
    provider: string | null;
    baseUrl?: string;
    model: string | null;
    auth: {
      type: 'apikey' | 'keyfile' | 'oauth' | null;
      value?: string;
      buckets?: string[];
    };
    params?: {
      temperature?: number;
      maxTokens?: number;
      contextLimit?: number;
    };
  };
  profileName?: string;
  validationErrors: Record<string, string>;
  skipValidation: boolean;
}

export interface ProviderOption {
  value: string;
  label: string;
  needsBaseUrl: boolean;
  defaultBaseUrl?: string;
  supportsOAuth: boolean;
  knownModels?: string[];
}

export interface AdvancedParams {
  temperature?: number;
  maxTokens?: number;
  contextLimit?: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  error?: string;
  timedOut?: boolean;
}
