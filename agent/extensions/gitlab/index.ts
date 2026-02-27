import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { registerGlTool } from './src/gl-tool';

export default function gitlabExtension(pi: ExtensionAPI) {
  registerGlTool(pi);
}
