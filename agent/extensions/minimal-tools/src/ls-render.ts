import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { LsToolDetails, Theme, ThemeColor } from '@mariozechner/pi-coding-agent';
import { Text, visibleWidth, truncateToWidth } from '@mariozechner/pi-tui';
import type { Component } from '@mariozechner/pi-tui';
import { textContent } from './format';

// ── Nerd Font icon mapping (matches eza --icons) ─────────────────────────

const DIR_ICON = '\u{f115}'; // 
const DEFAULT_FILE_ICON = '\u{f016}'; // 

const EXTENSION_ICONS: Record<string, string> = {
  // Languages
  ts: '\u{e628}', // 
  tsx: '\u{e7ba}', // 
  js: '\u{e74e}', // 
  jsx: '\u{e7ba}', // 
  mjs: '\u{e74e}', // 
  cjs: '\u{e74e}', // 
  py: '\u{e73c}', // 
  rb: '\u{e791}', // 
  rs: '\u{e7a8}', // 
  go: '\u{e627}', // 
  java: '\u{e738}', // 
  kt: '\u{e634}', // 
  swift: '\u{e755}', // 
  c: '\u{e61e}', // 
  cpp: '\u{e61d}', // 
  h: '\u{e61e}', // 
  cs: '\u{f81a}', // 󰠚
  php: '\u{e73d}', // 
  lua: '\u{e620}', // 
  zig: '\u{e6a9}', // 
  ex: '\u{e62d}', // 
  exs: '\u{e62d}', // 
  erl: '\u{e7b1}', // 
  hs: '\u{e777}', // 
  ml: '\u{e67a}', // 
  scala: '\u{e737}', // 
  clj: '\u{e768}', // 
  r: '\u{f25d}', // 
  dart: '\u{e798}', // 
  vue: '\u{e6a0}', // 
  svelte: '\u{e697}', // 

  // Shell / scripts
  sh: '\u{e795}', // 
  bash: '\u{e795}', // 
  zsh: '\u{e795}', // 
  fish: '\u{e795}', // 
  ps1: '\u{e795}', // 

  // Config / data
  json: '\u{e60b}', // 
  yaml: '\u{e60b}', // 
  yml: '\u{e60b}', // 
  toml: '\u{e60b}', // 
  xml: '\u{e619}', // 
  csv: '\u{f1c3}', // 
  ini: '\u{e615}', // 
  env: '\u{e615}', // 
  conf: '\u{e615}', // 

  // Web
  html: '\u{e736}', // 
  htm: '\u{e736}', // 
  css: '\u{e749}', // 
  scss: '\u{e749}', // 
  sass: '\u{e749}', // 
  less: '\u{e749}', // 
  svg: '\u{f1c5}', // 
  wasm: '\u{e6a1}', // 

  // Docs
  md: '\u{e73e}', // 
  mdx: '\u{e73e}', // 
  txt: '\u{f15c}', // 
  pdf: '\u{f1c1}', // 
  doc: '\u{f1c2}', // 
  docx: '\u{f1c2}', // 
  rst: '\u{f15c}', // 

  // Images
  png: '\u{f1c5}', // 
  jpg: '\u{f1c5}', // 
  jpeg: '\u{f1c5}', // 
  gif: '\u{f1c5}', // 
  webp: '\u{f1c5}', // 
  ico: '\u{f1c5}', // 
  bmp: '\u{f1c5}', // 

  // Archives
  zip: '\u{f1c6}', // 
  tar: '\u{f1c6}', // 
  gz: '\u{f1c6}', // 
  bz2: '\u{f1c6}', // 
  xz: '\u{f1c6}', // 
  '7z': '\u{f1c6}', // 
  rar: '\u{f1c6}', // 

  // Build / package
  lock: '\u{f023}', // 
  dockerfile: '\u{e7b0}', // 
  docker: '\u{e7b0}', // 

  // Git
  gitignore: '\u{e702}', // 
  gitmodules: '\u{e702}', // 
  gitattributes: '\u{e702}', // 

  // Media
  mp3: '\u{f001}', // 
  wav: '\u{f001}', // 
  mp4: '\u{f008}', // 
  mov: '\u{f008}', // 
  avi: '\u{f008}', // 
  mkv: '\u{f008}', // 

  // Database
  sql: '\u{f1c0}', // 
  sqlite: '\u{f1c0}', // 
  db: '\u{f1c0}', // 

  // Misc
  log: '\u{f15c}', // 
  map: '\u{f279}', // 
  woff: '\u{f031}', // 
  woff2: '\u{f031}', // 
  ttf: '\u{f031}', // 
  otf: '\u{f031}', // 
  eot: '\u{f031}', // 
};

const FILENAME_ICONS: Record<string, string> = {
  dockerfile: '\u{e7b0}', // 
  makefile: '\u{e615}', // 
  rakefile: '\u{e791}', // 
  gemfile: '\u{e791}', // 
  license: '\u{f0219}', // 󰈙
  readme: '\u{e73e}', // 
  'package.json': '\u{e71e}', // 
  'tsconfig.json': '\u{e628}', // 
  '.gitignore': '\u{e702}', // 
  '.env': '\u{e615}', // 
  '.eslintrc': '\u{e60c}', // 
  '.prettierrc': '\u{e615}', // 
  'cargo.toml': '\u{e7a8}', // 
  'go.mod': '\u{e627}', // 
  'go.sum': '\u{e627}', // 
};

