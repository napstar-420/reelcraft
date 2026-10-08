# Plan: Socket.IO live updates + notification system (inbox, toasts, Web Push)

## Context

The web app learns about run progress by polling: `useRun` keeps an SSE stream plus a 3s interval, the runs list polls every 5s, and the stage sheets poll every 3s. Only `RunStateService.transition`/`pauseForQuota` publish to the in-process SSE bus, so most changes are only picked up by those polls: start/claim, pause, cancel, approve, and every stage-level change. Phase 10 in `docs/build-progress.md` already plans the move to Socket.IO.

The user wants three things:

1. **Socket.IO live updates** that replace all run and assistant polling and SSE.
2. **A notification system**: a persisted in-app inbox (bell + toasts) and **Web Push** OS notifications that arrive even with every tab closed. Preferences are kept per browser.
3. **Multi-user-ready design**. There is one implicit user, `'local'`, today. Every per-user path is keyed by a resolved user id through the existing `@Owner()` seam (`apps/api/src/common/owner.decorator.ts`).

Agreed with the user:

- Notify on every meaningful event: started, awaiting approval, awaiting input or timeline edit, paused for budget, paused for quota, auto-resumed after quota, failed, completed, cancelled (off by default), and 24h/48h reminders.
- The assistant chat moves to Socket.IO as well.
- Notification preferences are stored per browser.

## Ground truth (verified)

- One Node process (Nest 10.4/Express) serves the API, the SPA (`system/http-mounts.ts`, whose SPA fallback skips `/api`), `/storage` and `/api/inngest`.
  - There is no reverse proxy, Redis, auth or CORS (ADR-0002).
  - The app bundle ships its own `node_modules` (`Dockerfile:36-38,88,93`, `release.yml:140-150`). New npm dependencies therefore need **no `RUNTIME_VERSION` bump**.
- Gateways only exist after `NestApplication.init()` on a real HTTP app.
  - `test/support/build-app.ts` (TestingModule) has no gateway.
  - `build-http-test-app.ts` (`listen(0)`) has one.
  - **Rule:** services publish to a bus and never call the gateway. The gateway subscribes to the bus in `afterInit`.
- `withLockedRun()` (`run/run-mutation.service.ts`) is the single point every operator mutation passes through. `raiseBudget` (`run.service.ts:580`) and `create()` bypass it.
- `StageEventService.record()` is the stage-level choke point, with these gaps:
  - `failStageExecution` records _before_ it writes state (`stage-runner.service.ts:1720` vs `1729-1738`).
  - `finishIteratingStage` (`:2058`) and `skipStage` record nothing.
- `run.failure` is never written. The failure reason is in `stage_execution.failure`, or `stage_item.failure` for iterating stages, as `{reason}`. It may be null.
- Auto-resume vs manual resume: an automatic resume is the only kind of wakeup with `notBefore !== null`, set only by `pauseForQuota`.
- `human-reminder.service.ts` enqueues `run/attention-reminder` wakeups that nothing consumes.
- The cascade e2e test uses a dry run.

## Design rules

- **Payloads are invalidation hints**, not data. The client invalidates TanStack queries through a 250ms throttle batcher, because `invalidateQueries` cancels in-flight fetches and a burst could starve them. After a reconnect, everything is invalidated.
- **Rooms:** `user:<id>` for all run and notification events. The run owner comes from `run → channel.ownerId`, cached per run. `assistant:<sessionId>` rooms are used only for token deltas.
  - `resolveSocketUser(handshake)` returns `'local'` and is the auth seam for later.
- **Security:** CORS does not apply to WebSockets. An engine.io `allowRequest` same-origin check stops cross-site WebSocket hijacking:
  - No Origin header: allow.
  - Origin `null` or unparseable: reject.
  - Otherwise the Origin host must equal `Host` or `X-Forwarded-Host`.
  - In dev, the Vite `/api/socket.io` proxy entry uses `changeOrigin:false` so the check passes.
