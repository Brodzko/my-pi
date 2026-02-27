import { describe, it, expect } from 'vitest';
import { parseProjectFromUrl } from './project.js';

describe('parseProjectFromUrl', () => {
  it('parses SSH URLs', () => {
    expect(
      parseProjectFromUrl('git@gitlab.example.com:group/project.git')
    ).toBe('group/project');
  });

  it('parses SSH URLs without .git suffix', () => {
    expect(parseProjectFromUrl('git@gitlab.example.com:group/project')).toBe(
      'group/project'
    );
  });

  it('parses SSH URLs with subgroups', () => {
    expect(
      parseProjectFromUrl('git@gitlab.example.com:group/subgroup/project.git')
    ).toBe('group/subgroup/project');
  });

  it('parses HTTPS URLs', () => {
    expect(
      parseProjectFromUrl('https://gitlab.example.com/group/project.git')
    ).toBe('group/project');
  });

  it('parses HTTPS URLs without .git suffix', () => {
    expect(
      parseProjectFromUrl('https://gitlab.example.com/group/project')
    ).toBe('group/project');
  });

  it('parses HTTPS URLs with subgroups', () => {
    expect(
      parseProjectFromUrl('https://gitlab.example.com/group/sub/project.git')
    ).toBe('group/sub/project');
  });

  it('returns undefined for unrecognized URLs', () => {
    expect(parseProjectFromUrl('not-a-url')).toBeUndefined();
  });
});
