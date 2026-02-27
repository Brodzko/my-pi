import { GlError, ErrorCode } from './errors.js';
import { execGit } from './exec.js';

let cachedProject: string | undefined;

/**
 * Parse a GitLab project slug from a git remote URL.
 * Supports SSH (git@host:group/project.git) and HTTPS (https://host/group/project.git).
 */
export const parseProjectFromUrl = (url: string): string | undefined => {
  // SSH: git@gitlab.example.com:group/subgroup/project.git
  const sshMatch = url.match(/:(.+?)(?:\.git)?$/);
  if (sshMatch?.[1] && url.includes('@')) {
    return sshMatch[1];
  }

  // HTTPS: https://gitlab.example.com/group/subgroup/project.git
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '');
    if (path) return path;
  } catch {
    // Not a valid URL
  }

  return undefined;
};

/**
 * Auto-detect the GitLab project slug from the `origin` remote.
 * Throws if not in a git repo or no GitLab remote found.
 */
export const detectProject = async (): Promise<string> => {
  if (cachedProject) return cachedProject;

  let url: string;
  try {
    url = await execGit(['remote', 'get-url', 'origin']);
  } catch {
    // Check if we're even in a git repo
    try {
      await execGit(['rev-parse', '--git-dir']);
      throw new GlError(
        ErrorCode.NO_GITLAB_REMOTE,
        "No 'origin' remote found. Ensure this repo has a GitLab origin remote."
      );
    } catch (e) {
      if (e instanceof GlError && e.code === 'NO_GITLAB_REMOTE') throw e;
      throw new GlError(
        ErrorCode.NOT_IN_GIT_REPO,
        'Not inside a git repository. Run this command from a git repo with a GitLab remote.'
      );
    }
  }

  const project = parseProjectFromUrl(url);
  if (!project) {
    throw new GlError(
      ErrorCode.NO_GITLAB_REMOTE,
      `Could not parse GitLab project from remote URL: ${url}`,
      { remoteUrl: url }
    );
  }

  cachedProject = project;
  return project;
};

/** URL-encoded project path for GitLab API calls. */
export const encodedProject = async (): Promise<string> => {
  const project = await detectProject();
  return encodeURIComponent(project);
};
