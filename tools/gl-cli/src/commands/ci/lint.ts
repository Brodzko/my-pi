import { defineCommand } from 'citty';
import { z } from 'zod';
import { ensureAuth } from '../../lib/auth.js';
import { execGlab } from '../../lib/exec.js';
import { outputJson, outputError, success } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';
import { GlError, ErrorCode } from '../../lib/errors.js';

const InputSchema = z.object({
  content: z.string().optional(),
  dryRun: z.boolean().default(false),
});

export const lintCommand = defineCommand({
  meta: {
    name: 'lint',
    description:
      'Validate CI/CD configuration. Lints the current .gitlab-ci.yml by default, or arbitrary YAML via --content.',
  },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
    content: {
      type: 'string',
      description:
        'Raw YAML string to lint instead of the project .gitlab-ci.yml',
    },
    'dry-run': {
      type: 'boolean',
      description:
        'Include merged YAML in the response (passes --dry-run to glab)',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema) printSchemaAndExit(InputSchema, 'CiLintInput');

      await ensureAuth();

      const glabArgs = ['ci', 'lint'];

      if (args['dry-run']) glabArgs.push('--dry-run');

      if (args.content) {
        // glab ci lint accepts a file path as positional arg; we write to stdin instead
        // but glab doesn't support stdin — it needs a file path.
        // Write content to a temp file and pass it.
        const { writeFileSync, unlinkSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { tmpdir } = await import('node:os');
        const tmpFile = join(
          tmpdir(),
          `gl-ci-lint-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`
        );
        try {
          writeFileSync(tmpFile, args.content, 'utf-8');
          glabArgs.push(tmpFile);
          const stdout = await execGlab(glabArgs);
          outputJson(success(parseLintOutput(stdout)));
        } finally {
          try {
            unlinkSync(tmpFile);
          } catch {
            // best effort cleanup
          }
        }
      } else {
        const stdout = await execGlab(glabArgs);
        outputJson(success(parseLintOutput(stdout)));
      }
    } catch (err) {
      // glab ci lint exits non-zero when the config is invalid.
      // We still want to surface the validation errors as structured data.
      if (
        err instanceof GlError &&
        err.code === ErrorCode.GLAB_ERROR &&
        err.details
      ) {
        // Lint validation failure — surface it as structured data
        outputJson(
          success({
            valid: false,
            errors: [err.message],
          })
        );
        return;
      }
      outputError(err);
    }
  },
});

const parseLintOutput = (
  stdout: string
): { valid: boolean; warnings: string[]; errors: string[] } => {
  const lines = stdout.trim().split('\n');
  const valid = lines.some(
    l => l.includes('is valid') || l.includes('syntax is correct')
  );
  const warnings = lines.filter(l => l.toLowerCase().includes('warning'));
  const errors = lines.filter(l => l.toLowerCase().includes('error'));

  return { valid: valid && errors.length === 0, warnings, errors };
};
