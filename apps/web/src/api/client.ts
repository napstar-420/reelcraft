import type {
  ListNotificationsResultDto,
  PushSubscriptionDto,
  VapidKeyDto,
  PronunciationDictionaryListDto,
  SpeechPreviewDto,
  SpeechPreviewRequestDto,
  VoiceListDto,
  VoiceQueryDto,
  AssistantItemDto,
  AssistantProviderDto,
  AssistantSessionDetailDto,
  AssistantSessionDto,
  CreateAssistantSessionDto,
  StartAssistantTurnDto,
  UpdateAssistantSessionDto,
  BrowserOsSettingsDto,
  CodexLoginDto,
  CodexStatusDto,
  ConnectionTestDto,
  CancelPackageUploadDto,
  ExportPackageDto,
  InspectPackageDto,
  InstallPackageDto,
  InstallPackageResultDto,
  PackageInspectReportDto,
  PackageUploadDto,
  PackageExportPreviewDto,
  PackageIdentityBackupDto,
  PackageIdentityDto,
  PackageIdentityStatusDto,
  ProviderKeyId,
  ProviderKeyStatusDto,
  TrustedAuthorDto,
  SettingsDto,
  ChannelDto,
  CreateChannelDto,
  UpdateChannelDto,
  BlueprintVersionDto,
  CreateBlueprintVersionDto,
  VersionBump,
  RunDetailDto,
  RunMemoryDto,
  CapabilityDto,
  FlowAccountsDto,
  ResolveCapabilityResponseDto,
  ModelInfoDto,
  SaveTimelineDraftDto,
  TimelineEditorSessionDto,
  CheckDef,
  JsonSchema,
  ValidationIssue,
  AssetDto,
  CharacterDto,
  CreateCharacterDto,
  UpdateCharacterDto,
  ConfirmCharacterReferenceDto,
  UpdateCharacterReferenceDto,
  RequestAssetUploadResultDto,
  CreateAssetDto,
  CreateRunDto,
  AttachInputDto,
  RequestInputUploadResultDto,
  RunInputStatusDto,
  ApprovalCandidateDto,
  StageOutputDto,
  StageEventDto,
  ApprovalActionDto,
  RunState,
  ListRunsResultDto,
  ConfirmRunActionDto,
  RetryScope,
  InvalidationPreviewDto,
  HumanInputSubmissionDto,
  StageAttemptDto,
  BlueprintDto,
  UpdateBlueprintDto,
  UpdateStatusDto,
} from '@reelcraft/shared';

/** `check.controller.ts#listCheckTypes()`'s row shape — no shared DTO
 * exists for this response. */
export type CheckTypeDto =
  | { key: string; kind: 'builtin'; paramsSchema?: JsonSchema; description: string }
  | { key: 'script'; kind: 'script'; description: string };

/** `check.types.ts`'s `CheckResult` — internal to `apps/api`, not exported
 * from `@reelcraft/shared`. */
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

/** Typed against @reelcraft/shared DTOs — the payoff for the shared
 * package: the same shapes the API validates requests against are what
 * the UI compiles against. */
async function failFrom(res: Response, method: string, path: string): Promise<never> {
  let issues: unknown;
  try {
    const body = await res.json();
    issues = Array.isArray(body?.message) ? body.message : body;
  } catch {
    // Non-JSON or empty error body — issues stays undefined.
  }
  throw new ApiError(`${method} ${path} failed: ${res.status}`, res.status, issues);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) return failFrom(res, init?.method ?? 'GET', path);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A POST whose response is a file: the bytes and the name the server gave it. */
async function requestFile(path: string, body: unknown): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return failFrom(res, 'POST', path);
  const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1];
  return { blob: await res.blob(), filename: filename ?? 'download' };
}

