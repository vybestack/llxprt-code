/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  parseImageProfile,
  type ImageProfile,
  type ProfileManager,
} from '@vybestack/llxprt-code-settings';
import type { ActiveImageProfile } from '@vybestack/llxprt-code-core';

export type ImageModelChoice =
  | { readonly kind: 'saved'; readonly name: string }
  | { readonly kind: 'new'; readonly backend: ImageProfile['backend'] };

export interface ImageModelOption {
  readonly label: string;
  readonly value: ImageModelChoice;
}

/** Read image profiles without activating them or changing the store. */
export async function listImageModelChoices(
  manager: ProfileManager,
): Promise<ImageModelOption[]> {
  const names = await manager.listImageProfiles();
  const saved = await Promise.all(
    names.map(async (name): Promise<ImageModelOption> => {
      const profile = await manager.loadImageProfile(name);
      return {
        label: `${name} (${profile.backend}: ${profile.model})`,
        value: { kind: 'saved', name },
      };
    }),
  );
  return [
    ...saved,
    {
      label: 'New codex configuration',
      value: { kind: 'new', backend: 'codex' },
    },
    {
      label: 'New openai-images configuration',
      value: { kind: 'new', backend: 'openai-images' },
    },
  ];
}

type CredentialMode = 'api-key' | 'named-key' | 'keyfile';
type WizardState =
  | { readonly step: 'model' }
  | { readonly step: 'baseUrl'; readonly model: string }
  | { readonly step: 'auth'; readonly model: string; readonly baseUrl: string }
  | {
      readonly step: 'credential';
      readonly model: string;
      readonly baseUrl: string;
      readonly mode: CredentialMode;
    }
  | { readonly step: 'done' };

/** Stage a new image configuration until schema validation and activation succeed. */
export class ImageModelWizard {
  private state: WizardState = { step: 'model' };

  constructor(
    readonly backend: ImageProfile['backend'],
    private readonly activate: (active: ActiveImageProfile) => void,
  ) {}

  get step(): WizardState['step'] {
    return this.state.step;
  }

  get credentialMode(): CredentialMode | undefined {
    return this.state.step === 'credential' ? this.state.mode : undefined;
  }

  /** Accept the current text field, retaining the field if validation fails. */
  submit(input: string): void {
    const value = input.trim();
    if (!value) throw new Error('A value is required.');
    const state = this.state;
    switch (state.step) {
      case 'model':
        this.state = { step: 'baseUrl', model: value };
        return;
      case 'baseUrl':
        // Use the existing profile schema, including its URL validation.
        parseImageProfile('<unsaved>', {
          version: 1,
          type: 'image',
          backend: this.backend,
          model: state.model,
          baseUrl: value,
          auth: { type: 'none' },
        });
        this.state = { ...state, step: 'auth', baseUrl: value };
        return;
      case 'credential': {
        this.complete(
          state.model,
          state.baseUrl,
          credentialAuth(state.mode, value),
        );
        return;
      }
      default:
        throw new Error('The current wizard step does not accept text.');
    }
  }

  /** Choose authentication, requesting a credential only for modes that need one. */
  chooseAuth(mode: ImageProfile['auth']['type']): void {
    const state = this.state;
    if (state.step !== 'auth')
      throw new Error('Authentication is not the current wizard step.');
    if (mode === 'none' || mode === 'oauth') {
      this.complete(
        state.model,
        state.baseUrl,
        mode === 'none'
          ? { type: 'none' }
          : { type: 'oauth', provider: 'codex' },
      );
    } else {
      this.state = { ...state, step: 'credential', mode };
    }
  }

  private complete(
    model: string,
    baseUrl: string,
    auth: ImageProfile['auth'],
  ): void {
    const profile = parseImageProfile('<unsaved>', {
      version: 1,
      type: 'image',
      backend: this.backend,
      model,
      baseUrl,
      auth,
    });
    this.activate({ profile });
    this.state = { step: 'done' };
  }
}

function credentialAuth(
  mode: CredentialMode,
  value: string,
): ImageProfile['auth'] {
  switch (mode) {
    case 'api-key':
      return { type: 'api-key', apiKey: value };
    case 'named-key':
      return { type: 'named-key', keyName: value };
    default:
      return { type: 'keyfile', path: value };
  }
}
