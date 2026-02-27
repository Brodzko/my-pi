import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCall, renderResult } from './render';

const CLI_ENTRY = 'dist/cli.mjs';

/** Resolve ~/.pi repo root from this file's location (agent/extensions/gitlab/src/) */
const piRoot = (): string => {
  const thisDir =
    typeof __dirname !== 'undefined'
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
  // thisDir = <pi-root>/agent/extensions/gitlab/src
  return resolve(thisDir, '..', '..', '..', '..');
};

const resolveCliDir = (): string | null => {
  const dir = resolve(piRoot(), 'tools', 'gl-cli');
  return existsSync(resolve(dir, 'package.json')) ? dir : null;
};

export const registerGlTool = (pi: ExtensionAPI) => {
  let resolvedEntry: string | null = null;

  const ensureCli = async (): Promise<string> => {
    if (resolvedEntry) return resolvedEntry;

    const cliDir = resolveCliDir();
    if (!cliDir) {
      throw new Error(
        `gl-cli not found. Expected at ${resolve(piRoot(), 'tools', 'gl-cli')}`
      );
    }

    const entry = resolve(cliDir, CLI_ENTRY);

    if (!existsSync(entry)) {
      const install = await pi.exec('npm', ['install'], {
        cwd: cliDir,
        timeout: 60_000,
      });
      if (install.code !== 0) {
        throw new Error(`gl-cli npm install failed:\n${install.stderr}`);
      }

      const build = await pi.exec('npm', ['run', 'build'], {
        cwd: cliDir,
        timeout: 30_000,
      });
      if (build.code !== 0) {
        throw new Error(`gl-cli build failed:\n${build.stderr}`);
      }

      if (!existsSync(entry)) {
        throw new Error(`gl-cli build succeeded but ${CLI_ENTRY} not found.`);
      }
    }

    resolvedEntry = entry;
    return resolvedEntry;
  };

  pi.registerTool({
    name: 'gl',
    label: 'GitLab CLI',
    description:
      'Run a gl CLI command for GitLab merge request operations. ' +
      "Pass the full command string (e.g. 'mr list --state opened'). " +
      'Returns structured JSON. Read the gitlab-review skill to learn available commands.',
    parameters: Type.Object({
      command: Type.String({
        description:
          "gl subcommand and flags, e.g. 'mr list --reviewer @me --state opened'",
      }),
    }),
    renderCall: (args, theme) => renderCall(args as { command: string }, theme),

    renderResult: (result, options, theme) =>
      renderResult(
        result as import('@mariozechner/pi-agent-core').AgentToolResult<{
          exitCode?: number;
          stderr?: string;
        }>,
        options,
        theme
      ),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const entry = await ensureCli();

      const result = await pi.exec(
        'bash',
        ['-c', `node ${entry} ${params.command}`],
        {
          signal,
          cwd: ctx.cwd,
          timeout: 30_000,
        }
      );

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();

      if (result.code !== 0) {
        const errorText = stdout || stderr || `Exit code ${result.code}`;
        return {
          content: [{ type: 'text', text: errorText }],
          isError: true,
          details: { exitCode: result.code, stderr },
        };
      }

      return {
        content: [{ type: 'text', text: stdout }],
        details: { stderr: stderr || undefined },
      };
    },
  });
};
