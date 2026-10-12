/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@vybestack/llxprt-code-core';

/**
 * A real Config whose provider/model and recording queue limit a test can
 * change after construction, standing in for the live provider state that the
 * recording header and provider-switch tests observe.
 */
export class LiveProviderConfig extends Config {
  private liveProvider: string | undefined;
  private liveModel: string;
  private queueByteLimit: number | undefined;

  constructor(params: ConstructorParameters<typeof Config>[0]) {
    super(params);
    this.liveProvider = super.getProvider();
    this.liveModel = super.getModel();
  }

  setProvider(provider: string): void {
    this.liveProvider = provider;
  }

  setModel(model: string): void {
    this.liveModel = model;
  }

  setSessionRecordingQueueByteLimit(limit: number): void {
    this.queueByteLimit = limit;
  }

  override getProvider(): string | undefined {
    return this.liveProvider === '' ? undefined : this.liveProvider;
  }

  override getModel(): string {
    return this.liveModel;
  }

  override getSessionRecordingQueueByteLimit(): number {
    return this.queueByteLimit ?? super.getSessionRecordingQueueByteLimit();
  }
}
