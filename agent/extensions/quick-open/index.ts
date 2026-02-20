import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { showQuickOpen, type QuickOpenMode } from './src/dialog';
import { getFiles, prefetchFiles, type FileResult } from './src/files';
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
      const [fileResult, sessions] = await Promise.all([
        getFiles(ctx.cwd, pi),
        getSessions(
          ctx.sessionManager.getSessionDir(),
          ctx.sessionManager.getSessionFile()
        ),
      ]);

      ctx.ui.setStatus(STATUS_KEY, formatFileStatus(fileResult));

      const result = await showQuickOpen(
        ctx,
        fileResult.files,
        sessions,
        initialMode
      );
      if (!result) return;

      handleResult(ctx, result, source);
    } finally {
      dialogOpen = false;
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  };

  const handleResult = (
    ctx: ExtensionContext,
    result: NonNullable<Awaited<ReturnType<typeof showQuickOpen>>>,
    source: InvokeSource
  ): void => {
    const path = result.type === 'file' ? result.path : result.file;

    if (source === 'at-sign') {
      const insertion =
        result.type === 'file' ? `@${result.path} ` : `@@${result.file} `;
      // Defer by one tick so the TUI finishes tearing down the overlay first.
      setTimeout(() => {
        const current = ctx.ui.getEditorText();
        const separator = current && !current.endsWith(' ') ? ' ' : '';
        ctx.ui.setEditorText(current + separator + insertion);
      }, 0);
      return;
    }

    // shortcut → cat the file and display as a custom message
    pi.exec('cat', [path], { cwd: ctx.cwd, timeout: 5_000 }).then(result => {
      const output =
        result.code === 0 ? result.stdout : `Error: ${result.stderr}`;
      pi.sendMessage({
        customType: 'quick-open:cat',
        content: `**${path}**\n\`\`\`\n${output}\n\`\`\``,
        display: true,
      });
    });
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
