# ADR-0011: Notifications: a server inbox, Web Push, and per-browser choices

**Date**: 2026-10-08
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

Runs take minutes to hours and stop to wait for people: approvals, form input, a timeline edit, a budget
raise, provider quota. The only way to notice was to look at the page or the Runs list. We want to be told
when a run starts, needs attention, fails or finishes, including with every tab closed. There is one user
today (`'local'`), but several are planned (ADR-0010), so who is told must not be hard-wired.

## Decision

- **A `notification` table is the source of truth** (the inbox behind the bell). A row is written where the
  event happens, so a closed tab, another browser or a later login still sees it. Live pushes and system
  notifications are only ways of announcing a row that already exists.
- **Exactly once, through a dedupe key.** `dedupe_key` is unique and the insert is `ON CONFLICT DO NOTHING`;
  only a row that was really inserted is announced. The key is the wakeup id (start, auto-resume), the
  run id (cancelled), the wait id and threshold (reminders), or the orchestrator's wakeup or Inngest run id.
- **Written where it cannot be replayed.** Started and auto-resumed rows are inserted inside the wakeup
  claim: that Inngest step is memoized for a run already in flight, so an in-app update, which restarts the
  API, never makes a long-running run announce a start that happened hours ago. Other outcomes are steps
  appended right before each `return` of `run.orchestrate` for the same reason. A notification step that
  fails never changes how the run ends.
- **A notification never blocks a state change.** Inside a run's own transaction (claim, cancel) the insert
  runs in a savepoint and its failure is logged and swallowed.
- **Reminders are written by the sweep itself.** `HumanReminderService` used to queue `run/attention-reminder`
  wakeups that nothing consumed. It now writes the notification in the same transaction that stamps
  `reminded_24h_at` / `reminded_48h_at`, and selects only waits that are due.
- **Auto-resume is told apart from a manual resume** by `notBefore`, which only the timed wakeup queued by
  `pauseForQuota` carries.
- **Dry runs never notify.** They use the fake provider and cost nothing. Canvas (draft) runs do: they spend
  real money.
- **Who is told** is the run's channel owner, through the same seam as `@Owner()`. The text and the in-app
  link are fixed when the row is written, so the bell, a pop-up and a system notification all open the same
  view (`?review=<stage>` opens the approval sheet, `?input=<stage>` the form, a timeline edit goes to the
  editor). The run page opens only what is still waiting.
- **Web Push for the closed-tab case.** The server holds a VAPID key pair, made on first use and saved in
  Settings (the private half sealed like provider keys). A browser subscribes through a service worker
  (`/sw.js`) and tells the server which kinds it wants; the server sends after the row is committed, without
  the run waiting on it. A 404 or 410 from the push service removes that subscription. If the saved key is
  missing or unreadable (the encryption secret changed) the key is replaced and every subscription is
  dropped: they were made against the old key, and each browser resubscribes on its next page load.
- **The service worker always shows what it receives.** Safari revokes permission after pushes that show
  nothing, so no "skip it when a tab is visible" rule. To avoid two alerts, a tab skips its own pop-up while
  this browser has an active subscription.
- **Choices are per browser.** Which kinds pop up or arrive as system notifications is kept in the browser
  (`localStorage`), as permission itself is per browser; the browser sends its kinds with its subscription so
  the server filters. The bell always keeps every kind.
- **The push endpoint must be a public https address.** The server calls it, so an IP address or localhost is
  refused, which closes an easy request-forgery route on a login-less API (ADR-0002).

## Alternatives considered

- **Only a browser notification while a tab is open.** No keys, service worker or outbound traffic, but it
  doesn't reach a closed tab, which is when someone walks away from a long run.
- **Email, Slack or webhooks.** Needs accounts and secrets for a local, login-less tool. Possible later as
  more ways to announce the same row.
- **Creating notifications in the UI from the live events.** Misses everything while no tab is open, and
  every open tab would create its own.
- **A notification step between existing orchestrator steps.** Would announce stale starts to runs in flight
  during an in-app update (see above).
- **Per-user preferences on the server now.** There are no users yet and permission is per browser anyway.
  The `kinds` a browser sends with its subscription is already the server-side filter, so a later account
  setting can feed the same place.

## Consequences

- **Plain-HTTP LAN addresses get no system notifications.** Service workers and push exist only on `https` or
  `localhost`. The bell, pop-ups and live updates still work, and Settings says why.
- **Outbound internet access is needed** to reach a browser vendor's push service. If it is blocked, delivery
  is logged and skipped; the inbox is unaffected.
- **Apple devices** need Reelcraft added to the Home Screen before they can receive push, which is not
  supported yet.
- **Retention.** There is no pruning: a handful of rows per run and the bell shows the latest 50. If the table
  grows, delete read rows older than 90 days.
- **Known gap.** If the Inngest function itself crashes, the run stays `RUNNING` and nobody is told. That needs
  an `onFailure` handler.
- New table `notification` references `run`, so it is in `deleteRunsCascade()`. `push_subscription` references
  nothing, so it isn't. New dependency `web-push` ships in the app bundle (no `RUNTIME_VERSION` bump).
