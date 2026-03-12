import type {
  ExtensionAPI,
  ExtensionContext,
  ThemeColor,
} from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { Text } from '@mariozechner/pi-tui';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Runner ──────────────────────────────────────────────────────────────────

type QuillResult = {
  output: Record<string, unknown> | null;
  aborted: boolean;
};

const runQuill = (
  ctx: ExtensionContext,
  file: string,
  options: Record<string, unknown> = {}
): Promise<QuillResult> =>
  ctx.ui.custom<QuillResult>((tui, _theme, _kb, done) => {
    tui.stop();
    process.stdout.write('\x1b[2J\x1b[H');

    const args: string[] = [file];
    let tempFile: string | undefined;

    // Pass annotations via temp file to avoid stdin conflicts
    const annotations = options.annotations as unknown[] | undefined;
    if (annotations && annotations.length > 0) {
      const tempDir = mkdtempSync(join(tmpdir(), 'quill-'));
      tempFile = join(tempDir, 'annotations.json');
      writeFileSync(tempFile, JSON.stringify({ annotations }));
      args.push('--annotations', tempFile);
    }

    if (options.diffRef) args.push('--diff-ref', String(options.diffRef));
    if (options.staged) args.push('--staged');
    if (options.unstaged) args.push('--unstaged');
    if (options.line) args.push('--line', String(options.line));
    if (options.focusAnnotation)
      args.push('--focus-annotation', String(options.focusAnnotation));

    const result = spawnSync('quill', args, {
      cwd: ctx.cwd,
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    if (tempFile) {
      try {
        unlinkSync(tempFile);
      } catch {
        // ignore
      }
    }

    tui.start();
    tui.requestRender(true);

    if (result.status !== 0) {
      done({ output: null, aborted: true });
    } else {
      const raw = result.stdout?.toString('utf-8').trim();
      try {
        done({ output: raw ? JSON.parse(raw) : null, aborted: false });
      } catch {
        done({ output: null, aborted: true });
      }
    }

    return { render: () => [], invalidate: () => {} };
  });

// ── Render helpers ──────────────────────────────────────────────────────────

const ICON = '🪶';

const renderDecision = (
  output: Record<string, unknown> | null | undefined,
  aborted: boolean,
  theme: { fg: (role: ThemeColor, text: string) => string }
): string => {
  if (aborted || !output) return theme.fg('warning', 'aborted');
  const decision = output.decision as string | undefined;
  if (decision === 'approve') return theme.fg('success', '✓ approved');
  if (decision === 'deny') return theme.fg('error', '✗ denied');
  return theme.fg('muted', String(decision ?? 'unknown'));
};

// ── Tool ────────────────────────────────────────────────────────────────────

export default function quillExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'quill_review',
    label: 'Quill Review',
    description:
      'Open a file in quill for interactive user review with annotations. ' +
      'Blocks until the user finishes (approve/deny) or aborts. ' +
      'Returns the user decision and annotations. ' +
      'Read the quill skill for usage guidance.',
    parameters: Type.Object({
      file: Type.String({ description: 'Path to the file to review' }),
      annotations: Type.Optional(
        Type.Array(Type.Unknown(), { description: 'Annotations to pre-load' })
      ),
      diffRef: Type.Optional(
        Type.String({
          description: 'Diff against a git ref (branch, tag, SHA)',
        })
      ),
      staged: Type.Optional(
        Type.Boolean({ description: 'Diff staged changes' })
      ),
      unstaged: Type.Optional(
        Type.Boolean({ description: 'Diff unstaged changes' })
      ),
      line: Type.Optional(
        Type.Number({ description: 'Start cursor at this line (1-indexed)' })
      ),
      focusAnnotation: Type.Optional(
        Type.String({ description: 'Focus on annotation by ID' })
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: quill requires interactive mode',
            },
          ],
          isError: true,
          details: { output: null, aborted: true } satisfies QuillResult,
        };
      }

      const file = params.file.replace(/^@/, '');
      const result = await runQuill(ctx, file, params);

      if (result.aborted || !result.output) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'User aborted the review (Ctrl+C). No feedback was given.',
            },
          ],
          details: result,
        };
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result.output) },
        ],
        details: result,
      };
    },

    renderCall(args, theme) {
      const file = (args.file ?? '?').replace(/^@/, '');
      return new Text(
        `${ICON} ${theme.fg('toolTitle', theme.bold('quill'))} ${theme.fg('accent', file)}`,
        0,
        0
      );
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as QuillResult | undefined;
      const aborted = details?.aborted ?? true;
      const output = details?.output;

      const summary = `${ICON} ${renderDecision(output, aborted, theme)}`;

      if (!expanded || !output) {
        return new Text(summary, 0, 0);
      }

      // Expanded: show raw JSON
      const json = JSON.stringify(output, null, 2);
      return new Text(`${summary}\n${theme.fg('dim', json)}`, 0, 0);
    },
  });

  // ── Command ─────────────────────────────────────────────────────────────

  pi.registerCommand('quill', {
    description:
      'Open a file in quill for review — /quill @file [--diff-ref ref] [--staged] [--unstaged]',

    handler: async (raw, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify('quill requires interactive mode', 'error');
        return;
      }

      const tokens = raw.trim().split(/\s+/);
      const options: Record<string, unknown> = {};
      let file: string | null = null;

      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === '--diff-ref' && i + 1 < tokens.length) {
          options.diffRef = tokens[++i];
        } else if (t === '--staged') {
          options.staged = true;
        } else if (t === '--unstaged') {
          options.unstaged = true;
        } else if (!file) {
          file = t.replace(/^@/, '');
        }
      }

      if (!file) {
        ctx.ui.notify(
          'Usage: /quill @file [--diff-ref ref] [--staged] [--unstaged]',
          'warning'
        );
        return;
      }

      const result = await runQuill(ctx, file, options);

      if (result.aborted || !result.output) {
        ctx.ui.notify('Review aborted', 'info');
        return;
      }

      const json = JSON.stringify(result.output);
      pi.sendUserMessage(
        `Quill review completed for \`${file}\`:\n\n\`\`\`json\n${json}\n\`\`\``,
        {
          deliverAs: 'followUp',
        }
      );
    },
  });
}
