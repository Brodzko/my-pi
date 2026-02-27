import { describe, it, expect } from 'vitest';
import {
  normalizeMrSummary,
  normalizeMrBasics,
  normalizeChange,
  normalizeDiscussion,
} from './normalize.js';
import type { GlabMr } from '../schemas/mr.js';

const baseMr: GlabMr = {
  iid: 42,
  title: 'feat: something',
  description: 'A description',
  author: { username: 'alice' },
  reviewers: [{ username: 'bob' }],
  assignees: [{ username: 'charlie' }],
  draft: false,
  state: 'opened',
  source_branch: 'feat/something',
  target_branch: 'main',
  labels: ['review-needed'],
  web_url: 'https://gitlab.example/g/p/-/merge_requests/42',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  head_pipeline: { status: 'success' },
  user_notes_count: 3,
};

describe('normalizeMrSummary', () => {
  it('normalizes basic fields', () => {
    const result = normalizeMrSummary(baseMr);
    expect(result.iid).toBe(42);
    expect(result.author).toBe('alice');
    expect(result.reviewers).toEqual(['bob']);
    expect(result.pipelineStatus).toBe('success');
    expect(result.sourceBranch).toBe('feat/something');
  });

  it('handles null pipeline', () => {
    const result = normalizeMrSummary({ ...baseMr, head_pipeline: null });
    expect(result.pipelineStatus).toBeNull();
  });

  it('includes extra triage fields when provided', () => {
    const result = normalizeMrSummary(baseMr, {
      unresolvedDiscussions: 2,
      approvedByMe: false,
    });
    expect(result.unresolvedDiscussions).toBe(2);
    expect(result.approvedByMe).toBe(false);
  });
});

describe('normalizeMrBasics', () => {
  it('includes description and mergeStatus', () => {
    const result = normalizeMrBasics({
      ...baseMr,
      merge_status: 'can_be_merged',
    });
    expect(result.description).toBe('A description');
    expect(result.mergeStatus).toBe('can_be_merged');
  });
});

describe('normalizeChange', () => {
  it('classifies added files', () => {
    const result = normalizeChange({
      old_path: 'a.ts',
      new_path: 'a.ts',
      new_file: true,
      renamed_file: false,
      deleted_file: false,
      diff: '+line1\n+line2\n',
    });
    expect(result.changeType).toBe('added');
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(0);
  });

  it('classifies deleted files', () => {
    const result = normalizeChange({
      old_path: 'a.ts',
      new_path: 'a.ts',
      new_file: false,
      renamed_file: false,
      deleted_file: true,
      diff: '-line1\n-line2\n',
    });
    expect(result.changeType).toBe('deleted');
    expect(result.deletions).toBe(2);
  });

  it('classifies modified files', () => {
    const result = normalizeChange({
      old_path: 'a.ts',
      new_path: 'a.ts',
      new_file: false,
      renamed_file: false,
      deleted_file: false,
      diff: '+added\n-removed\n context\n',
    });
    expect(result.changeType).toBe('modified');
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });

  it('classifies renamed files', () => {
    const result = normalizeChange({
      old_path: 'old.ts',
      new_path: 'new.ts',
      new_file: false,
      renamed_file: true,
      deleted_file: false,
      diff: '',
    });
    expect(result.changeType).toBe('renamed');
  });
});

describe('normalizeDiscussion', () => {
  it('filters out system notes', () => {
    const result = normalizeDiscussion({
      id: 'disc1',
      notes: [
        {
          id: 1,
          author: { username: 'bot' },
          body: 'merged',
          created_at: '2026-01-01T00:00:00Z',
          system: true,
        },
      ],
    });
    expect(result).toBeNull();
  });

  it('normalizes human discussions', () => {
    const result = normalizeDiscussion({
      id: 'disc2',
      notes: [
        {
          id: 10,
          author: { username: 'alice' },
          body: 'looks good',
          created_at: '2026-01-01T00:00:00Z',
          system: false,
        },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('disc2');
    expect(result!.notes).toHaveLength(1);
    expect(result!.notes[0]!.author).toBe('alice');
  });

  it('extracts position from positioned notes', () => {
    const raw = {
      id: 'disc3',
      notes: [
        {
          id: 20,
          author: { username: 'bob' },
          body: 'nit',
          created_at: '2026-01-01T00:00:00Z',
          system: false,
          position: {
            position_type: 'text',
            new_path: 'src/foo.ts',
            old_path: 'src/foo.ts',
            new_line: 42,
            old_line: null,
          },
          resolvable: true,
          resolved: false,
        },
      ],
    };
    const result = normalizeDiscussion(
      raw as Parameters<typeof normalizeDiscussion>[0]
    );
    expect(result!.position).toEqual({
      file: 'src/foo.ts',
      newLine: 42,
      oldLine: null,
      lineType: 'new',
    });
    expect(result!.resolved).toBe(false);
  });
});
