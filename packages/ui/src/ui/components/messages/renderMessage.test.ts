import { describe, expect, it } from 'vitest';
import { createMockTheme } from '../../../test/mockTheme';
import { getMessageRenderer, roleColor } from './renderMessage';

describe('getMessageRenderer', () => {
  it('should return UserMessage renderer for user role', () => {
    const renderer = getMessageRenderer('user');
    expect(renderer.displayName ?? renderer.name).toBe('UserMessage');
  });

  it('should return ModelMessage renderer for model role', () => {
    const renderer = getMessageRenderer('model');
    expect(renderer.displayName ?? renderer.name).toBe('ModelMessage');
  });

  it('should return SystemMessage renderer for system role', () => {
    const renderer = getMessageRenderer('system');
    expect(renderer.displayName ?? renderer.name).toBe('SystemMessage');
  });

  it('should return ThinkingMessage renderer for thinking role', () => {
    const renderer = getMessageRenderer('thinking');
    expect(renderer.displayName ?? renderer.name).toBe('ThinkingMessage');
  });
});

describe('roleColor', () => {
  const mockTheme = createMockTheme();

  it('should return user text color for user role', () => {
    expect(roleColor('user', mockTheme)).toBe(mockTheme.colors.text.user);
  });

  it('should return responder text color for model role', () => {
    expect(roleColor('model', mockTheme)).toBe(mockTheme.colors.text.responder);
  });

  it('should return systemText color for system role', () => {
    expect(roleColor('system', mockTheme)).toBe(
      mockTheme.colors.message.systemText,
    );
  });

  it('should return thinking text color for thinking role', () => {
    expect(roleColor('thinking', mockTheme)).toBe(
      mockTheme.colors.text.thinking,
    );
  });
});
