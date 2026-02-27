import { type ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Print JSON Schema for a Zod schema and exit.
 * Used to implement `--schema` on every command.
 */
export const printSchemaAndExit = (schema: ZodType, name: string): never => {
  const jsonSchema = zodToJsonSchema(schema, name);
  process.stdout.write(JSON.stringify(jsonSchema, null, 2) + '\n');
  process.exit(0);
};