- **Multiple replicas (≠ multiple users):** the in-process bus stays. Fan-out across replicas would later need `@socket.io/postgres-adapter`. This is recorded in the ADR as the new §21.2 swap point.
- **Notifications never block a run:**
  - Inserts that happen inside a run transaction (claim, cancel) run in a savepoint (`tx.transaction(...)`), and its error is caught and logged.
  - Orchestrator notify steps use `.catch` like `extract-poster`.
  - Push delivery is `void`, so the run never waits on it.
- **Exactly-once:** a `dedupe_key` unique index with `ON CONFLICT DO NOTHING`. Delivery (socket and push) happens only when a row was actually inserted. New Inngest steps are appended right before a `return`, so replay is safe for in-flight runs after an in-app update.
- **Dry runs** never notify (they are fake-provider tests). **Canvas/draft runs** do notify, since they spend real money. Live updates work for all runs.

## PR 1: `feat/live-updates-socketio`, live run updates

**Dependencies**

- api: `@nestjs/websockets@^10.4.15`, `@nestjs/platform-socket.io@^10.4.15`, `socket.io@^4.8`. Dev dependency: `socket.io-client`.
- web: `socket.io-client@^4.8`.

**Shared:** `packages/shared/src/dto/live.dto.ts` holds the types-only `ServerToClientEvents` (`run:updated {runId}`, `stage:updated {runId, stageKey}`) and `ClientToServerEvents`. Export it from `dto/index.ts`.

**API**

- New `apps/api/src/live/`:
  - `live-events.ts`: the `LiveEvents` bus with `publish`/`all()`. It replaces `orchestration/run-events.ts`, which is deleted; keep the §21.2 note.
  - `same-origin.ts`: `isSameOrigin`/`sameOriginOnly`.
  - `live.gateway.ts`:
    - `@WebSocketGateway({ path: '/api/socket.io', serveClient: false, allowRequest })`.
    - Joins `user:<id>` on connect.
    - `afterInit` subscribes with `void route(e).catch(log)`; a thrown subscriber error in RxJS 7 would crash the process.
    - Skips the work when `clientsCount === 0`.
  - `live.module.ts`: imports `DbModule` and exports `LiveEvents`. Add it to `AppModule`, `OrchestrationModule` and `RunModule`. `CapabilityModule` must never import it.
- Publish after commit in:
  - `RunStateService.transition`/`pauseForQuota`/`skipStage` (the last one as a stage event).
  - `withLockedRun` (after the transaction resolves).
  - `RunWakeupClaimService.claim()` when the run was claimed.
  - The end of `RunCancellationService.cancel()`, after `settleOutstanding`.
  - `RunService.create()` and `raiseBudget`.
  - `StageEventService.record()` (stage event).
  - `stage-runner.service.ts`: move the `record()` in `failStageExecution` to after the state write, and add a publish at the end of `finishIteratingStage`.
- Delete the `@Sse(':id/events')` endpoint in `run.controller.ts:256-260` and the `QUIET_PATHS` entry in `logging.module.ts:10`, plus its test lines.

**Web**

- `lib/socket.ts`: a module-level typed singleton `io({ path: '/api/socket.io' })`. This makes it StrictMode-safe.
- `lib/live-invalidation.logic.ts` and its test:
  - `queryKeysFor(event)`:
    - run events invalidate `['run', id]` and `['runs']`.
    - stage events also invalidate `stage-output|stage-attempts|stage-logs|approval-candidate` for that run and stage.
    - **Never** invalidate `run-reused-stages`, which would cost N requests per event.
  - `createInvalidationBatcher`.
- `hooks/useLiveUpdates.ts`, mounted in `App.tsx` at the root rather than in AppShell, because the timeline editor has no shell. It wires the listeners and invalidates everything on reconnect.
- Remove polling and SSE:
  - `useRun.ts:15-29`
  - `RunsPage.tsx:101`
  - `stage-output-sheet.tsx:35` (keep the `stageRunning` prop, which the empty-state text uses)
  - `stage-attempts-sheet.tsx:36,41,47`, together with its `stageRunning` prop and callers (`RunPage.tsx:169`, `canvas-run-sheets.tsx:61`)
