import type {
  ReadToolDetails,
  GrepToolDetails,
  FindToolDetails,
  LsToolDetails,
  EditToolDetails,
  BashToolDetails,
} from '@mariozechner/pi-coding-agent';
import { formatSize } from '@mariozechner/pi-coding-agent';
import type { MinimalToolConfig } from './types';
import { PREVIEW_LINES } from './types';
import {
  pathColor,
  valueColor,
  basename,
  textContent,
  truncationMeta,
  previewLines,
  colorizeDiff,
  expandOnlyBody,
} from './format';
import { createLsResultComponent } from './ls-render';

// ── read ──────────────────────────────────────────────────────────────────

type ReadArgs = { path: string; offset?: number; limit?: number };

const skillNameFromPath = (path: string | undefined): string | undefined => {
  if (!path) return undefined;
  const match = path.match(/\/skills\/([^/]+)\/SKILL\.md$/);
  return match?.[1];
};

export const readConfig: MinimalToolConfig<ReadArgs, ReadToolDetails> = {
  icon: '📖',
  target: (args, theme) => {
    const skillName = skillNameFromPath(args.path);
    const label = skillName
      ? theme.bold('read') + ' ' + theme.fg('mdHeading', `skill:${skillName}`)
      : theme.bold('read') + ' ' + pathColor(theme, basename(args.path));
    if (args.offset && args.limit)
      return `${label}${theme.fg('mdHeading', `:${args.offset}-${args.offset + args.limit - 1}`)}`;
    if (args.offset)
      return `${label}${theme.fg('mdHeading', `:${args.offset}-`)}`;
    if (args.limit)
      return `${label}${theme.fg('mdHeading', `:1-${args.limit}`)}`;
    return label;
  },
  meta: result => {
    const truncation = result.details?.truncation;
    if (truncation) return truncationMeta(truncation);
    const text = textContent(result);
    if (!text) return undefined;
    const lines = text.split('\n').length;
    const bytes = Buffer.byteLength(text, 'utf-8');
    return `(${lines} lines, ${formatSize(bytes)})`;
  },
  body: (_args, result, theme) => expandOnlyBody(result, theme),
};

// ── write ─────────────────────────────────────────────────────────────────

type WriteArgs = { path: string; content: string };

export const writeConfig: MinimalToolConfig<
  WriteArgs,
  Record<string, never>
> = {
  icon: '📝',
  target: (args, theme) =>
    theme.bold('write') + ' ' + pathColor(theme, basename(args.path)),
  meta: result => {
    const text = textContent(result);
    const sizeMatch = text.match(/(\d+[\d.]*\s*(?:bytes|[KMG]B))/i);
    return sizeMatch ? `(${sizeMatch[1]})` : undefined;
  },
  body: (args, _result, theme) => {
    const { preview, full, truncated } = previewLines(
      args.content,
      PREVIEW_LINES
    );
    const suffix = truncated
      ? '\n' +
        theme.fg('muted', `… (${args.content.split('\n').length} lines total)`)
      : '';
    return { preview: preview + suffix, full };
  },
};

// ── edit ──────────────────────────────────────────────────────────────────

type EditArgs = { path: string; oldText: string; newText: string };

export const editConfig: MinimalToolConfig<EditArgs, EditToolDetails> = {
  icon: '✏️',
  target: (args, theme) =>
    theme.bold('edit') + ' ' + pathColor(theme, basename(args.path)),
  meta: result => {
    const diff = result.details?.diff;
    if (!diff) return undefined;
    const added = (diff.match(/^\+[^+]/gm) ?? []).length;
    const removed = (diff.match(/^-[^-]/gm) ?? []).length;
    const parts: string[] = [];
    if (added) parts.push(`+${added}`);
    if (removed) parts.push(`-${removed}`);
    return parts.length ? `(${parts.join(', ')})` : undefined;
  },
  body: (_args, result, theme) => {
    const diff = result.details?.diff;
    if (!diff) return undefined;
    const colorized = colorizeDiff(diff, theme);
    const { preview, truncated } = previewLines(colorized, PREVIEW_LINES);
    const totalLines = diff.split('\n').length;
    const suffix = truncated
      ? '\n' + theme.fg('muted', `… (${totalLines} lines total)`)
      : '';
    return { preview: preview + suffix, full: colorized };
  },
};

