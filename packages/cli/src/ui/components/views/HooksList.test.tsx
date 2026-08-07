/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect } from 'bun:test';
import { HooksList } from './HooksList.js';
import type { HookRegistryEntry } from '@vybestack/llxprt-code-core';
import {
  ConfigSource,
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core';

describe('<HooksList />', () => {
  it('should render empty state when no hooks', () => {
    const { lastFrame } = render(<HooksList hooks={[]} />);
    expect(lastFrame()).toContain('No hooks configured.');
  });

  it('should render hooks grouped by event', () => {
    const hooks: HookRegistryEntry[] = [
      {
        config: {
          command: 'echo "before-prompt"',
          type: HookType.Command,
        },
        source: ConfigSource.User,
        eventName: HookEventName.BeforeAgent,
        enabled: true,
      },
      {
        config: {
          command: 'echo "after-prompt"',
          type: HookType.Command,
        },
        source: ConfigSource.User,
        eventName: HookEventName.AfterAgent,
        enabled: true,
      },
      {
        config: {
          command: 'echo "before-prompt-2"',
          type: HookType.Command,
        },
        source: ConfigSource.Project,
        eventName: HookEventName.BeforeAgent,
        enabled: true,
      },
    ];

    const { lastFrame } = render(<HooksList hooks={hooks} />);
    const output = lastFrame();

    // Should show both event names
    expect(output).toContain('BeforeAgent');
    expect(output).toContain('AfterAgent');

    // Should show commands
    expect(output).toContain('echo "before-prompt"');
    expect(output).toContain('echo "after-prompt"');
    expect(output).toContain('echo "before-prompt-2"');

    // Should show sources
    expect(output).toContain('user');
    expect(output).toContain('project');
  });

  it('should show enabled/disabled status', () => {
    const hooks: HookRegistryEntry[] = [
      {
        config: {
          command: 'echo "enabled"',
          type: HookType.Command,
        },
        source: ConfigSource.User,
        eventName: HookEventName.BeforeAgent,
        enabled: true,
      },
      {
        config: {
          command: 'echo "disabled"',
          type: HookType.Command,
        },
        source: ConfigSource.User,
        eventName: HookEventName.BeforeAgent,
        enabled: false,
      },
    ];

    const { lastFrame } = render(<HooksList hooks={hooks} />);
    const output = lastFrame();

    // Should show enabled and disabled status
    expect(output).toContain('enabled');
    expect(output).toContain('disabled');
  });

  it('should show hook details including matcher, sequential, and timeout', () => {
    const hooks: HookRegistryEntry[] = [
      {
        config: {
          command: 'echo "test"',
          type: HookType.Command,
          timeout: 5000,
        },
        source: ConfigSource.Project,
        eventName: HookEventName.BeforeAgent,
        matcher: '*.ts',
        sequential: true,
        enabled: true,
      },
    ];

    const { lastFrame } = render(<HooksList hooks={hooks} />);
    const output = lastFrame();

    // Should show details
    expect(output).toContain('project');
    expect(output).toContain('*.ts');
    expect(output).toContain('sequential');
    expect(output).toContain('5000');
  });

  it('should show footer tip about enabling/disabling hooks', () => {
    const hooks: HookRegistryEntry[] = [
      {
        config: {
          command: 'echo "test"',
          type: HookType.Command,
        },
        source: ConfigSource.User,
        eventName: HookEventName.BeforeAgent,
        enabled: true,
      },
    ];

    const { lastFrame } = render(<HooksList hooks={hooks} />);
    const output = lastFrame();

    // Should show tip about /hooks enable and /hooks disable
    expect(output).toContain('/hooks enable');
    expect(output).toContain('/hooks disable');
  });
});