- Keep the polling in `use-update-status.ts` (the API restarts during an update) and `codex-card.tsx` (a short-lived login).
- `vite.config.ts`: add `'/api/socket.io': { target, ws: true, changeOrigin: false }` **before** `'/api'`.

**Tests**

- `live/same-origin.test.ts`.
- `live/live.gateway.test.ts`: routing to the room; a failed owner lookup does not throw.
- Publish assertions in the existing `run-state`, `run-mutation`, `run-wakeup-claim` and `run-cancellation` service tests.
- `test/e2e/live-updates.e2e.test.ts` using `buildHttpTestApp` and `socket.io-client`:
  - `POST /runs` produces `run:updated`.
  - An `origin: http://evil.test` connection gets `connect_error`.

**Docs**

- `docs/adr/0010-live-updates-over-socket-io.md`, plus a row in the ADR README.
- `docs/build-progress.md` Phase 10 row: in progress, with the plan and PR.

## PR 2: `feat/notification-inbox`, inbox, bell and toasts

**Shared:** `dto/notification.dto.ts` defines:

- `NotificationKind`: `run_started`, `awaiting_approval`, `awaiting_input`, `paused_budget`, `paused_quota`, `auto_resumed`, `failed`, `completed`, `cancelled`, `reminder`.
- `NotificationDto {id, kind, runId, stageKey|null, title, body, url, readAt|null, createdAt}`.
- `ListNotificationsResultDto {items, unreadCount}`.

Extend `ServerToClientEvents` with `notification:created` and `notifications:changed`.

**Schema:** `db/schema/notification.ts`, re-exported from `index.ts`, migration **0030** via `pnpm db:generate`:

- Columns:
  - `id` (ULID primary key)
  - `recipient_id` (default `'local'`)
  - `kind` (text)
  - `run_id` (FK to `run`, not null)
  - `stage_key`, `title`, `body`
  - `url`: computed on the server, so the bell, toasts and the service worker share one link
  - `dedupe_key` (unique)
  - `read_at`, `created_at`
- Index on `(recipient_id, created_at)`.
- **Cascade:** in `run/run-cascade.ts`, delete `notification` rows by `runId` before the `run` delete. In `channel-delete-cascade.e2e.test.ts`, insert a notification row for the dry run directly in both the channel and the blueprint case, and assert it is gone.

**API:** `apps/api/src/notification/`

- `notification-text.ts` (pure, with a test): `describeRunNotification(kind, ctx)` returns `{title, body, url}`.
  - Context is the blueprint and channel name plus the stage label.
  - URLs:
    - approval: `/runs/:id?review=<key>`
    - form input: `/runs/:id?input=<key>`
    - timeline edit: `/runs/:id/stages/:key/edit`
    - everything else: `/runs/:id`
  - The failure reason is truncated to 200 characters.
- `notification.service.ts`:
  - `insertForRun(dbOrTx, {runId, kind, dedupeKey, stageKey?, waitKind?, hours?})`:
    - One join loads the context.
    - Returns null for dry runs.
    - `onConflictDoNothing().returning()`.
  - `deliver(row)` publishes to the bus and never throws.
  - `notifyRun` = insert + deliver.
  - `list` returns the latest 50 plus the unread count. `markRead` and `markAllRead` publish `notifications_changed`.
- `notification.controller.ts`, all using `@Owner()`: `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`.
- `notification.module.ts` imports `DbModule` and `LiveModule`, and exports the service. It is imported by `RunModule` and `AppModule`, and never imports `RunModule`.
- The gateway routes `notification`/`notifications_changed` to `user:<recipientId>`.

**Creation points**

- `run-orchestrate.fn.ts`:
  - Inject `notifications`, passed from `functions/index.ts:42-49`.
  - Add a `notify(kind, stageKey?)` helper: `step.run('notify-<kind>')` with dedupe key `${kind}:${data.wakeupId ?? ctx.runId}`, wrapped in `.catch`.
  - Append it before each `return` for budget, quota, approval, input, failed and completed.
  - `pauseForQuota` now returns `boolean`, and the quota notification fires only when it is true.
