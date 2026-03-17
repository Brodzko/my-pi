import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { spawnSync } from 'node:child_process';
import { showQuickOpen, type QuickOpenMode } from './src/dialog';
import {
  getCachedFiles,
  prefetchFiles,
  refreshFiles,
  type FileResult,
} from './src/files';
import { getSessions } from './src/sessions';

const STATUS_KEY = 'quick-open';

const formatFileStatus = ({
  files,
  method,
  durationMs,
  fromCache,
}: FileResult): string => {
  const count = files.length;
  const timing = fromCache ? 'cached' : `${durationMs}ms`;
  return `files: ${method} · ${count} items · ${timing}`;
};

type InvokeSource = 'at-sign' | 'shortcut';

export default function (pi: ExtensionAPI) {
  let dialogOpen = false;

  // ── Core logic ────────────────────────────────────────────────────────

  const open = async (
    ctx: ExtensionContext,
    initialMode: QuickOpenMode,
    source: InvokeSource
  ): Promise<void> => {
    dialogOpen = true;
    try {
      const cachedFiles = getCachedFiles(ctx.cwd);

      const freshFilesPromise = refreshFiles(ctx.cwd, pi).then(fileResult => {
        ctx.ui.setStatus(STATUS_KEY, formatFileStatus(fileResult));
        return fileResult;
      });

      const sessionPromise = () =>
        getSessions(
          ctx.sessionManager.getSessionDir(),
          ctx.sessionManager.getSessionFile()
        );

      const result = await showQuickOpen(
        ctx,
        {
          files: cachedFiles?.files ?? [],
          sessions: [],
        },
        {
          files: () => freshFilesPromise.then(fileResult => fileResult.files),
          sessions: sessionPromise,
        },
        {
          files: true,
          sessions: false,
        },
        initialMode
      );
      if (!result) return;

      handleResult(ctx, result, source);
    } finally {
      dialogOpen = false;
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  };

  type QuillResult = {
    output: Record<string, unknown> | null;
    aborted: boolean;
  };

  const openInQuill = async (
    ctx: ExtensionContext,
    file: string
  ): Promise<void> => {
    const result = await ctx.ui.custom<QuillResult>(
      (tui, _theme, _kb, done) => {
        tui.stop();
        process.stdout.write('\x1b[2J\x1b[H');

        const spawnResult = spawnSync('quill', [file], {
          cwd: ctx.cwd,
          stdio: ['inherit', 'pipe', 'inherit'],
        });

        tui.start();
        tui.requestRender(true);

        if (spawnResult.status !== 0) {
          done({ output: null, aborted: true });
        } else {
          const raw = spawnResult.stdout?.toString('utf-8').trim();
          try {
            done({ output: raw ? JSON.parse(raw) : null, aborted: false });
          } catch {
            done({ output: null, aborted: true });
          }
        }

        return { render: () => [], invalidate: () => {} };
      }
    );

    if (result.aborted || !result.output) return;

    const json = JSON.stringify(result.output);
    pi.sendUserMessage(
      `Quill review completed for \`${file}\`:\n\n\`\`\`json\n${json}\n\`\`\``,
      { deliverAs: 'followUp' }
    );
  };

  const handleResult = (
    ctx: ExtensionContext,
    result: NonNullable<Awaited<ReturnType<typeof showQuickOpen>>>,
    source: InvokeSource
  ): void => {
    const path = result.type === 'file' ? result.path : result.file;

    if (source === 'at-sign') {
      const insertion =
        result.type === 'file' ? `@${result.path} ` : `@@${result.id} `;
      const current = ctx.ui.getEditorText();
      const separator = current && !current.endsWith(' ') ? ' ' : '';
      ctx.ui.setEditorText(current + separator + insertion);
      return;
    }

    // shortcut → open the file in quill for review
    void openInQuill(ctx, path);
  };

  // ── Terminal input: intercept "@" in the editor ───────────────────────

  const registerAtInterceptor = (ctx: ExtensionContext): void => {
    ctx.ui.onTerminalInput(data => {
      if (data !== '@') return undefined;

      const current = ctx.ui.getEditorText();
      if (current.length > 0 && !/\s$/.test(current)) return undefined;

      if (dialogOpen) return undefined;
      open(ctx, 'files', 'at-sign');
      return { consume: true };
    });
  };

  // ── Event listeners ───────────────────────────────────────────────────

  pi.on('session_start', (_event, ctx) => {
    registerAtInterceptor(ctx);
    prefetchFiles(ctx.cwd, pi);
  });

  pi.on('session_switch', (_event, ctx) => {
    registerAtInterceptor(ctx);
    prefetchFiles(ctx.cwd, pi);
  });

  // ── Shortcut: alt+p ──────────────────────────────────────────────────

  pi.registerShortcut('alt+p', {
    description: 'Quick open — fuzzy find files or sessions',
    handler: ctx => {
      if (dialogOpen) return;
      open(ctx, 'files', 'shortcut');
    },
  });
}
