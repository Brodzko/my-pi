import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createGrepTool,
  createFindTool,
  createLsTool,
  createBashTool,
} from '@mariozechner/pi-coding-agent';
import type { MinimalToolConfig } from './src/types';
import { createMinimalRenderers } from './src/renderers';
import {
  readConfig,
  writeConfig,
  editConfig,
  grepConfig,
  findConfig,
  lsConfig,
  bashConfig,
} from './src/tools';

const register = <TArgs, TDetails>(
  pi: ExtensionAPI,
  builtin: any,
  config: MinimalToolConfig<TArgs, TDetails>
) => {
  const renderers = createMinimalRenderers(config);
  pi.registerTool({
    ...builtin,
    renderCall: renderers.renderCall,
    renderResult: renderers.renderResult,
  } as any);
};

export default (pi: ExtensionAPI) => {
  const cwd = process.cwd();

  register(pi, createReadTool(cwd), readConfig);
  register(pi, createWriteTool(cwd), writeConfig);
  register(pi, createEditTool(cwd), editConfig);
  register(pi, createGrepTool(cwd), grepConfig);
  register(pi, createFindTool(cwd), findConfig);
  register(pi, createLsTool(cwd), lsConfig);
  register(pi, createBashTool(cwd), bashConfig);
};
