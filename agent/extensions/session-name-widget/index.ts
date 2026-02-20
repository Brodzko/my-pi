import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { Text } from '@mariozechner/pi-tui';

const WIDGET_KEY = 'session-name-widget';

const renderSessionName = (ctx: ExtensionContext, pi: ExtensionAPI) => {
  ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
    const name = pi.getSessionName()?.trim();

    if (!name) {
      return {
        render: () => [],
        invalidate: () => {},
      };
    }

    return new Text(theme.fg('dim', `session: ${name}`), 0, 0);
  });
};

export default function (pi: ExtensionAPI) {
  const refresh = async (_event: unknown, ctx: ExtensionContext) => {
    renderSessionName(ctx, pi);
  };

  pi.on('session_start', refresh);
  pi.on('session_switch', refresh);

  pi.on('agent_start', refresh);
  pi.on('turn_start', refresh);
  pi.on('message_start', refresh);
  pi.on('message_update', refresh);
  pi.on('message_end', refresh);
  pi.on('turn_end', refresh);
  pi.on('agent_end', refresh);
}
