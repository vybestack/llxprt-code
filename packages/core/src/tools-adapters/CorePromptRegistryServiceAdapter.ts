/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IPromptRegistryService,
  Prompt,
  PromptRegistry as PromptRegistryBoundary,
} from '@vybestack/llxprt-code-tools';

interface CorePromptRegistryBoundary {
  getPrompt(name: string): Prompt | undefined;
  getAllPrompts?(): Prompt[];
}

class CorePromptRegistryView implements PromptRegistryBoundary {
  constructor(private readonly registry: CorePromptRegistryBoundary) {}

  getPrompt(name: string): Prompt | undefined {
    return this.registry.getPrompt(name);
  }

  getPromptNames(): string[] {
    return this.registry.getAllPrompts?.().map((prompt) => prompt.name) ?? [];
  }
}

export class CorePromptRegistryServiceAdapter
  implements IPromptRegistryService
{
  constructor(private readonly registry: CorePromptRegistryBoundary) {}

  getPromptRegistry(): PromptRegistryBoundary {
    return new CorePromptRegistryView(this.registry);
  }

  getPrompt(name: string): Prompt | undefined {
    return this.registry.getPrompt(name);
  }
}
