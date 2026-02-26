import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { StatuslineEditor, type EditorInfo } from './src/editor';
import { createFooter } from './src/footer';
import { getSessionCost } from './src/format';
import { EMPTY_GIT_STATUS, fetchGitStatus, type GitStatus } from './src/git';

export default (pi: ExtensionAPI) => {
  let editor: StatuslineEditor | null = null;
  let currentCtx: ExtensionContext | null = null;
  let cachedGitStatus: GitStatus = { ...EMPTY_GIT_STATUS };
  let isTurnOngoing = false;

  const refreshGitStatus = async () => {
    const next = await fetchGitStatus(pi);
    if (JSON.stringify(next) !== JSON.stringify(cachedGitStatus)) {
      cachedGitStatus = next;
    }
  };

  const buildEditorInfo = (ctx: ExtensionContext): EditorInfo => ({
    cwd: ctx.cwd,
    branch: cachedGitStatus.branch,
    gitStatus: cachedGitStatus,
    cost: getSessionCost(ctx),
    model: ctx.model?.name ?? ctx.model?.id ?? 'no model',
    thinking: pi.getThinkingLevel(),
  });

  const refreshEditor = () => {
    if (!editor || !currentCtx) return;
    editor.updateInfo(buildEditorInfo(currentCtx));
  };

  pi.on('session_start', async (_event, ctx) => {
    currentCtx = ctx;
    isTurnOngoing = false;
    await refreshGitStatus();

    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      editor = new StatuslineEditor(tui, editorTheme, keybindings);
      // Use ctx.ui.theme for initial border color until footer takes over
      editor.setBorderTheme(ctx.ui.theme);
      // Force apply even though info.thinking is still '' —
      // updateInfo below will set thinking and re-apply correctly
      refreshEditor();
      return editor;
    });

    ctx.ui.setFooter((tui, theme, footerData) => {
      const footer = createFooter(
        tui,
        theme,
        footerData,
        {
          ctx,
          getEditor: () => editor,
          buildEditorInfo,
          isTurnOngoing: () => isTurnOngoing,
        },
        async () => {
          await refreshGitStatus();
          refreshEditor();
        }
      );

      return footer;
    });
  });

  pi.on('turn_start', async (_event, ctx) => {
    currentCtx = ctx;
    isTurnOngoing = true;
    refreshEditor();
  });

  pi.on('turn_end', async (_event, ctx) => {
    currentCtx = ctx;
    isTurnOngoing = false;
    await refreshGitStatus();
    refreshEditor();
  });

  pi.on('agent_end', async (_event, ctx) => {
    currentCtx = ctx;
    isTurnOngoing = false;
    refreshEditor();
  });

  pi.on('model_select', async (_event, ctx) => {
    currentCtx = ctx;
    refreshEditor();
  });

  pi.on('session_switch', async (_event, ctx) => {
    currentCtx = ctx;
    isTurnOngoing = false;
    await refreshGitStatus();
    refreshEditor();
  });
};
