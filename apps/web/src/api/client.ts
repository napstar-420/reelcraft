import type {
  ChannelDto,
  CreateChannelDto,
  BlueprintVersionDto,
  RunDetailDto,
  CapabilityDto,
  SaveTimelineDraftDto,
  TimelineEditorSessionDto,
} from '@reefcraft/shared';

/** Typed against @reefcraft/shared DTOs — the payoff for the shared
 * package: the same shapes the API validates requests against are what
 * the UI compiles against. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listChannels: () => request<ChannelDto[]>('/channels'),
  createChannel: (dto: CreateChannelDto) =>
    request<ChannelDto>('/channels', { method: 'POST', body: JSON.stringify(dto) }),

  listCapabilities: () => request<CapabilityDto[]>('/capabilities'),

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
