import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export function toCleanJsonSchema(schema: z.ZodType<any>): any {
  const jsonSchema = zodToJsonSchema(schema);
  delete jsonSchema.additionalProperties;
  delete jsonSchema.$schema;
  return jsonSchema;
}
