import { defineCommand } from 'citty';
import { configCommand } from './config.js';
import { lintCommand } from './lint.js';

export const ciCommand = defineCommand({
  meta: { name: 'ci', description: 'CI/CD configuration and validation' },
  subCommands: {
    config: configCommand,
    lint: lintCommand,
  },
});