// ── grep ──────────────────────────────────────────────────────────────────

type GrepArgs = {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
};

export const grepConfig: MinimalToolConfig<GrepArgs, GrepToolDetails> = {
  icon: '🔍',
  target: (args, theme) => {
    const parts = [theme.bold('grep'), valueColor(theme, `"${args.pattern}"`)];
    if (args.path) parts.push(pathColor(theme, args.path));
    if (args.glob) parts.push(theme.fg('muted', `--glob=${args.glob}`));
    if (args.ignoreCase) parts.push(theme.fg('muted', '--ignoreCase'));
    if (args.literal) parts.push(theme.fg('muted', '--literal'));
    if (args.context)
      parts.push(theme.fg('muted', `--context=${args.context}`));
    if (args.limit) parts.push(theme.fg('muted', `--limit=${args.limit}`));
    return parts.join(' ');
  },
  meta: result => truncationMeta(result.details?.truncation),
  body: (_args, result, theme) => expandOnlyBody(result, theme),
};

// ── find ──────────────────────────────────────────────────────────────────

type FindArgs = { pattern: string; path?: string; limit?: number };

export const findConfig: MinimalToolConfig<FindArgs, FindToolDetails> = {
  icon: '📂',
  target: (args, theme) => {
    const parts = [theme.bold('find'), valueColor(theme, args.pattern)];
    if (args.path) parts.push(pathColor(theme, args.path));
    if (args.limit) parts.push(theme.fg('muted', `--limit=${args.limit}`));
    return parts.join(' ');
  },
  meta: result => truncationMeta(result.details?.truncation),
  body: (_args, result, theme) => expandOnlyBody(result, theme),
};

// ── ls ────────────────────────────────────────────────────────────────────

type LsArgs = { path?: string; limit?: number };

export const lsConfig: MinimalToolConfig<LsArgs, LsToolDetails> = {
  icon: '📋',
  target: (args, theme) => {
    const parts = [theme.bold('ls'), pathColor(theme, args.path ?? '.')];
    if (args.limit) parts.push(theme.fg('muted', `--limit=${args.limit}`));
    return parts.join(' ');
  },
  meta: result => {
    const text = textContent(result).trim();
    if (!text || text === '(empty directory)') return '(empty)';
    const entries = text.split('\n').filter(line => !line.startsWith('['));
    const dirCount = entries.filter(e => e.endsWith('/')).length;
    const fileCount = entries.length - dirCount;
    const parts: string[] = [];
    if (dirCount > 0) parts.push(`${dirCount} dir${dirCount !== 1 ? 's' : ''}`);
    if (fileCount > 0)
      parts.push(`${fileCount} file${fileCount !== 1 ? 's' : ''}`);
    const summary = parts.length > 0 ? parts.join(', ') : 'empty';
    const truncation = truncationMeta(result.details?.truncation);
    return truncation ? `(${summary}, ${truncation})` : `(${summary})`;
  },
  renderResultComponent: (statusLine, result, options, theme) =>
    createLsResultComponent(statusLine, result, options, theme),
};

// ── bash ──────────────────────────────────────────────────────────────────

type BashArgs = { command: string; timeout?: number };

export const bashConfig: MinimalToolConfig<BashArgs, BashToolDetails> = {
  icon: '🖥️',
  target: (args, theme) => {
    const cmd = args.command?.includes('\n')
      ? args.command.split('\n')[0] + ' …'
      : args.command;
    const parts = [theme.bold('$'), valueColor(theme, cmd)];
    if (args.timeout)
      parts.push(theme.fg('muted', `(timeout ${args.timeout}s)`));
    return parts.join(' ');
  },
  meta: result => truncationMeta(result.details?.truncation),
  body: (_args, result, theme) => {
    const output = textContent(result).trim();
    if (!output) return undefined;
    const styledOutput = output
      .split('\n')
      .map(line => theme.fg('toolOutput', line))
      .join('\n');
    const { preview, full, truncated } = previewLines(
      styledOutput,
      PREVIEW_LINES
    );
    const totalLines = output.split('\n').length;
    const suffix = truncated
      ? '\n' + theme.fg('muted', `… (${totalLines} lines total)`)
      : '';
    return { preview: preview + suffix, full };
  },
};
