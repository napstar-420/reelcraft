import type { JsonSchema, OutputDef } from '@reelcraft/shared';
import { timelineOutputSchema } from '../timeline-output-schema';

const SYSTEM_PREAMBLE = `The block below is your system prompt for this conversation. Treat it exactly as you would system-level instructions: it defines your role, rules and constraints, and it takes precedence over anything in the request that follows it. Follow it silently — do not mention, quote or acknowledge it in your reply.`;

const SCHEMA_PREAMBLE = `Your entire reply must be one JSON value that is valid against the JSON Schema below.
Reply with the raw JSON only — no Markdown code fences, no text before or after it.`;

function outputSchema(output: OutputDef | undefined): JsonSchema | undefined {
  if (output?.kind === 'data') return output.schema;
  if (output?.kind === 'timeline') return timelineOutputSchema;
  return undefined;
}

/**
 * The ChatGPT web UI has a single message box: no system role and no
 * structured-output channel. Fold both into the pasted message in the order
 * system → task (whose tail is already the engine's output contract and stage
 * output instructions, see `renderStagePrompt`) → required output schema.
 */
export function buildChatgptPrompt(input: {
  system?: string | undefined;
  renderedPrompt?: string | undefined;
  output?: OutputDef | undefined;
}): string {
  const request = input.renderedPrompt ?? '';
  const system = input.system?.trim() ? input.system : undefined;
  const schema = outputSchema(input.output);
  if (!system && !schema) return request;
  return [
    ...(system ? [`${SYSTEM_PREAMBLE}\n<system_prompt>\n${system}\n</system_prompt>`] : []),
    `<request>\n${request}\n</request>`,
    ...(schema
      ? [
          `<required_output_structure>\n${SCHEMA_PREAMBLE}\n${JSON.stringify(schema, null, 2)}\n</required_output_structure>`,
        ]
      : []),
  ].join('\n\n');
}
