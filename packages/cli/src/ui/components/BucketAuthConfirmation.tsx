/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import {
  MessageBusType,
  type BucketAuthConfirmationRequest,
  DebugLogger,
  MessageBus,
} from '@vybestack/llxprt-code-core';
import {
  RadioButtonSelect,
  type RadioSelectItem,
} from './shared/RadioButtonSelect.js';

import { Colors } from '../colors.js';
import { useKeypress } from '../hooks/useKeypress.js';

const logger = new DebugLogger('llxprt:bucket:confirmation:ui');

interface BucketAuthConfirmationProps {
  messageBus?: MessageBus;
  isFocused?: boolean;
}

interface PendingRequest {
  correlationId: string;
  provider: string;
  bucket: string;
  bucketIndex: number;
  totalBuckets: number;
}

type ConfirmOption = 'proceed' | 'cancel';

/**
 * Component that listens for bucket auth confirmation requests
 * and shows an approval dialog in the TUI.
 */
/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
 * @requirement REQ-D01-002
 * @requirement REQ-D01-003
 * @pseudocode lines 122-133
 */
export const BucketAuthConfirmation: React.FC<BucketAuthConfirmationProps> = ({
  messageBus,
  isFocused = true,
}) => {
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(
    null,
  );

  useEffect(() => {
    logger.debug('BucketAuthConfirmation useEffect running', {
      hasMessageBus: !!messageBus,
    });
    if (messageBus == null) {
      logger.debug('No message bus available, skipping subscription');
      return;
    }

    logger.debug('Subscribing to BUCKET_AUTH_CONFIRMATION_REQUEST');
    const unsubscribe = messageBus.subscribe<BucketAuthConfirmationRequest>(
      MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST,
      (request) => {
        logger.debug('Received bucket auth confirmation request', {
          provider: request.provider,
          bucket: request.bucket,
          bucketIndex: request.bucketIndex,
          totalBuckets: request.totalBuckets,
        });
        setPendingRequest({
          correlationId: request.correlationId,
          provider: request.provider,
          bucket: request.bucket,
          bucketIndex: request.bucketIndex,
          totalBuckets: request.totalBuckets,
        });
      },
    );

    return () => {
      logger.debug('Unsubscribing from BUCKET_AUTH_CONFIRMATION_REQUEST');
      unsubscribe();
    };
  }, [messageBus]);

  const handleConfirm = useCallback(
    (confirmed: boolean) => {
      if (pendingRequest == null || messageBus == null) {
        return;
      }

      messageBus.respondToBucketAuthConfirmation(
        pendingRequest.correlationId,
        confirmed,
      );

      setPendingRequest(null);
    },
    [messageBus, pendingRequest],
  );

  useKeypress(
    (key) => {
      if (pendingRequest == null || !isFocused) return;
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        handleConfirm(false);
      }
    },
    { isActive: !!pendingRequest && isFocused },
  );

  const handleSelect = useCallback(
    (option: ConfirmOption) => {
      handleConfirm(option === 'proceed');
    },
    [handleConfirm],
  );

  if (pendingRequest == null) {
    return null;
  }

  const options: Array<RadioSelectItem<ConfirmOption>> = [
    {
      label: 'Yes, open browser',
      value: 'proceed',
      key: 'proceed',
    },
    {
      label: 'Cancel (esc)',
      value: 'cancel',
      key: 'cancel',
    },
  ];

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentCyan}
      padding={1}
      marginY={1}
    >
      <Box marginBottom={1}>
        <Text color={Colors.AccentCyan} bold>
          OAuth Bucket Authentication
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.Foreground}>
          Bucket {pendingRequest.bucketIndex} of {pendingRequest.totalBuckets}:{' '}
          <Text color={Colors.AccentGreen}>{pendingRequest.bucket}</Text>
        </Text>
        <Text color={Colors.DimComment}>
          Provider: {pendingRequest.provider}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={Colors.AccentGreen}>
          Open browser to authenticate this bucket?
        </Text>
      </Box>

      <RadioButtonSelect
        items={options}
        onSelect={handleSelect}
        isFocused={isFocused}
      />
    </Box>
  );
};
