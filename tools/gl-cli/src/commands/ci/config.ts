import { defineCommand } from 'citty';
import { z } from 'zod';
import { ensureAuth } from '../../lib/auth.js';
import { execGlab } from '../../lib/exec.js';
import { outputJson, outputError, success } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';

const InputSchema = z.object({});

export const configCommand = defineCommand({
  meta: {
    name: 'config',
    description:
      'Print the final merged CI/CD configuration for the current project',
  },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema) printSchemaAndExit(InputSchema, 'CiConfigInput');

      await ensureAuth();

      const stdout = await execGlab(['ci', 'config']);
      outputJson(success({ config: stdout.trim() }));
    } catch (err) {
      outputError(err);
    }
  },
});
