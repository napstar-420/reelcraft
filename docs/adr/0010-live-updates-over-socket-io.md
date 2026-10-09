# ADR-0010: Live updates over Socket.IO, as invalidation hints

**Date**: 2026-10-08
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

The web app learned about runs by polling: a 3 s interval next to a Server-Sent Events stream on the run page,
5 s on the runs list, 3 s on the stage sheets and the assistant chat. The SSE stream only carried the few
transitions `RunStateService` published; starting, resuming, pausing, cancelling and every stage change were
only noticed by the next poll. Several users will share one install later, and notifications (ADR-0011) need
the same events, so the transport has to know who each event is for.

## Decision

- **Socket.IO on the existing HTTP server, under `/api/socket.io`.** One process serves everything and the
  image has no reverse proxy, so there is nothing else to configure. The path sits under `/api`, so the SPA
  fallback and the global prefix never see it, and the dev proxy needs one `ws: true` entry placed before
  `/api`.
- **Events are hints, not data.** The server sends `run:updated {runId}` and `stage:updated {runId, stageKey}`;
  the browser invalidates the affected TanStack queries. The REST API stays the only way to read state, so
  there is no second schema to keep in sync. Bursts are coalesced into one invalidation per query every 250 ms
  (throttled, not debounced), because `invalidateQueries` cancels in-flight fetches. After a reconnect (an API
  restart, an in-app update, a sleeping laptop) everything is invalidated.
- **Services publish to an in-process bus (`LiveEvents`) after their transaction commits; the gateway
  subscribes to it.** Services never call the gateway: it only exists on a real HTTP server, not in the
  Nest testing module. Publishing happens in `withLockedRun` (every operator action), the wakeup claim,
  `RunStateService`, cancellation, run creation, budget raises and `StageEventService.record`.
- **Rooms are per user.** A socket joins `user:<id>`, where the id comes from `resolveSocketUser`, the socket
  twin of `@Owner()` and always `'local'` today. A run's event goes to the room of its channel's owner. When
  authentication exists, that one function is where it plugs in.
- **Same-origin check on the handshake.** CORS does not apply to WebSockets and the API has no login
  (ADR-0002), so any web page could otherwise connect to a local Reelcraft and read run data. engine.io's
  `allowRequest` accepts a handshake with no `Origin` (not a browser) or an `Origin` whose host equals `Host`
  (or the first `X-Forwarded-Host`), and rejects everything else.
- **Still polled on purpose:** the update status (the API restarts mid-update, so the socket drops) and the
  Codex sign-in (a short device flow).

## Alternatives considered

- **Keep SSE.** One-directional and fine for run events, but it cannot carry the per-session subscriptions
  the assistant needs, and a second transport would remain.
- **Push full objects over the socket.** Faster to render, but duplicates every DTO and needs ordering and
  conflict handling. Refetching one query is cheap here.
- **A room per run.** Fewer messages, but a per-user room already bounds fan-out, and a run's events are
  tiny. Per-session rooms are used where volume justifies it (assistant token deltas).
- **Postgres LISTEN/NOTIFY or Redis now.** Multiple users are not multiple replicas. See below.

## Consequences

- **More than one API replica needs an adapter.** The bus is in process, so each replica only reaches its own
  sockets. §21.2 of the design spec named Postgres `LISTEN/NOTIFY` behind the old `RunEvents` interface; that
  swap point is now the Socket.IO server: add `@socket.io/postgres-adapter` (Postgres is already there, Redis
  is not) in `LiveGateway`'s server setup. The bus can stay.
- **A reverse proxy must keep `Host`** or set `X-Forwarded-Host`, and pass WebSocket upgrades for
  `/api/socket.io`. No proxy is supported today (ADR-0002).
- **An in-app update drops every socket.** The client reconnects with backoff and refetches everything.
- New dependencies (`socket.io`, `@nestjs/websockets`, `@nestjs/platform-socket.io`) ship in the app bundle,
  so they arrive as an in-app update with no `RUNTIME_VERSION` bump.
