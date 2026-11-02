import { createHash } from 'node:crypto';
import { BUILTIN_CHECKS } from '../../check/builtins/index';
import { GUIDE_TOPICS } from '../guide';
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
import { zodIssues } from './draft-checks';
import { READ_TOOLS } from './read-tools';
import { RUN_TOOLS } from './run-tools';
import { WRITE_TOOLS } from './write-tools';
import type { AssistantTool, NarrowedEnums, ToolDeps, ToolOutcome, TurnContext } from './types';

export const ASSISTANT_TOOLS: ReadonlyArray<AssistantTool<never>> = [
  ...CATALOG_TOOLS,
  ...READ_TOOLS,
  ...BLUEPRINT_TOOLS,
  ...RUN_TOOLS,
  ...REVIEW_TOOLS,
  ...MEDIA_TOOLS,
  ...WRITE_TOOLS,
  ...MANAGE_TOOLS,
  ...ACTION_TOOLS,
  ...WATCH_TOOLS,
  ...DOCS_TOOLS,
  askUser as unknown as AssistantTool<never>,
  presentPlan as unknown as AssistantTool<never>,
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

export function buildToolDefs(narrowed: NarrowedEnums): AssistantToolDef[] {
  return ASSISTANT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.jsonSchema(narrowed),
  }));
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
    return { ok: false, error: `Invalid input for ${name}.`, issues: zodIssues(parsed.error) };
  }
  try {
    return await tool.handler(ctx, deps, parsed.data as never);
  } catch (error) {
    return { ok: false, error: errorText(error) };
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