- `run-wakeup-claim.service.ts`:
  - Inside `claimInTransaction`, in a savepoint: `run_started` when `action==='start'`, and `auto_resumed` when `action==='resume' && sourceState==='PAUSED_QUOTA' && notBefore!==null`. The dedupe key is the wakeup id.
  - `claim()` delivers after commit.
- `run-cancellation.service.ts`: inside the `withLockedRun` callback, in a savepoint, insert `cancelled` with dedupe key `cancelled:${runId}`. Deliver after `cancel()` finishes.
- `human-reminder.service.ts`:
  - Replace the dead `run_wakeup` insert and the dispatch loop with `insertForRun(tx, {kind:'reminder', dedupeKey: reminder:${waitId}:${threshold}})`, inside the existing `FOR UPDATE` transaction, then call `deliver`.
  - Drop the `RunWakeupDispatcher` dependency and update the comment in `db/schema/run-wakeup.ts`.
  - Fix the candidate query: filter to waits that still need a reminder and order by `waitingSince`. Today a `LIMIT 100` with no filter can starve waits.

**Web**

- `api/client.ts`: add `listNotifications`, `markNotificationRead` and `markAllNotificationsRead`.
- `lib/notification-prefs.ts`, the same pattern as `assistant-prefs.ts`, key `reelcraft.notifications`:
  - Shape `{push?, kinds?}`.
  - Labels are typed `satisfies Record<NotificationKind,string>`.
  - Every kind defaults to on except `cancelled`.
- `components/notifications/notifications.logic.ts` and its test: `shouldToast({kind, prefs, visible, pushActive})` and `unreadLabel` (shows 99+).
- `components/notifications/notification-bell.tsx`:
  - Popover + ScrollArea + Badge.
  - "Mark all as read".
  - Clicking an item marks it read and navigates to its `url`.
  - Mounted in `app-shell.tsx` before `ModeToggle`.
- `useLiveUpdates`: on `notification:created`, invalidate `['notifications']` and show a sonner toast with an "Open" action if `shouldToast`. On `notifications:changed`, invalidate.
- `RunPage.tsx`:
  - Read `?review=` into `reviewStageKey` (the existing `isApprovalStillOpen` guard covers it).
  - Read `?input=` into `formInputStageKey`, guarded by `PAUSED_INPUT` and the stage being `awaiting_input`.
  - Clear the param with `replace:true`.
- `components/settings/notifications-card.tsx`: a "Notifications" card with one switch per kind, placed before `AboutCard`. It links to `docsUrl('runs/notifications')`.

**Tests:** `notification-text.test.ts` and `test/e2e/notifications.e2e.test.ts`:

- Each orchestrate outcome goes through `InngestTestEngine` and produces exactly one row.
- Inserting twice with the same key leaves one row.
- start + claim gives `run_started`.
- A quota auto-resume gives `auto_resumed`; a manual resume does not.
- Cancel gives `cancelled`.
- Sweeping twice gives one reminder.
- A dry run gives no rows.
- The list, read and read-all endpoints work.

Plus the cascade e2e and the web logic tests.

**Docs:**

- New `apps/docs/docs/runs/notifications.md`, added to `sidebars.ts` after the runs pages.
- Update the reminders section of `when-a-run-needs-you.md` using the exact UI labels.

## PR 3: `feat/web-push`, browser push notifications

**Dependencies:** `web-push@^3.6` and `@types/web-push` in api.

**Shared:**

- `PushSubscriptionDto {endpoint: url starting with https:// (SSRF guard), keys {p256dh, auth}, kinds: NotificationKind[]}`.
- `DeletePushSubscriptionDto {endpoint}`.
- `VapidKeyDto {publicKey}`.

**Schema:** `db/schema/push-subscription.ts`, migration **0031**:

- Columns: `endpoint` (primary key), `recipient_id`, `p256dh`, `auth`, `kinds` (jsonb), `created_at`, `updated_at`.
- It has no FK into the run graph, so it is not part of the cascade.

