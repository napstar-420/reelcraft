import { z } from 'zod';

/**
 * The restricted JSON Schema dialect (§4.2). A deliberate subset of the real
 * JSON Schema spec — not the full spec. Blueprint-authored schemas are
 * validated against this subset at save time, independent of what Ajv itself
 * would accept at runtime.
 *
 * Deliberately absent: $ref, oneOf/anyOf/allOf, patternProperties,
 * if/then/else. LLM structured-output modes only support a subset of JSON
 * Schema, and unions are what make the compatibility walker (§16.4) hard.
 */
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  enum?: (string | number)[] | undefined;
  description?: string | undefined;
  properties?: Record<string, JsonSchema> | undefined;
  required?: string[] | undefined;
  items?: JsonSchema | undefined;
  minItems?: number | undefined;
  maxItems?: number | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
}

export const JsonSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z
    .object({
      type: z.enum(['object', 'array', 'string', 'number', 'integer', 'boolean']),
      enum: z.array(z.union([z.string(), z.number()])).optional(),
      description: z.string().optional(),
      properties: z.record(z.string(), JsonSchema).optional(),
      required: z.array(z.string()).optional(),
      items: JsonSchema.optional(),
      minItems: z.number().optional(),
      maxItems: z.number().optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
    })
    .strict(),
);
