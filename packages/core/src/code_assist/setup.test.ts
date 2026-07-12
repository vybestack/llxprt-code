/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupUser, ProjectIdRequiredError } from './setup.js';
import type { OAuth2Client } from 'google-auth-library';
import type { GeminiUserTier } from './types.js';
import { UserTierId } from './types.js';

const mockPaidTier: GeminiUserTier = {
  id: UserTierId.STANDARD,
  name: 'paid',
  description: 'Paid tier',
  isDefault: true,
};

const mockFreeTier: GeminiUserTier = {
  id: UserTierId.FREE,
  name: 'free',
  description: 'Free tier',
  isDefault: true,
};

describe('setupUser for existing user', () => {
  let mockLoad: ReturnType<typeof vi.fn>;
  let mockOnboardUser: ReturnType<typeof vi.fn>;
  let createServer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockLoad = vi.fn();
    mockOnboardUser = vi.fn().mockResolvedValue({
      done: true,
      response: {
        cloudaicompanionProject: {
          id: 'server-project',
        },
      },
    });
    createServer = vi.fn().mockReturnValue({
      loadCodeAssist: mockLoad,
      onboardUser: mockOnboardUser,
    });
  });

  it('should use GOOGLE_CLOUD_PROJECT when set and project from server is undefined', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    mockLoad.mockResolvedValue({
      currentTier: mockPaidTier,
    });
    await setupUser({} as OAuth2Client, createServer);
    expect(createServer).toHaveBeenCalledWith({}, 'test-project');
  });

  it('should ignore GOOGLE_CLOUD_PROJECT when project from server is set', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    mockLoad.mockResolvedValue({
      cloudaicompanionProject: 'server-project',
      currentTier: mockPaidTier,
    });
    const projectId = await setupUser({} as OAuth2Client, createServer);
    expect(createServer).toHaveBeenCalledWith({}, 'test-project');
    expect(projectId).toStrictEqual({
      projectId: 'server-project',
      userTier: 'standard-tier',
    });
  });

  it('should throw ProjectIdRequiredError when no project ID is available', async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    // And the server itself requires a project ID internally
    createServer.mockImplementation(() => {
      throw new ProjectIdRequiredError();
    });

    await expect(setupUser({} as OAuth2Client, createServer)).rejects.toThrow(
      ProjectIdRequiredError,
    );
  });
});

describe('setupUser for new user', () => {
  let mockLoad: ReturnType<typeof vi.fn>;
  let mockOnboardUser: ReturnType<typeof vi.fn>;
  let createServer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockLoad = vi.fn();
    mockOnboardUser = vi.fn().mockResolvedValue({
      done: true,
      response: {
        cloudaicompanionProject: {
          id: 'server-project',
        },
      },
    });
    createServer = vi.fn().mockReturnValue({
      loadCodeAssist: mockLoad,
      onboardUser: mockOnboardUser,
    });
  });

  it('should use GOOGLE_CLOUD_PROJECT when set and onboard a new paid user', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    mockLoad.mockResolvedValue({
      allowedTiers: [mockPaidTier],
    });
    const userData = await setupUser({} as OAuth2Client, createServer);
    expect(createServer).toHaveBeenCalledWith({}, 'test-project');
    expect(mockLoad).toHaveBeenCalled();
    expect(mockOnboardUser).toHaveBeenCalledWith({
      tierId: 'standard-tier',
      cloudaicompanionProject: 'test-project',
      metadata: {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI',
        duetProject: 'test-project',
      },
    });
    expect(userData).toStrictEqual({
      projectId: 'server-project',
      userTier: 'standard-tier',
    });
  });

  it('should onboard a new free user when GOOGLE_CLOUD_PROJECT is not set', async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    mockLoad.mockResolvedValue({
      allowedTiers: [mockFreeTier],
    });
    const userData = await setupUser({} as OAuth2Client, createServer);
    expect(createServer).toHaveBeenCalledWith({}, undefined);
    expect(mockLoad).toHaveBeenCalled();
    expect(mockOnboardUser).toHaveBeenCalledWith({
      tierId: 'free-tier',
      cloudaicompanionProject: undefined,
      metadata: {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI',
      },
    });
    expect(userData).toStrictEqual({
      projectId: 'server-project',
      userTier: 'free-tier',
    });
  });

  it('should use GOOGLE_CLOUD_PROJECT when onboard response has no project ID', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    mockLoad.mockResolvedValue({
      allowedTiers: [mockPaidTier],
    });
    mockOnboardUser.mockResolvedValue({
      done: true,
      response: {
        cloudaicompanionProject: undefined,
      },
    });
    const userData = await setupUser({} as OAuth2Client, createServer);
    expect(userData).toStrictEqual({
      projectId: 'test-project',
      userTier: 'standard-tier',
    });
  });

  it('should throw ProjectIdRequiredError when no project ID is available', async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    mockLoad.mockResolvedValue({
      allowedTiers: [mockPaidTier],
    });
    mockOnboardUser.mockResolvedValue({
      done: true,
      response: {},
    });
    await expect(setupUser({} as OAuth2Client, createServer)).rejects.toThrow(
      ProjectIdRequiredError,
    );
  });
});
