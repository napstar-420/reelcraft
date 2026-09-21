import type {
  ChannelDto,
  CreateChannelDto,
  BlueprintVersionDto,
  CreateBlueprintVersionDto,
  RunDetailDto,
  CapabilityDto,
  ResolveCapabilityResponseDto,
  ModelInfoDto,
  SaveTemplateDto,
  SaveTimelineDraftDto,
  TimelineEditorSessionDto,
  CheckDef,
  JsonSchema,
  ValidationIssue,
  AssetDto,
} from '@reefcraft/shared';

/** `blueprint.service.ts#getBlueprint()`'s row shape — the whole `blueprint`
 * table row (Chunk 3, Phase 9.5's binding-picker asset step needs the
 * blueprint's `channelId`, which no existing endpoint exposed). */
export type BlueprintDto = {
  id: string;
  channelId: string;
  name: string;
  currentVersionId: string | null;
  archived: boolean;
};

/** `template.service.ts#list()`'s row shape: every builtin plus the
 * caller's own `source: 'user'` templates, each with its latest version's
 * `requires`. */
export type TemplateListItem = {
  id: string;
  ownerId: string;
  source: 'builtin' | 'user';
  kind: string;
  name: string;
  description: string;
  tags: string[];
  archived: boolean;
  requires: { capabilities: string[]; inputs: unknown[] };
};

export type TemplateVersionDto = {
  id: string;
  templateId: string;
  version: number;
  body: unknown;
  requires: { capabilities: string[]; inputs: unknown[] };
  createdAt: string;
};

/** `template.service.ts#instantiate()` branches on the template's own
 * `kind` (loaded server-side): `blueprint` creates a real blueprint version
 * and returns it plus `requires`; the other three kinds return the inlined
 * `body` with no DB write. */
export type InstantiateTemplateResult =
  | (BlueprintVersionDto & { requires: { capabilities: string[]; inputs: unknown[] } })
  | { body: unknown; requires: { capabilities: string[]; inputs: unknown[] } };

/** `check.controller.ts#listCheckTypes()`'s row shape — no shared DTO
 * exists for this response. */
export type CheckTypeDto =
  | { key: string; kind: 'builtin'; paramsSchema?: JsonSchema; description: string }
  | { key: 'script'; kind: 'script'; description: string };

/** `check.types.ts`'s `CheckResult` — internal to `apps/api`, not exported
 * from `@reefcraft/shared`. */
export type CheckResultDto = {
  name: string;
  kind: 'schema' | 'builtin' | 'script';
  pass: boolean;
  message?: string;
  details?: unknown;
  fault?: 'artifact' | 'authoring';
};

/** Thrown by `request()` on any non-2xx response. `issues` carries the
 * parsed JSON error body when there is one — Nest wraps an array thrown
 * via `BadRequestException(arr)` as `{message: arr, ...}`, so `issues` is
 * that array when present, else the raw parsed body. A strict superset of
 * the old plain-`Error` behavior: existing callers reading `.message`
 * still see the same string. */
export class ApiError extends Error {
  status: number;
  issues?: unknown;
  constructor(message: string, status: number, issues?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

/** Typed against @reefcraft/shared DTOs — the payoff for the shared
 * package: the same shapes the API validates requests against are what
 * the UI compiles against. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    let issues: unknown;
    try {
      const body = await res.json();
      issues = Array.isArray(body?.message) ? body.message : body;
    } catch {
      // Non-JSON or empty error body — issues stays undefined.
    }
    throw new ApiError(
      `${init?.method ?? 'GET'} ${path} failed: ${res.status}`,
      res.status,
      issues,
    );
  }
  return res.json() as Promise<T>;
}

export const api = {
  listChannels: () => request<ChannelDto[]>('/channels'),
  createChannel: (dto: CreateChannelDto) =>
    request<ChannelDto>('/channels', { method: 'POST', body: JSON.stringify(dto) }),

  createBlueprint: (channelId: string, name: string) =>
    request<{ blueprintId: string }>('/blueprints', {
      method: 'POST',
      body: JSON.stringify({ channelId, name }),
    }),
  getBlueprint: (blueprintId: string) => request<BlueprintDto>(`/blueprints/${blueprintId}`),
  createBlueprintVersion: (blueprintId: string, dto: CreateBlueprintVersionDto) =>
    request<BlueprintVersionDto>(`/blueprints/${blueprintId}/versions`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  listBlueprintVersions: (blueprintId: string) =>
    request<BlueprintVersionDto[]>(`/blueprints/${blueprintId}/versions`),
  validateBlueprint: (blueprintId: string, dto: CreateBlueprintVersionDto) =>
    request<{ issues: ValidationIssue[]; runnable: boolean }>(
      `/blueprints/${blueprintId}/validate`,
      { method: 'POST', body: JSON.stringify(dto) },
    ),

  listChannelAssets: (channelId: string) => request<AssetDto[]>(`/channels/${channelId}/assets`),

  listCapabilities: () => request<CapabilityDto[]>('/capabilities'),
  resolveCapability: (key: string, config: Record<string, unknown>) =>
    request<ResolveCapabilityResponseDto>(`/capabilities/${key}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ config }),
    }),

  listProviders: () => request<string[]>('/providers'),
  listModelsForProvider: (providerId: string) =>
    request<ModelInfoDto[]>(`/providers/${providerId}/models`),

  saveTemplate: (dto: SaveTemplateDto) =>
    request<unknown>('/templates', { method: 'POST', body: JSON.stringify(dto) }),

  listTemplates: () => request<TemplateListItem[]>('/templates'),
  listTemplateVersions: (templateId: string) =>
    request<TemplateVersionDto[]>(`/templates/${templateId}/versions`),
  instantiateTemplate: (templateId: string, channelId?: string, runCapUsd?: number) =>
    request<InstantiateTemplateResult>(`/templates/${templateId}/instantiate`, {
      method: 'POST',
      body: JSON.stringify({ channelId, runCapUsd }),
    }),

  listCheckTypes: () => request<CheckTypeDto[]>('/check-types'),
  testCheck: (check: CheckDef, artifactId: string) =>
    request<CheckResultDto>('/checks/test', {
      method: 'POST',
      body: JSON.stringify({ check, artifactId }),
    }),

  startDryRun: (blueprintId: string, version: number, budgetCapUsd?: number) =>
    request<RunDetailDto>(`/blueprints/${blueprintId}/versions/${version}/dry-run`, {
      method: 'POST',
      body: JSON.stringify(budgetCapUsd !== undefined ? { budgetCapUsd } : {}),
    }),

  listRuns: () => request<RunDetailDto[]>('/runs'),
  getRun: (id: string) => request<RunDetailDto>(`/runs/${id}`),
  getTimelineEditor: (runId: string, stageKey: string) =>
    request<TimelineEditorSessionDto>(`/runs/${runId}/stages/${stageKey}/timeline-editor`),
  saveTimelineDraft: (runId: string, stageKey: string, dto: SaveTimelineDraftDto) =>
    request<{ draftRevision: number }>(`/runs/${runId}/stages/${stageKey}/timeline-editor/draft`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),
  submitTimelineDraft: (runId: string, stageKey: string, draftRevision: number) =>
    request(`/runs/${runId}/stages/${stageKey}/timeline-editor/submit`, {
      method: 'POST',
      body: JSON.stringify({ draftRevision }),
    }),
  startRun: (params: { channelId: string; blueprintVersionId: string; budgetCapUsd: number }) =>
    request<RunDetailDto>('/runs', {
      method: 'POST',
      body: JSON.stringify({ ...params, inputs: {}, roleBindings: {} }),
    }),
};
