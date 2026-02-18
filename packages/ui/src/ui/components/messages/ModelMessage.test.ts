import { describe, expect, it } from 'vitest';
import { createMockTheme } from '../../../test/mockTheme';
import type { ModelMessageProps } from './types';

describe('ModelMessageProps', () => {
  const theme = createMockTheme();

  it('accepts message without profileName', () => {
    const props: ModelMessageProps = {
      id: 'test-id',
      text: 'Hello world',
      theme,
    };
    expect(props.profileName).toBeUndefined();
  });

  it('accepts message with profileName', () => {
    const props: ModelMessageProps = {
      id: 'test-id',
      text: 'Hello world',
      theme,
      profileName: 'synthetic',
    };
    expect(props.profileName).toBe('synthetic');
  });

  it('profileName is optional', () => {
    const withoutProfile: ModelMessageProps = {
      id: 'msg-1',
      text: 'Some text',
      theme,
    };
    const withProfile: ModelMessageProps = {
      id: 'msg-2',
      text: 'Some text',
      theme,
      profileName: 'my-profile',
    };
    expect(withoutProfile.profileName).toBeUndefined();
    expect(withProfile.profileName).toBe('my-profile');
  });
});
