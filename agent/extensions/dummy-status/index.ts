import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export default (pi: ExtensionAPI) => {
  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.setStatus('bash-ask', '🛡 bash-ask');
    ctx.ui.setStatus('dummy', '🧪 dummy');
  });
};
