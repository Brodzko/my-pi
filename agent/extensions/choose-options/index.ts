import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { registerChooseOptionsTool } from './src/choose-options-tool';
import { registerChooseDemoCommand } from './src/register-choose-demo-command';

export default function chooseOptionsExtension(pi: ExtensionAPI) {
  registerChooseOptionsTool(pi);
  registerChooseDemoCommand(pi);
}
