import type {
  ChannelDto,
  CreateChannelDto,
  BlueprintVersionDto,
  RunDetailDto,
  CapabilityDto,
  ResolveCapabilityResponseDto,
  SaveTemplateDto,
  SaveTimelineDraftDto,
  TimelineEditorSessionDto,
} from '@reefcraft/shared';

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

  listCapabilities: () => request<CapabilityDto[]>('/capabilities'),
  resolveCapability: (key: string, config: Record<string, unknown>) =>
    request<ResolveCapabilityResponseDto>(`/capabilities/${key}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ config }),
    }),

  saveTemplate: (dto: SaveTemplateDto) =>
    request<unknown>('/templates', { method: 'POST', body: JSON.stringify(dto) }),

  listBuiltinTemplates: () =>
    request<Array<{ id: string; name: string; description: string }>>('/templates'),
  instantiateTemplate: (templateId: string, channelId: string, runCapUsd: number) =>
    request<BlueprintVersionDto>(`/templates/${templateId}/instantiate`, {
      method: 'POST',
      body: JSON.stringify({ channelId, runCapUsd }),
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
