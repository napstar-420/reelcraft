# Plan: share links for generated files

## Context

The user wants to share what Reelcraft makes (a run's final video, images, audio, subtitles, uploaded assets)
with a link that works for anyone on the internet. This started with Deepgram rejecting Analyze Media's
storage URL ("URL for media download must be publicly routable"). That part is solved separately, without
public URLs: Analyze Media now uploads the audio bytes to Deepgram (`fix/media-manifest-blob-id`).

Agreed with the user (2026-10-10):

- **Reach**: anyone on the internet, through a **separate share-only port** that the user tunnels or
  forwards. The app's own port (8080) stays private, as ADR-0002 requires.
- **Lifetime**: when a shared file is deleted (run, channel or blueprint deleted, or the file collected after
  its artifact was replaced), the link stops working. No copies, no retention pins.

## Ground truth (verified)

- MinIO is private: `127.0.0.1:9000` in the image (`Dockerfile:123`), `localhost:9000` in dev. Every presigned
  URL is signed for that host, in the image with **MinIO's root credentials** (`rootfs/.../env.sh:17`).
- Browser media always goes through `GET /api/blobs/:id` (`blob.controller.ts`), a 302 to a presigned URL that
  lives `PRESIGN_TTL_SEC` (900 s). The image rewrites it to `/storage/...`, which the API proxies to MinIO
  (`http-mounts.ts:11`, `S3_BROWSER_PATH_PREFIX`). Only port 8080 is exposed.
- `presignGet({ external: true })` returns the raw localhost URL. After the Deepgram change it has no callers,
  and neither does `EngineConfig.publicApiBaseUrl` / `PUBLIC_API_BASE_URL`.
- There is no authentication (ADR-0002): whoever reaches 8080 reaches Settings and the saved keys.
- `StorageAdapter.getStream(key, range)` and `stat(key)` already support byte ranges, mime and size.
- Blob rows are deleted in three places: `deleteRunsCascade()` (`run/run-cascade.ts:62`),
  `ChannelService.delete()` (`channel/channel.service.ts:190`) and `BlueprintService.delete()`
  (`blueprint/blueprint.service.ts:201`). Retention GC (`BlobService.collectEligible`) only stamps
  `blob.deletedAt`; run blobs become eligible when their artifact is invalidated and are collected after
  `BLOB_RETENTION_DAYS` (30).
- The web app shows media in `components/runs/artifact-views/` (`media-view`, `image-list-view`,
  `clip-list-view`, `subtitles-view`) and the final video on `RunPage.tsx:330-338`.

## Why not public presigned URLs

- SigV4 caps a presigned URL at 7 days.
- One link can't be revoked; only rotating MinIO's root credentials kills it, and that kills every link.
- The URL exposes the storage layout (`owner/channel/run/...`).
- Making it reachable means exposing `/storage` on 8080, which is the whole unauthenticated app.

So links are **app-issued tokens** served by a tiny listener that streams from storage. The bucket stays
private and nothing signed with MinIO's credentials leaves the machine.

## Design

### Data: `share` table

| Column      | Notes                                                                         |
| ----------- | ----------------------------------------------------------------------------- |
| `id`        | ULID                                                                          |
| `ownerId`   | `'local'` via `@Owner()`, like `blob`                                         |
| `token`     | 32 random bytes, base64url, unique. Stored as is so the UI can copy it again  |
| `blobId`    | FK → `blob`. Final video, artifacts, assets and characters all resolve to one |
| `filename`  | For `Content-Disposition`, e.g. `final-video.mp4`                             |
| `createdAt` |                                                                               |
| `expiresAt` | Nullable: never expires                                                       |
| `revokedAt` | Nullable                                                                      |

One live share per blob: sharing the same file again returns the existing link, so "Copy link" is
idempotent.

### Public listener (the only thing on the share port)

- New `SHARE_PORT` (image `8081`, dev `3001`). In `main.ts`, a plain `express()` app, not the Nest app, with
  only `GET`/`HEAD /s/:token` and `GET /s/` (204, for the Settings reachability test). It calls
  `ShareService` from the Nest container. Nothing else is mounted, so tunnelling this port exposes only
  share links.
- `ShareService.open(token, range)`: look up the share, then the blob. Unknown, revoked or expired → 404
  (indistinguishable). Blob row gone or `deletedAt` set → 410. Otherwise `stat` + `getStream(range)`.
- Response: `200` or `206` with `Accept-Ranges`/`Content-Range` (video seeking), `Content-Type` from the
  blob, `Content-Disposition: inline` (`?download=1` → `attachment`), `Cache-Control: private, max-age=0`,
  `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.

### Share address

- The public base URL, e.g. `https://abc.trycloudflare.com`: `SHARE_PUBLIC_URL` from the environment first,
  then a plain (non-secret) Settings value, the same order as the Neo address.
- Links are built at read time as `${shareAddress}/s/${token}`. A quick tunnel's address changes on every
  restart, so updating the setting fixes every existing link.
- Unset: links fall back to `http://localhost:SHARE_PORT` and the UI says they only work on this computer.
- Remove `PUBLIC_API_BASE_URL`, `EngineConfig.publicApiBaseUrl`, `presignGet`'s `external` option and the
  `.env.example` line (no callers left).

### Private API (on 8080, shared Zod DTOs)

- `POST /api/shares { blobId, expiresInDays? }` → `{ id, url, expiresAt }` (returns the live share if any).
- `GET /api/shares` → list for Settings. `DELETE /api/shares/:id` → revoke.

### UI

- A **Share** action next to the existing download links in the artifact views and on the run's final video:
  a dialog with the link, Copy, expiry (Never, 1 day, 7 days, 30 days) and Revoke.
- Settings → **Sharing**: share address, **Test** (calls `${address}/s/` from the API), and the list of live
  links with Revoke.

### Deletes (link stops working)

- `share` reaches the run/channel graph through `blob`, so per `CLAUDE.md` delete its rows before the blob
  deletes in `deleteRunsCascade()`, `ChannelService.delete()` and `BlueprintService.delete()`, and add it to
  `channel-delete-cascade.e2e.test.ts` with rows present.
- GC-collected blobs keep their row, so the route answers 410.

### Image and docs

- `Dockerfile`: `SHARE_PORT=8081`, `EXPOSE 8081` → bump `docker/app/RUNTIME_VERSION`.
- ADR-0012 "Share links on a separate public port": a narrow, documented exception to ADR-0002's "never
  expose the port".
- User guide: a new `sharing.md` page (stable slug, linked from `docs-url.ts`) covering the Docker Desktop
  port mapping for 8081 and a cloudflared quick tunnel, and saying plainly never to tunnel 8080.
  `docs/self-hosting.md` gets the port and the rule.

## Security

- Anyone with a link can download that one file. Tokens are 256-bit, there is no listing, and the
  listener accepts only `GET`/`HEAD`.
- No bandwidth or rate limit (ponytail ceiling: add a per-token limit if a link is abused).
- The share listener runs in the API process, so its handler is the whole public attack surface. Keep it
  small and unit-tested.
- Uploads (`presignPut`) stay browser-only on 8080.

## Phases (one PR each)

1. **API** (`feat(api)`): table and migration, `ShareService`, listener, private routes, cascade and its e2e
   test, unit tests for range/expired/revoked/gone; remove `PUBLIC_API_BASE_URL`.
2. **Web and guide** (`feat(web)`): Share dialog, Settings → Sharing, `sharing.md`.
3. **Image** (`feat`): port, `RUNTIME_VERSION`, ADR-0012, `self-hosting.md`.

## Open questions

- Docker Desktop can't add a port mapping to an existing container; users recreate it from the same volume.
  Check that the guide's update and backup steps cover this before phase 3.
- Recommend quick tunnels (address changes) or named tunnels (stable, needs a Cloudflare account)?
- Link previews in chat apps (`og:` tags, a poster frame) are out of scope.
