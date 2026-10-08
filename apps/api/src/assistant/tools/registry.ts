import { createHash } from 'node:crypto';
import { BUILTIN_CHECKS } from '../../check/builtins/index';
import { GUIDE_TOPICS } from '../guide';
import type { AssistantToolDef } from '../agent/assistant-agent.interface';
import { askUser } from './ask-user';
import { BLUEPRINT_TOOLS } from './blueprint-tools';
import { zodIssues } from './draft-checks';
import { READ_TOOLS } from './read-tools';
import { WRITE_TOOLS } from './write-tools';
import type { AssistantTool, NarrowedEnums, ToolDeps, ToolOutcome, TurnContext } from './types';

export const ASSISTANT_TOOLS: ReadonlyArray<AssistantTool<never>> = [
  ...READ_TOOLS,
  ...BLUEPRINT_TOOLS,
  ...WRITE_TOOLS,
  askUser as unknown as AssistantTool<never>,
];

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
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return { ok: false, error: `Invalid input for ${name}.`, issues: zodIssues(parsed.error) };
  }
  try {
    return await tool.handler(ctx, deps, parsed.data as never);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