const getIcon = (entry: string): string => {
  const isDir = entry.endsWith('/');
  if (isDir) return DIR_ICON;

  const lower = entry.toLowerCase();

  const filenameIcon = FILENAME_ICONS[lower];
  if (filenameIcon) return filenameIcon;

  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = lower.slice(dotIdx + 1);
    const extIcon = EXTENSION_ICONS[ext];
    if (extIcon) return extIcon;
  }

  return DEFAULT_FILE_ICON;
};

// ── Per-extension icon colors ─────────────────────────────────────────────

const ICON_COLORS: Record<string, ThemeColor> = {
  ts: 'syntaxKeyword', tsx: 'syntaxKeyword',
  js: 'warning', jsx: 'warning', mjs: 'warning', cjs: 'warning',
  py: 'warning',
  rb: 'error',
  rs: 'syntaxType',
  go: 'syntaxVariable',
  java: 'error', kt: 'error',
  c: 'syntaxKeyword', cpp: 'syntaxKeyword', h: 'syntaxKeyword',
  cs: 'syntaxFunction',
  swift: 'syntaxType',
  css: 'syntaxFunction', scss: 'syntaxFunction', sass: 'syntaxFunction', less: 'syntaxFunction',
  html: 'syntaxType', htm: 'syntaxType',
  vue: 'success', svelte: 'success',
  sh: 'success', bash: 'success', zsh: 'success', fish: 'success',
  md: 'accent', mdx: 'accent',
  json: 'warning', yaml: 'muted', yml: 'muted', toml: 'muted',
  xml: 'syntaxType',
  svg: 'warning',
  png: 'syntaxFunction', jpg: 'syntaxFunction', jpeg: 'syntaxFunction',
  gif: 'syntaxFunction', webp: 'syntaxFunction', ico: 'syntaxFunction',
  sql: 'syntaxString', sqlite: 'syntaxString', db: 'syntaxString',
  lock: 'muted', env: 'muted', ini: 'muted', conf: 'muted',
  log: 'dim', map: 'dim',
};

const getIconColor = (entry: string): ThemeColor | undefined => {
  const lower = entry.toLowerCase();
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx !== -1) return ICON_COLORS[lower.slice(dotIdx + 1)];
  return undefined;
};

// ── Rendering ─────────────────────────────────────────────────────────────

const parseEntries = (result: AgentToolResult<LsToolDetails>): string[] => {
  const raw = textContent(result).trim();
  if (!raw || raw === '(empty directory)') return [];
  return raw.split('\n').filter((line) => !line.startsWith('['));
};

const colorEntry = (entry: string, theme: Theme): string => {
  const isDir = entry.endsWith('/');
  const icon = getIcon(entry);

  if (isDir) {
    return theme.fg('syntaxVariable', icon) + ' ' + theme.bold(theme.fg('syntaxVariable', entry));
  }

  if (entry.startsWith('.')) {
    return theme.fg('dim', icon) + ' ' + theme.fg('dim', entry);
  }

  const iconColor = getIconColor(entry);
  const styledIcon = iconColor ? theme.fg(iconColor, icon) : theme.fg('dim', icon);
  return styledIcon + ' ' + theme.fg('text', entry);
};

const layoutColumns = (
  items: string[],
  availableWidth: number
): string[] => {
  if (items.length === 0) return [];

  // Find the widest item (visible width, accounting for ANSI)
  const widths = items.map((item) => visibleWidth(item));
  const maxItemWidth = Math.max(...widths);

  const COL_GAP = 2;
  const minColWidth = maxItemWidth + COL_GAP;

  // How many columns fit?
  const numCols = Math.max(1, Math.floor(availableWidth / minColWidth));

  if (numCols === 1) {
    return items;
  }

  const colWidth = Math.floor(availableWidth / numCols);
  const numRows = Math.ceil(items.length / numCols);
  const lines: string[] = [];

  for (let row = 0; row < numRows; row++) {
    let line = '';
    for (let col = 0; col < numCols; col++) {
      const idx = col * numRows + row;
      if (idx >= items.length) break;

      const item = items[idx];
      const isLastCol = col === numCols - 1 || (col + 1) * numRows + row >= items.length;

      if (isLastCol) {
        line += item;
      } else {
        line += truncateToWidth(item, colWidth, '…', true);
      }
    }
    lines.push(line);
  }

  return lines;
};

export const createLsResultComponent = (
  statusLine: string,
  result: AgentToolResult<LsToolDetails>,
  options: { expanded: boolean },
  theme: Theme
): Component => {
  const entries = parseEntries(result);
  const dirCount = entries.filter((e) => e.endsWith('/')).length;
  const fileCount = entries.length - dirCount;

  if (!options.expanded) {
    const parts: string[] = [];
    if (dirCount > 0) parts.push(`${dirCount} dir${dirCount !== 1 ? 's' : ''}`);
    if (fileCount > 0) parts.push(`${fileCount} file${fileCount !== 1 ? 's' : ''}`);
    const summary = parts.length > 0 ? parts.join(', ') : 'empty';
    const line = `${statusLine} ${theme.fg('muted', `(${summary})`)}`;
    return new Text(line, 0, 0);
  }

  // Expanded: eza-like icon + color grid
  const colored = entries.map((entry) => colorEntry(entry, theme));

  return {
    render(width: number): string[] {
      const grid = layoutColumns(colored, width);
      const headerLine = `${statusLine} ${theme.fg('muted', `(${entries.length} entries)`)}`;
      return [headerLine, '', ...grid];
    },
    invalidate() {},
  };
};
