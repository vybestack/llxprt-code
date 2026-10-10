/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  assertAdmittedCredential,
  assertSupportedReplacementRoute,
  captureAdmittedCredential,
} from './admittedRouteSecurity.js';

describe('admitted route replacement eligibility', () => {
  it('rejects a direct continuation with no captured endpoint after replacement', () => {
    expect(() =>
      assertSupportedReplacementRoute('openai', undefined, undefined, true),
    ).toThrow('Unsupported admitted provider route after replacement');
  });

  it('rejects a direct replacement without a captured static credential source', () => {
    expect(() =>
      assertSupportedReplacementRoute(
        'openai',
        'https://old.example',
        undefined,
        true,
        false,
      ),
    ).toThrow('Unsupported admitted provider route after replacement');
  });

  it('rejects an unverified provider family after replacement', () => {
    expect(() =>
      assertSupportedReplacementRoute(
        'anthropic',
        'https://old.example',
        undefined,
        true,
      ),
    ).toThrow('Unsupported admitted provider route after replacement');
  });

  it('rejects load-balancer replacement when a captured member uses an unverified provider', () => {
    expect(() =>
      assertSupportedReplacementRoute(
        'load-balancer',
        undefined,
        [
          {
            providerName: 'openai',
            baseURL: 'https://old.example',
            hasInlineKey: true,
          },
          {
            providerName: 'anthropic',
            baseURL: 'https://old.example',
            hasInlineKey: true,
          },
        ],
        true,
      ),
    ).toThrow('Unsupported admitted provider route after replacement');
  });

  it('rejects an OpenAI LB member with no captured endpoint or inline credential', () => {
    expect(() =>
      assertSupportedReplacementRoute(
        'load-balancer',
        undefined,
        [{ providerName: 'openai' }],
        true,
      ),
    ).toThrow('Unsupported admitted provider route after replacement');
  });

  it('does not constrain the unmodified route or supported OpenAI member routes', () => {
    expect(() =>
      assertSupportedReplacementRoute('anthropic', undefined, undefined, false),
    ).not.toThrow();
    expect(() =>
      assertSupportedReplacementRoute(
        'openai',
        'https://old.example',
        undefined,
        true,
      ),
    ).not.toThrow();
    expect(() =>
      assertSupportedReplacementRoute(
        'load-balancer',
        undefined,
        [
          {
            providerName: 'openai',
            baseURL: 'https://old.example',
            hasInlineKey: true,
          },
        ],
        true,
      ),
    ).not.toThrow();
  });
});

describe('admitted credential comparison', () => {
  function settingsWithKeys(
    globalKey: string | undefined,
    providerKey: string | undefined,
  ): SettingsService {
    const settings = new SettingsService();
    if (globalKey !== undefined) settings.set('auth-key', globalKey);
    if (providerKey !== undefined)
      settings.setProviderSetting('openai', 'auth-key', providerKey);
    return settings;
  }

  it('accepts the credentials that were admitted', () => {
    const settings = settingsWithKeys('global-key', 'provider-key');
    const admitted = captureAdmittedCredential(settings, 'openai');
    expect(() => assertAdmittedCredential(admitted, settings)).not.toThrow();
  });

  it('accepts unchanged credentials read from an equivalent settings service', () => {
    const admitted = captureAdmittedCredential(
      settingsWithKeys('global-key', 'provider-key'),
      'openai',
    );
    expect(() =>
      assertAdmittedCredential(
        admitted,
        settingsWithKeys('global-key', 'provider-key'),
      ),
    ).not.toThrow();
  });

  it('rejects a changed provider credential of equal length', () => {
    const admitted = captureAdmittedCredential(
      settingsWithKeys(undefined, 'key-aaaa'),
      'openai',
    );
    expect(() =>
      assertAdmittedCredential(
        admitted,
        settingsWithKeys(undefined, 'key-bbbb'),
      ),
    ).toThrow('Admitted provider credentials changed before request dispatch');
  });

  it('rejects a changed credential of a different length', () => {
    const admitted = captureAdmittedCredential(
      settingsWithKeys('short', undefined),
      'openai',
    );
    expect(() =>
      assertAdmittedCredential(
        admitted,
        settingsWithKeys('much-longer-key', undefined),
      ),
    ).toThrow('Admitted provider credentials changed before request dispatch');
  });

  it('rejects a credential that appears or disappears after admission', () => {
    const admitted = captureAdmittedCredential(
      settingsWithKeys(undefined, undefined),
      'openai',
    );
    expect(() =>
      assertAdmittedCredential(admitted, settingsWithKeys('added', undefined)),
    ).toThrow('Admitted provider credentials changed before request dispatch');
  });

  it('rejects dispatch when no settings service is available', () => {
    const admitted = captureAdmittedCredential(
      settingsWithKeys('global-key', undefined),
      'openai',
    );
    expect(() => assertAdmittedCredential(admitted, undefined)).toThrow(
      'Admitted provider credentials changed before request dispatch',
    );
  });
});