export const api = {
  listNotifications: () => request<ListNotificationsResultDto>('/notifications'),
  markNotificationRead: (id: string) =>
    request<void>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request<void>('/notifications/read-all', { method: 'POST' }),
  getVapidPublicKey: () => request<VapidKeyDto>('/push/vapid-public-key'),
  savePushSubscription: (dto: PushSubscriptionDto) =>
    request<void>('/push/subscription', { method: 'PUT', body: JSON.stringify(dto) }),
  deletePushSubscription: (endpoint: string) =>
    request<void>('/push/subscription', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  listChannels: (params?: { includeArchived?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.includeArchived) qs.set('includeArchived', 'true');
    const suffix = qs.toString();
    return request<ChannelDto[]>(`/channels${suffix ? `?${suffix}` : ''}`);
  },
  createChannel: (dto: CreateChannelDto) =>
    request<ChannelDto>('/channels', { method: 'POST', body: JSON.stringify(dto) }),
  getChannel: (id: string) => request<ChannelDto>(`/channels/${id}`),
  updateChannel: (id: string, dto: UpdateChannelDto) =>
    request<ChannelDto>(`/channels/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  archiveChannel: (id: string, archived: boolean) =>
    request<ChannelDto>(`/channels/${id}/archive`, {
      method: 'PATCH',
      body: JSON.stringify({ archived }),
    }),
  deleteChannel: (id: string) => request<void>(`/channels/${id}`, { method: 'DELETE' }),

  createBlueprint: (channelId: string, name: string) =>
    request<{ blueprintId: string }>('/blueprints', {
      method: 'POST',
      body: JSON.stringify({ channelId, name }),
    }),
  getBlueprint: (blueprintId: string) => request<BlueprintDto>(`/blueprints/${blueprintId}`),
  deleteBlueprint: (blueprintId: string) =>
    request<void>(`/blueprints/${blueprintId}`, { method: 'DELETE' }),
  updateBlueprint: (blueprintId: string, dto: UpdateBlueprintDto) =>
    request<BlueprintDto>(`/blueprints/${blueprintId}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  listBlueprints: (channelId: string) =>
    request<BlueprintDto[]>(`/blueprints?channelId=${encodeURIComponent(channelId)}`),
  createBlueprintVersion: (
    blueprintId: string,
    dto: CreateBlueprintVersionDto,
    bump: VersionBump = 'minor',
    /** The saved version `dto` was edited from (`null`: none yet). The save is refused (409)
     * if another save has replaced it since. */
    base?: string | null,
  ) =>
    request<BlueprintVersionDto>(
      `/blueprints/${blueprintId}/versions?bump=${bump}${
        base === undefined ? '' : `&base=${encodeURIComponent(base ?? '')}`
      }`,
      { method: 'POST', body: JSON.stringify(dto) },
    ),
  createDraftVersion: (blueprintId: string, dto: CreateBlueprintVersionDto) =>
    request<BlueprintVersionDto>(`/blueprints/${blueprintId}/versions/draft`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  /** `baseVersionId`: the saved version the draft was edited from (`null`: none yet).
   * Refused (409) if another save has replaced it, so a stale tab can't put an old
   * graph over a newer save. */
  setWorkingDraft: (
    blueprintId: string,
    workingDraft: CreateBlueprintVersionDto | null,
    baseVersionId: string | null,
  ) =>
    request<BlueprintDto>(`/blueprints/${blueprintId}/working-draft`, {
      method: 'PUT',
      body: JSON.stringify({ workingDraft, baseVersionId }),
    }),
  listBlueprintVersions: (blueprintId: string) =>
    request<BlueprintVersionDto[]>(`/blueprints/${blueprintId}/versions`),
  validateBlueprint: (blueprintId: string, dto: CreateBlueprintVersionDto) =>
    request<{ issues: ValidationIssue[]; runnable: boolean }>(
      `/blueprints/${blueprintId}/validate`,
      { method: 'POST', body: JSON.stringify(dto) },
    ),

  listChannelAssets: (channelId: string) => request<AssetDto[]>(`/channels/${channelId}/assets`),
  requestAssetUpload: (channelId: string, ext: string) =>
    request<RequestAssetUploadResultDto>(`/channels/${channelId}/assets/upload`, {
      method: 'POST',
      body: JSON.stringify({ ext }),
    }),
  createAsset: (channelId: string, dto: CreateAssetDto) =>
    request<AssetDto>(`/channels/${channelId}/assets`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  deleteAsset: (id: string) => request<void>(`/assets/${id}`, { method: 'DELETE' }),

  listChannelCharacters: (channelId: string) =>
    request<CharacterDto[]>(`/channels/${channelId}/characters`),
  getCharacter: (id: string) => request<CharacterDto>(`/characters/${id}`),
  createCharacter: (channelId: string, dto: CreateCharacterDto) =>
    request<CharacterDto>(`/channels/${channelId}/characters`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  updateCharacter: (id: string, dto: UpdateCharacterDto) =>
    request<CharacterDto>(`/characters/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  requestCharacterReferenceUpload: (characterId: string, ext: string) =>
    request<{ blobId: string; objectKey: string; uploadUrl: string; ext: string }>(
      `/characters/${characterId}/references/upload`,
      { method: 'POST', body: JSON.stringify({ ext }) },
    ),
  confirmCharacterReference: (characterId: string, dto: ConfirmCharacterReferenceDto) =>
    request<CharacterDto>(`/characters/${characterId}/references`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  updateCharacterReference: (
    characterId: string,
    blobId: string,
    dto: UpdateCharacterReferenceDto,
  ) =>
    request<CharacterDto>(`/characters/${characterId}/references/${blobId}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  deleteCharacter: (id: string) => request<void>(`/characters/${id}`, { method: 'DELETE' }),
  deleteCharacterReference: (characterId: string, blobId: string) =>
    request<void>(`/characters/${characterId}/references/${blobId}`, { method: 'DELETE' }),
  setPrimaryCharacterReference: (characterId: string, blobId: string) =>
    request<CharacterDto>(`/characters/${characterId}/primary-reference`, {
      method: 'PUT',
      body: JSON.stringify({ blobId }),
    }),

  listCapabilities: () => request<CapabilityDto[]>('/capabilities'),
  flowAccounts: () => request<FlowAccountsDto>('/flow/accounts'),
  resolveCapability: (key: string, config: Record<string, unknown>) =>
    request<ResolveCapabilityResponseDto>(`/capabilities/${key}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ config }),
    }),

  listProviders: (modality?: string) =>
    request<string[]>(
      modality ? `/providers?modality=${encodeURIComponent(modality)}` : '/providers',
    ),
  listModelsForProvider: (providerId: string) =>
    request<ModelInfoDto[]>(`/providers/${providerId}/models`),
  listVoices: (providerId: string, query: VoiceQueryDto = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return request<VoiceListDto>(`/providers/${providerId}/voices${qs ? `?${qs}` : ''}`);
  },
  previewSpeech: (providerId: string, dto: SpeechPreviewRequestDto) =>
    request<SpeechPreviewDto>(`/providers/${providerId}/speech-preview`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  listPronunciationDictionaries: (providerId: string) =>
    request<PronunciationDictionaryListDto>(`/providers/${providerId}/pronunciation-dictionaries`),

  listCheckTypes: () => request<CheckTypeDto[]>('/check-types'),
  testCheck: (check: CheckDef, artifactId: string) =>
    request<CheckResultDto>('/checks/test', {
      method: 'POST',
      body: JSON.stringify({ check, artifactId }),
    }),

  /** `version` is `major.minor`, e.g. "1.5". */
  startDryRun: (blueprintId: string, version: string, budgetCapUsd?: number) =>
    request<RunDetailDto>(`/blueprints/${blueprintId}/versions/${version}/dry-run`, {
      method: 'POST',
      body: JSON.stringify(budgetCapUsd !== undefined ? { budgetCapUsd } : {}),
    }),

  listRuns: (params?: {
    channelId?: string | undefined;
    blueprintId?: string | undefined;
    state?: RunState | undefined;
    includeDryRuns?: boolean;
    includeDrafts?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.channelId) qs.set('channelId', params.channelId);
    if (params?.blueprintId) qs.set('blueprintId', params.blueprintId);
    if (params?.state) qs.set('state', params.state);
    if (params?.includeDryRuns) qs.set('includeDryRuns', 'true');
    if (params?.includeDrafts) qs.set('includeDrafts', 'true');
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const suffix = qs.toString();
    return request<ListRunsResultDto>(`/runs${suffix ? `?${suffix}` : ''}`);
  },
  getRun: (id: string) => request<RunDetailDto>(`/runs/${id}`),
  getRunMemory: (runId: string) => request<RunMemoryDto>(`/runs/${runId}/memory`),
  cancelRun: (runId: string) =>
    request<{ state: 'CANCELLED'; revision: number }>(`/runs/${runId}/cancel`, {
      method: 'POST',
    }),
  pauseRun: (runId: string) => request<RunDetailDto>(`/runs/${runId}/pause`, { method: 'POST' }),
  resumeRun: (runId: string) => request<RunDetailDto>(`/runs/${runId}/resume`, { method: 'POST' }),
  raiseRunBudget: (runId: string, capUsd: number, stageKey?: string) =>
    request<RunDetailDto>(`/runs/${runId}/budget`, {
      method: 'POST',
      body: JSON.stringify({ capUsd, ...(stageKey && { stageKey }) }),
    }),
  previewStageRetry: (
    runId: string,
    stageKey: string,
    { itemIndex, scope }: { itemIndex?: number; scope?: RetryScope } = {},
  ) => {
    const qs = new URLSearchParams();
    if (itemIndex !== undefined) qs.set('itemIndex', String(itemIndex));
    if (scope) qs.set('scope', scope);
    const query = qs.toString();
    return request<InvalidationPreviewDto>(
      `/runs/${runId}/stages/${encodeURIComponent(stageKey)}/retry${query ? `?${query}` : ''}`,
      { method: 'POST' },
    );
  },
  confirmStageRetry: (runId: string, stageKey: string, dto: ConfirmRunActionDto) =>
    request<{ accepted: true; revision: number }>(
      `/runs/${runId}/stages/${encodeURIComponent(stageKey)}/retry/confirm`,
      { method: 'POST', body: JSON.stringify(dto) },
    ),
  listStageAttempts: (runId: string, stageKey: string) =>
    request<StageAttemptDto[]>(`/runs/${runId}/stages/${encodeURIComponent(stageKey)}/attempts`),
  submitHumanInput: (runId: string, stageKey: string, dto: HumanInputSubmissionDto) =>
    request<{ accepted: true; revision: number }>(
      `/runs/${runId}/stages/${encodeURIComponent(stageKey)}/input`,
      { method: 'POST', body: JSON.stringify(dto) },
    ),
  listStageLogs: (runId: string, stageKey: string) =>
    request<StageEventDto[]>(`/runs/${runId}/stages/${encodeURIComponent(stageKey)}/logs`),
  getStageOutput: (runId: string, stageKey: string) =>
    request<StageOutputDto>(`/runs/${runId}/stages/${encodeURIComponent(stageKey)}/output`),
  getApprovalCandidate: (runId: string, stageKey: string, itemIndex?: number) =>
    request<ApprovalCandidateDto>(
      `/runs/${runId}/stages/${encodeURIComponent(stageKey)}/approval-candidate${
        itemIndex === undefined ? '' : `?itemIndex=${itemIndex}`
      }`,
    ),
  approveStage: (runId: string, stageKey: string, itemIndex?: number) =>
    request<{ accepted: true; revision: number }>(
      `/runs/${runId}/stages/${encodeURIComponent(stageKey)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({
          action: 'approve',
          ...(itemIndex !== undefined ? { itemIndex } : {}),
        } satisfies ApprovalActionDto),
      },
    ),
  retryStageQc: (runId: string, stageKey: string, itemIndex?: number) =>
    request<{ accepted: true; revision: number }>(
      `/runs/${runId}/stages/${encodeURIComponent(stageKey)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({
          action: 'retry_qc',
          ...(itemIndex !== undefined ? { itemIndex } : {}),
        } satisfies ApprovalActionDto),
      },
    ),
  previewStageRejection: (runId: string, stageKey: string, note?: string, itemIndex?: number) =>
    request<{
      previewToken: string;
      expiresAt: string;
      targetStageKey: string;
      affectedStageKeys: string[];
      spentUsd: number;
      estimatedRerunUsd: number;
    }>(`/runs/${runId}/stages/${encodeURIComponent(stageKey)}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'reject',
        ...(note !== undefined ? { note } : {}),
        ...(itemIndex !== undefined ? { itemIndex } : {}),
      } satisfies ApprovalActionDto),
    }),
  confirmStageRejection: (
    runId: string,
    stageKey: string,
    previewToken: string,
    note?: string,
    itemIndex?: number,
  ) =>
    request<{ accepted: true; revision: number }>(
      `/runs/${runId}/stages/${encodeURIComponent(stageKey)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({
          action: 'reject',
          previewToken,
          ...(note !== undefined ? { note } : {}),
          ...(itemIndex !== undefined ? { itemIndex } : {}),
        } satisfies ApprovalActionDto),
      },
    ),
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
  createRun: (dto: CreateRunDto) =>
    request<RunDetailDto>('/runs', { method: 'POST', body: JSON.stringify(dto) }),
  requestRunInputUpload: (runId: string, inputKey: string, ext: string) =>
    request<RequestInputUploadResultDto>(
      `/runs/${runId}/inputs/${encodeURIComponent(inputKey)}/upload`,
      { method: 'POST', body: JSON.stringify({ ext }) },
    ),
  attachRunInput: (runId: string, inputKey: string, dto: AttachInputDto) =>
    request<void>(`/runs/${runId}/inputs/${encodeURIComponent(inputKey)}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),
  getRunInputStatus: (runId: string, inputKey: string) =>
    request<RunInputStatusDto>(`/runs/${runId}/inputs/${encodeURIComponent(inputKey)}/status`),
  startRun: (runId: string) => request<RunDetailDto>(`/runs/${runId}/start`, { method: 'POST' }),

  getUpdateStatus: () => request<UpdateStatusDto>('/system/update'),
  checkForUpdate: () => request<UpdateStatusDto>('/system/update/check', { method: 'POST' }),
  installUpdate: (version: string) =>
    request<UpdateStatusDto>('/system/update/install', {
      method: 'POST',
      body: JSON.stringify({ version }),
    }),

  getSettings: () => request<SettingsDto>('/settings'),
  saveProviderKey: (provider: ProviderKeyId, value: string) =>
    request<ProviderKeyStatusDto>(`/settings/keys/${provider}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  deleteProviderKey: (provider: ProviderKeyId) =>
    request<ProviderKeyStatusDto>(`/settings/keys/${provider}`, { method: 'DELETE' }),
  testProviderKey: (provider: ProviderKeyId) =>
    request<ConnectionTestDto>(`/settings/keys/${provider}/test`, { method: 'POST' }),
  saveBrowserOs: (url: string) =>
    request<BrowserOsSettingsDto>('/settings/browser-os', {
      method: 'PUT',
      body: JSON.stringify({ url }),
    }),
  testBrowserOs: (url?: string) =>
    request<ConnectionTestDto>('/settings/browser-os/test', {
      method: 'POST',
      body: JSON.stringify(url ? { url } : {}),
    }),
  getPackagePreview: (versionId: string) =>
    request<PackageExportPreviewDto>(`/blueprint-versions/${versionId}/package/preview`),
  exportPackage: (versionId: string, dto: ExportPackageDto) =>
    requestFile(`/blueprint-versions/${versionId}/package`, dto),

  requestPackageUpload: () => request<PackageUploadDto>('/packages/uploads', { method: 'POST' }),
  cancelPackageUpload: (dto: CancelPackageUploadDto) =>
    request<void>('/packages/uploads/cancel', { method: 'POST', body: JSON.stringify(dto) }),
  inspectPackage: (dto: InspectPackageDto) =>
    request<PackageInspectReportDto>('/packages/inspect', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  installPackage: (dto: InstallPackageDto) =>
    request<InstallPackageResultDto>('/packages/install', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  getIdentity: () => request<PackageIdentityStatusDto>('/identity'),
  backupIdentity: () => request<PackageIdentityBackupDto>('/identity/backup', { method: 'POST' }),
  restoreIdentity: (backup: PackageIdentityBackupDto) =>
    request<PackageIdentityDto>('/identity/restore', {
      method: 'POST',
      body: JSON.stringify(backup),
    }),
  regenerateIdentity: () => request<PackageIdentityDto>('/identity/regenerate', { method: 'POST' }),
  listTrustedAuthors: () => request<TrustedAuthorDto[]>('/identity/trusted'),
  untrustAuthor: (fingerprint: string) =>
    request<void>(`/identity/trusted/${fingerprint}`, { method: 'DELETE' }),
  getCodexStatus: () => request<CodexStatusDto>('/codex/status'),
  getCodexLogin: () => request<{ login: CodexLoginDto | null }>('/codex/login'),
  startCodexLogin: () => request<CodexLoginDto>('/codex/login', { method: 'POST' }),
  cancelCodexLogin: () =>
    request<{ login: CodexLoginDto | null }>('/codex/login', { method: 'DELETE' }),
  codexLogout: () => request<CodexStatusDto>('/codex/logout', { method: 'POST' }),
  listAssistantProviders: () => request<AssistantProviderDto[]>('/assistant/providers'),
  listAssistantSessions: (blueprintId: string) =>
    request<AssistantSessionDto[]>(`/blueprints/${blueprintId}/assistant/sessions`),
  createAssistantSession: (blueprintId: string, dto: CreateAssistantSessionDto) =>
    request<AssistantSessionDto>(`/blueprints/${blueprintId}/assistant/sessions`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  getAssistantSession: (sessionId: string) =>
    request<AssistantSessionDetailDto>(`/assistant/sessions/${sessionId}`),
  updateAssistantSession: (sessionId: string, dto: UpdateAssistantSessionDto) =>
    request<AssistantSessionDto>(`/assistant/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  deleteAssistantSession: (sessionId: string) =>
    request<void>(`/assistant/sessions/${sessionId}`, { method: 'DELETE' }),
  startAssistantTurn: (sessionId: string, dto: StartAssistantTurnDto) =>
    request<{ turnId: string }>(`/assistant/sessions/${sessionId}/turns`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  interruptAssistantTurn: (sessionId: string) =>
    request<void>(`/assistant/sessions/${sessionId}/interrupt`, { method: 'POST' }),
  applyAssistantProposal: (sessionId: string, itemId: string) =>
    request<AssistantItemDto>(`/assistant/sessions/${sessionId}/proposals/${itemId}/apply`, {
      method: 'POST',
    }),
};