**API:**

- Add `SETTING.vapidPublicKey` and `vapidPrivateKey`; the private key is stored with `setSecret`.
- `notification/push.service.ts`:
  - `publicKey()`:
    - Create-once, the same pattern as `IdentityService.createOnce` (`identity.service.ts:116-133`).
    - If the keys are missing or unreadable, regenerate both **and delete every subscription**.
  - `upsert` and `remove`.
  - `send(row)`:
    - Selects the recipient's subscriptions and filters them by `kinds`.
    - Calls `webpush.sendNotification` with `{id, title, body, url}` and TTL 86400.
    - A 404/410 response deletes the subscription; any other error is logged as a warning.
  - `deliver` calls `void push.send(row)`.
  - VAPID subject: the constant `https://github.com/napstar-420/reelcraft` (Apple rejects localhost), with a `ponytail:` note that it could become an env var.
  - `NotificationModule` imports `SettingsModule`.
- Endpoints: `GET /push/vapid-public-key`, `PUT /push/subscription`, `DELETE /push/subscription`.

**Web:**

- `apps/web/public/sw.js`, plain JS; it lands at `/sw.js` in both dev and `dist`, and `express.static` serves it before the SPA fallback:
  - `install`: `skipWaiting`. `activate`: `clients.claim`.
  - `push`: parse the payload in a try/catch with a generic fallback, then **always** `showNotification(title, {body, tag:id, data:{id,url}})`. Safari revokes permission for silent pushes.
  - `notificationclick`:
    - POST to `/notifications/:id/read`.
    - If a window is open, focus it and `postMessage({type:'reelcraft:navigate', url})`.
    - Otherwise `openWindow(url)`.
  - No `fetch` handler, so the worker never intercepts `/api` or `/storage`.
- `lib/push.logic.ts` and its test: `urlBase64ToUint8Array` and `sameKey`.
- `lib/push.ts`:
  - `pushSupport()` returns one of `unsupported`, `insecure`, `denied` or `ready`.
  - `enablePush(kinds)` runs from the switch click: request permission, register `/sw.js`, `subscribe({userVisibleOnly})`, then `PUT`.
  - `disablePush()`.
  - `syncPush(kinds)` runs on each app load while push is enabled. If the subscription is missing or uses a different key, it resubscribes, then it `PUT`s. This also covers VAPID rotation.
- Notifications card:
  - A "Browser notifications" switch.
  - An "insecure" state that tells the user to open Reelcraft at `http://localhost:8080` or over HTTPS, plus a "denied" state.
  - Changing a kind re-runs `syncPush`.
- `useLiveUpdates`:
  - Listens for the service worker's `message` and calls `navigate(url)`.
  - Toasts only when push is **not** active, so each browser gets exactly one alert.

**Tests:**

- `push.service.test.ts` (`vi.mock('web-push')`): 410 prunes, kinds filter, key created once.
- e2e: the VAPID key stays stable across an app restart on the same DB; PUT/DELETE round-trip.
- `push.logic.test.ts`.

**Docs:**

- A "Browser notifications" section in `notifications.md`:
  - It works at localhost and over HTTPS, but not at a plain-HTTP LAN address.
  - It needs outbound internet.
  - iOS needs a Home Screen install, which is not supported yet.
- `docs/adr/0011-notifications-inbox-and-web-push.md`, plus a row in the ADR README.

## PR 4: `feat/assistant-socketio`, assistant chat over Socket.IO

- Add `{type:'assistant', sessionId, event: AssistantStreamEvent}` to `LiveEvent`.
- `AssistantService` publishes to `LiveEvents`.
- Delete `assistant-events.ts`, `streamEvents`, and the `@Sse` handler in `assistant.controller.ts:73-76`.
- Gateway:
  - `@SubscribeMessage('assistant:watch' | 'assistant:unwatch')` validates `typeof sid==='string' && sid.length<=64`, then joins or leaves `assistant:<sid>`. This is the future ownership-check hook.
  - Emits `assistant:event` to that room.
