import { createHash } from 'node:crypto';
import { BUILTIN_CHECKS } from '../../check/builtins/index';
import { GUIDE_TOPICS } from '../guide';
import { z } from 'zod';
import type { AssistantToolDef } from '../agent/assistant-agent.interface';
import { ACTION_TOOLS } from './action-tools';
import { askUser } from './ask-user';
import { MANAGE_TOOLS } from './manage-tools';
import { REVIEW_TOOLS } from './review-tools';
import { WATCH_TOOLS } from './watch-tools';
import { presentPlan } from './present-plan';
import { BLUEPRINT_TOOLS } from './blueprint-tools';
import { CATALOG_TOOLS } from './catalog-tools';
import { DOCS_TOOLS } from './docs-tools';
import { MEDIA_TOOLS } from './media-tools';
import { LIBRARY_TOOLS } from './library-tools';
import { WEB_TOOLS } from './web-tools';
import { BREAKDOWN_TOOLS } from './breakdown-tools';
import { MEMORY_TOOLS } from './memory-tools';
import { GOAL_TOOLS } from './goal-tools';
import { TIMELINE_TOOLS } from './timeline-tools';
import { TOOL_SUMMARIES } from './summaries';
import { obj } from './json-schemas';
import { zodIssues } from './draft-checks';
import { READ_TOOLS } from './read-tools';
import { RUN_TOOLS } from './run-tools';
import { WRITE_TOOLS } from './write-tools';
import type {
  AssistantTool,
  JsonObject,
  NarrowedEnums,
  ToolDeps,
  ToolOutcome,
  TurnContext,
} from './types';

const MAX_DESCRIBE = 12;
const DescribeInput = z.object({ names: z.array(z.string().min(1)).min(1).max(MAX_DESCRIBE) });

/** The tools are sent to the model as a name and a line each; this gives the rest when it needs
 * it: the full description (how to use it, what it returns) and the input schema. */
const describeTools: AssistantTool<z.infer<typeof DescribeInput>> = {
  name: 'describe_tools',
  kind: 'read',
  description: `Read tools in full: what each does and returns, its rules, and its input schema. Your tools are listed by name and one line only, so describe a tool before you first use it in a chat (it stays in the chat; no need to describe it again), several at once (up to ${MAX_DESCRIBE}). A call with wrong input is refused with the same details.`,
  input: DescribeInput,
  jsonSchema: () =>
    obj(
      {
        names: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_DESCRIBE,
          items: { type: 'string' },
          description: 'Tool names',
        },
      },
      ['names'],
    ),
  async handler(_ctx, deps, input): Promise<ToolOutcome> {
    const narrowed = buildNarrowedEnums(deps);
    const unknown = input.names.filter((name) => !BY_NAME.has(name));
    if (unknown.length === input.names.length) {
      return {
        ok: false,
        error: `Unknown tool${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`,
      };
    }
    return {
      ok: true,
      result: {
        tools: input.names
          .map((name) => BY_NAME.get(name))
          .filter((tool): tool is AssistantTool<never> => tool !== undefined)
          .map((tool) => usageOf(tool, narrowed)),
        ...(unknown.length && { unknown }),
      },
    };
  },
};

/** Tools sent in full: needed in almost every chat, or to read the others. */
export const FULL_TOOLS: ReadonlySet<string> = new Set([
  'describe_tools',
  'ask_user',
  'present_plan',
  'read_guide',
  'search_docs',
]);

export const ASSISTANT_TOOLS: ReadonlyArray<AssistantTool<never>> = [
  ...CATALOG_TOOLS,
  ...READ_TOOLS,
  ...BLUEPRINT_TOOLS,
  ...RUN_TOOLS,
  ...REVIEW_TOOLS,
  ...MEDIA_TOOLS,
  ...BREAKDOWN_TOOLS,
  ...WRITE_TOOLS,
  ...MANAGE_TOOLS,
  ...LIBRARY_TOOLS,
  ...ACTION_TOOLS,
  ...WATCH_TOOLS,
  ...DOCS_TOOLS,
  ...WEB_TOOLS,
  ...MEMORY_TOOLS,
  ...GOAL_TOOLS,
  ...TIMELINE_TOOLS,
  askUser as unknown as AssistantTool<never>,
  presentPlan as unknown as AssistantTool<never>,
  describeTools as unknown as AssistantTool<never>,
];

