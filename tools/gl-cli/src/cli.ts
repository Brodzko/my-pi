import { defineCommand, runMain } from 'citty';
import { mrCommand } from './commands/mr/index.js';

const main = defineCommand({
  meta: {
    name: 'gl',
    version: '0.1.0',
    description:
      'Portable GitLab review CLI for agent-assisted code review workflows',
  },
  subCommands: {
    mr: mrCommand,
  },
});

runMain(main);
