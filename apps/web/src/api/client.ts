import type {
  ChannelDto,
  CreateChannelDto,
  BlueprintVersionDto,
  RunDetailDto,
  CapabilityDto,
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

  listBuiltinTemplates: () => request<Array<{ id: string; name: string; description: string }>>('/templates'),
  instantiateTemplate: (templateId: string, channelId: string, runCapUsd: number) =>
    request<BlueprintVersionDto>(`/templates/${templateId}/instantiate`, {
      method: 'POST',
      body: JSON.stringify({ channelId, runCapUsd }),
    }),

  listRuns: () => request<RunDetailDto[]>('/runs'),
  getRun: (id: string) => request<RunDetailDto>(`/runs/${id}`),
  startRun: (params: { channelId: string; blueprintVersionId: string; budgetCapUsd: number }) =>
    request<RunDetailDto>('/runs', {
      method: 'POST',
      body: JSON.stringify({ ...params, inputs: {}, roleBindings: {} }),
    }),
};