const PLAN_REFUSAL =
  'Plan mode: you can read and investigate, but not change or run anything. Finish looking, then call present_plan with what you would do.';

const BY_NAME = new Map(ASSISTANT_TOOLS.map((tool) => [tool.name, tool]));

export function buildNarrowedEnums(deps: Pick<ToolDeps, 'capabilities' | 'styles'>): NarrowedEnums {
  return {
    capabilityKeys: deps.capabilities
      .list()
      .map((c) => c.key)
      .sort(),
    checkKeys: Object.keys(BUILTIN_CHECKS).sort(),
    styleIds: deps.styles
      .list()
      .map((s) => s.id)
      .sort(),
    guideTopics: [...GUIDE_TOPICS],
  };
}

/** A tool as the model meets it: most tools by name, one line and their argument names (the rest
 * comes from describe_tools); a few in full. */
export function buildToolDefs(narrowed: NarrowedEnums): AssistantToolDef[] {
  return ASSISTANT_TOOLS.map((tool) =>
    FULL_TOOLS.has(tool.name) ? fullToolDef(tool, narrowed) : shortToolDef(tool, narrowed),
  );
}

export function fullToolDef(tool: AssistantTool<never>, narrowed: NarrowedEnums): AssistantToolDef {
  return { name: tool.name, description: tool.description, inputSchema: tool.jsonSchema(narrowed) };
}

function shortToolDef(tool: AssistantTool<never>, narrowed: NarrowedEnums): AssistantToolDef {
  const summary = TOOL_SUMMARIES[tool.name] ?? tool.description.slice(0, 120);
  const args = argNames(tool.jsonSchema(narrowed));
  return {
    name: tool.name,
    description: args ? `${summary} Args: ${args}.` : summary,
    // validated by the tool's Zod input when called; describe_tools gives the schema
    inputSchema: { type: 'object' },
  };
}

/** "runId, stageKey, items?": the top-level arguments, optional ones marked. */
function argNames(schema: JsonObject): string {
  const properties = Object.keys((schema.properties as JsonObject | undefined) ?? {});
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return properties.map((name) => (required.has(name) ? name : `${name}?`)).join(', ');
}

/** Everything about one tool, for describe_tools and a refused call. */
export function usageOf(tool: AssistantTool<never>, narrowed: NarrowedEnums) {
  return {
    name: tool.name,
    kind: tool.kind,
    description: tool.description,
    inputSchema: tool.jsonSchema(narrowed),
  };
}

/** Identifies the tool set a session was created with; a different hash means the app changed. */
export function toolsHash(defs: AssistantToolDef[]): string {
  return createHash('sha256').update(JSON.stringify(defs)).digest('hex').slice(0, 16);
}

/** Runs one tool call. Never throws: a bad call or a failing handler becomes `{ok:false}` so the
 * model can recover within the same turn. */
export async function runTool(
  name: string,
  rawArgs: unknown,
  ctx: TurnContext,
  deps: ToolDeps,
): Promise<ToolOutcome> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return { ok: false, error: `Unknown tool "${name}". Tools: ${[...BY_NAME.keys()].join(', ')}` };
  }
  if (ctx.mode === 'plan' && tool.kind !== 'read' && tool.kind !== 'interact') {
    return { ok: false, error: PLAN_REFUSAL };
  }
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid input for ${name}.`,
      issues: zodIssues(parsed.error),
      // the model only had the tool's one line: give it what it needs to call it right
      ...(!FULL_TOOLS.has(name) && refusedUsage(tool, deps)),
    };
  }
  try {
    return await tool.handler(ctx, deps, parsed.data as never);
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/** The tool in full for a refused call; nothing when the live registries can't be read. */
function refusedUsage(tool: AssistantTool<never>, deps: ToolDeps): { usage?: unknown } {
  try {
    return { usage: usageOf(tool, buildNarrowedEnums(deps)) };
  } catch {
    return {};
  }
}

/** A failure in words the model can act on: a Nest HTTP error's own message (a 409 "The run is
 * executing…") rather than "Conflict Exception". */
export function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'getResponse' in error) {
    const response = (error as { getResponse(): unknown }).getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object') {
      const { message, code } = response as { message?: unknown; code?: unknown };
      const text = Array.isArray(message) ? message.join('; ') : message;
      if (typeof text === 'string' && text) return code ? `${text} (${String(code)})` : text;
      return JSON.stringify(response);
    }
  }
  return error instanceof Error ? error.message : String(error);
}
