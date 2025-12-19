/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ClientMetadata,
  type GeminiUserTier,
  type LoadCodeAssistResponse,
  type OnboardUserRequest,
  UserTierId,
} from './types.js';
import { CodeAssistServer } from './server.js';
import { OAuth2Client } from 'google-auth-library';
import { DebugLogger } from '../debug/index.js';

export class ProjectIdRequiredError extends Error {
  constructor() {
    super(
      'This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID env var. See https://github.com/vybestack/llxprt-code/blob/main/docs/authentication.md',
    );
  }
}

export interface UserData {
  projectId: string;
  userTier: UserTierId;
}

/**
 *
 * @param projectId the user's project id, if any
 * @returns the user's actual project id
 */
export async function setupUser(client: OAuth2Client): Promise<UserData> {
  const logger = new DebugLogger('llxprt:code:setup');

  logger.debug(
    () =>
      `setupUser: starting setup, GOOGLE_CLOUD_PROJECT=${process.env.GOOGLE_CLOUD_PROJECT || 'undefined'}`,
  );
  const projectId =
    process.env['GOOGLE_CLOUD_PROJECT'] ||
    process.env['GOOGLE_CLOUD_PROJECT_ID'] ||
    undefined;
  // PRIVACY FIX: sessionId parameter removed from CodeAssistServer constructor
  const caServer = new CodeAssistServer(client, projectId, {}, undefined);
  const coreClientMetadata: ClientMetadata = {
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  };
  logger.debug(
    () => `setupUser: created CodeAssistServer, calling loadCodeAssist`,
  );

  const loadRes = await caServer.loadCodeAssist({
    cloudaicompanionProject: projectId,
    metadata: {
      ...coreClientMetadata,
      duetProject: projectId,
    },
  });
  logger.debug(
    () =>
      `setupUser: loadCodeAssist completed, currentTier=${!!loadRes.currentTier}, cloudaicompanionProject=${loadRes.cloudaicompanionProject}`,
  );

  if (loadRes.currentTier) {
    logger.debug(
      () => `setupUser: user has current tier: ${loadRes.currentTier!.id}`,
    );
    if (!loadRes.cloudaicompanionProject) {
      if (projectId) {
        logger.debug(
          () => `setupUser: returning with project ID from env: ${projectId}`,
        );
        return {
          projectId,
          userTier: loadRes.currentTier.id,
        };
      }
      logger.debug(
        () =>
          `setupUser: throwing ProjectIdRequiredError - no project ID available`,
      );
      throw new ProjectIdRequiredError();
    }
    logger.debug(
      () =>
        `setupUser: returning with project ID from response: ${loadRes.cloudaicompanionProject}`,
    );
    return {
      projectId: loadRes.cloudaicompanionProject,
      userTier: loadRes.currentTier.id,
    };
  }

  const tier = getOnboardTier(loadRes);
  if (tier.userDefinedCloudaicompanionProject && !projectId) {
    throw new ProjectIdRequiredError();
  }

  let onboardReq: OnboardUserRequest;
  if (tier.id === UserTierId.FREE) {
    // The free tier uses a managed google cloud project. Setting a project in the `onboardUser` request causes a `Precondition Failed` error.
    onboardReq = {
      tierId: tier.id,
      cloudaicompanionProject: undefined,
      metadata: coreClientMetadata,
    };
  } else {
    onboardReq = {
      tierId: tier.id,
      cloudaicompanionProject: projectId,
      metadata: {
        ...coreClientMetadata,
        duetProject: projectId,
      },
    };
  }

  // Poll onboardUser until long running operation is complete.
  let lroRes = await caServer.onboardUser(onboardReq);
  while (!lroRes.done) {
    await new Promise((f) => setTimeout(f, 5000));
    lroRes = await caServer.onboardUser(onboardReq);
  }

  if (!lroRes.response?.cloudaicompanionProject?.id) {
    if (projectId) {
      return {
        projectId,
        userTier: tier.id,
      };
    }
    throw new ProjectIdRequiredError();
  }

  return {
    projectId: lroRes.response.cloudaicompanionProject.id,
    userTier: tier.id,
  };
}

function getOnboardTier(res: LoadCodeAssistResponse): GeminiUserTier {
  for (const tier of res.allowedTiers || []) {
    if (tier.isDefault) {
      return tier;
    }
  }
  return {
    name: '',
    description: '',
    id: UserTierId.LEGACY,
    userDefinedCloudaicompanionProject: true,
  };
}