- `useAssistant.ts`:
  - On every `connect`, emit `watch` and invalidate the session; rooms are lost when the socket reconnects.
  - Apply events with `setQueryData`.
  - Emit `unwatch` on cleanup.
  - Delete the 3s `refetchInterval` and `api.assistantEventsUrl`.
- Rewrite the SSE section of `assistant.e2e.test.ts` (`~705-744`) to use `socket.io-client`.
- Mark Phase 10 done in `docs/build-progress.md`.

## Risks / edge cases

| Risk                                                                                                                      | Mitigation                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inngest replay, and in-flight runs during an in-app update                                                                | Dedupe key; deliver only after a real insert. New steps go right before `return`. Claim-time inserts sit inside the already-memoized claim step.         |
| A notification bug blocks a run                                                                                           | Savepoint + catch inside the run transaction; `.catch` on notify steps; push is fire-and-forget.                                                         |
| Cross-site WebSocket hijack (CORS is off)                                                                                 | `allowRequest` same-origin check, covered by an e2e test.                                                                                                |
| A reverse proxy that rewrites Host without X-Forwarded-Host                                                               | The connection is rejected. No proxy is supported (ADR-0002), so this is documented only.                                                                |
| Reconnect after the API restarts                                                                                          | Socket.IO backoff reconnects, then every query is invalidated.                                                                                           |
| Multiple tabs                                                                                                             | Each tab has its own socket in the user room. Toasts show only in visible tabs, and only when push is off. `notifications:changed` keeps badges in sync. |
| StrictMode double mount                                                                                                   | The socket is a module singleton; effects only add and remove listeners.                                                                                 |
| Plain-HTTP LAN address                                                                                                    | No service worker or push. Bell, toasts and live updates still work, and the card explains why.                                                          |
| No outbound network                                                                                                       | Push failure is logged; the inbox stays the source of truth.                                                                                             |
| VAPID keys lost                                                                                                           | Regenerate, wipe subscriptions; clients resync on their next load.                                                                                       |
| Inngest function crashes before transitioning                                                                             | The run stays RUNNING and nothing is notified. This needs an `onFailure` handler, which is out of scope and noted.                                       |
| Retention                                                                                                                 | No pruning (a handful of rows per run; the list returns 50). A `ponytail:` note: prune read rows older than 90 days if the table grows.                  |
| Lib behaviour not readable here: engine.io `allowRequest` on WebSocket handshakes, the upgrade handler, Nest gateway path | Each one is covered by an e2e test in PR 1.                                                                                                              |

## Verification (each PR)

```bash
pnpm install && pnpm --filter @reelcraft/shared build
pnpm typecheck && pnpm --filter @reelcraft/api typecheck
pnpm lint && pnpm format:check
pnpm --filter @reelcraft/shared test && pnpm --filter @reelcraft/api test
pnpm db:generate                          # PR 2, PR 3 (offline)
pnpm db:migrate                           # only with the worktree .env (→ :55432)
TEST_DATABASE_URL=postgres://reelcraft:reelcraft@localhost:55432/reelcraft pnpm test:e2e
pnpm --filter @reelcraft/web typecheck && pnpm --filter @reelcraft/web test && pnpm --filter @reelcraft/web build   # CI skips web
cd apps/docs && pnpm install --ignore-workspace && pnpm build   # docs changes
```

Manual check in BrowserOS Neo against the isolated stack (API `:3100`, web `:5174`), never `pnpm dev` on the default ports:

- Open two tabs on one run and start it. Both update, and the Network panel shows no polling.
- Restart the API. The tabs reconnect and refresh.
- Trigger an approval pause. The toast and the bell badge appear, and clicking opens `?review=`.
- PR 3: enable browser notifications, close every tab, and trigger a pause. An OS notification appears, and clicking it opens the right run.
- PR 4: assistant replies stream with no SSE or polling.

Optional: build the image and run `docker/app/smoke-test.sh` to confirm the new dependencies are in the bundle.

Branches follow the user's convention: `feat/…`, a PR per phase against `main`, staging explicit paths only.
