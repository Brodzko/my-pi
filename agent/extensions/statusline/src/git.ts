import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export type GitStatus = {
  branch: string | null;
  staged: number;
  modified: number;
  untracked: number;
  renamed: number;
  deleted: number;
  ahead: number;
  behind: number;
  stashed: number;
  conflicted: number;
};

export const EMPTY_GIT_STATUS: GitStatus = {
  branch: null,
  staged: 0,
  modified: 0,
  untracked: 0,
  renamed: 0,
  deleted: 0,
  ahead: 0,
  behind: 0,
  stashed: 0,
  conflicted: 0,
};

export const parseGitStatus = (porcelain: string): GitStatus => {
  const status: GitStatus = { ...EMPTY_GIT_STATUS };

  for (const line of porcelain.split('\n')) {
    if (!line) continue;

    // porcelain v2 entry types:
    //   "u ..."  — unmerged (conflict)
    //   "2 XY …" — rename/copy
    //   "1 XY …" — ordinary change
    //   "? …"    — untracked
    if (line.startsWith('u ')) {
      status.conflicted++;
      continue;
    }

    if (line.startsWith('2 ')) {
      const xy = line.split(' ')[1] ?? '  ';
      if (xy[0] === 'R' || xy[0] === 'C') status.renamed++;
      if (xy[1] !== ' ' && xy[1] !== '.') status.modified++;
      continue;
    }

    if (line.startsWith('? ')) {
      status.untracked++;
      continue;
    }

    if (line.startsWith('1 ')) {
      const xy = line.split(' ')[1] ?? '  ';
      if (xy[0] === 'D') status.deleted++;
      else if (xy[0] !== ' ' && xy[0] !== '.') status.staged++;
      if (xy[1] === 'D') status.deleted++;
      else if (xy[1] !== ' ' && xy[1] !== '.') status.modified++;
    }
  }

  return status;
};

export const parseAheadBehind = (
  branchLine: string
): { ahead: number; behind: number } => {
  // porcelain v2 format: "# branch.ab +N -M"
  const aheadMatch = branchLine.match(/\+(\d+)/);
  const behindMatch = branchLine.match(/-(\d+)/);
  return {
    ahead: aheadMatch ? parseInt(aheadMatch[1]!, 10) : 0,
    behind: behindMatch ? parseInt(behindMatch[1]!, 10) : 0,
  };
};

/** Starship-style status symbols (no counts, just presence indicators). */
export const formatGitStatus = (status: GitStatus): string => {
  const parts: string[] = [];

  if (status.ahead > 0 && status.behind > 0) {
    parts.push('↕');
  } else if (status.ahead > 0) {
    parts.push('↑');
  } else if (status.behind > 0) {
    parts.push('↓');
  }

  if (status.stashed > 0) parts.push('$');
  if (status.conflicted > 0) parts.push('=');
  if (status.staged > 0) parts.push('+');
  if (status.modified > 0) parts.push('!');
  if (status.renamed > 0) parts.push('~');
  if (status.deleted > 0) parts.push('x');
  if (status.untracked > 0) parts.push('?');

  return parts.length > 0 ? `[${parts.join('')}]` : '';
};

/** Fetch git status + stash count via pi.exec. */
export const fetchGitStatus = async (pi: ExtensionAPI): Promise<GitStatus> => {
  try {
    const [statusResult, stashResult] = await Promise.all([
      pi.exec('git', ['status', '--porcelain=v2', '--branch'], {
        timeout: 3000,
      }),
      pi.exec('git', ['stash', 'list'], { timeout: 3000 }),
    ]);

    if (statusResult.code !== 0) return { ...EMPTY_GIT_STATUS };

    const lines = statusResult.stdout.split('\n');
    const branchHead = lines.find(l => l.startsWith('# branch.head'));
    const branchHeader = lines.find(l => l.startsWith('# branch.ab')) ?? '';
    const statusLines = lines.filter(l => !l.startsWith('#')).join('\n');

    const status = parseGitStatus(statusLines);
    status.branch = branchHead?.split(' ')[2] ?? null;
    if (status.branch === '(detached)') status.branch = 'HEAD';
    const { ahead, behind } = parseAheadBehind(branchHeader);
    status.ahead = ahead;
    status.behind = behind;
    status.stashed =
      stashResult.code === 0
        ? stashResult.stdout.split('\n').filter(Boolean).length
        : 0;

    return status;
  } catch {
    return { ...EMPTY_GIT_STATUS };
  }
};
