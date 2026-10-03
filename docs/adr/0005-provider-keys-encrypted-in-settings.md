# ADR-0005: Provider keys are saved encrypted in the database, and the environment wins

**Date**: 2026-10-03 (recorded; decided while planning the Settings page, PR #50, Oct 2026)
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

Before the Settings page, provider keys (OpenRouter, fal, ElevenLabs, Deepgram) could only be passed as
container environment variables. A Docker Desktop user would have to recreate the container to add one. Keys
are secrets: they must not be readable in database dumps, including the backups taken before updates.

## Decision

- **Keys are saved in Postgres, encrypted**, in the `app_setting` table (`apps/api/src/db/schema/app-setting.ts`,
  migration `0022`). `SettingsCipher` (`apps/api/src/settings/settings-cipher.ts`) uses AES-256-GCM. The key is
  derived with HKDF-SHA256 from `PREVIEW_TOKEN_SECRET` (salt `reelcraft-settings`), a secret that
  `init-data` already generates into `/data/secrets.env`. `SETTINGS_ENCRYPTION_KEY` overrides it. The
  stored form is `v1:<iv>:<tag>:<ciphertext>`, each part base64.
- **A value that can't be decrypted** (wrong secret, or tampered) is reported as "unreadable" and treated as not set.
  The Settings page then says "Saved key can't be read" and asks for the key again. It never crashes the app.
- **The environment wins.** `SettingsKeyProvider` (`apps/api/src/provider/key-provider.ts`) is bound to
  `KEY_PROVIDER`: it checks the environment variable first, then the saved setting. A key set in the environment
  can't be changed from Settings (the API returns 409).
- **Keys are write-only through the API.** `GET /api/settings` returns only a masked hint (`••••` and the last
  four characters of keys at least 16 long). Keys are never logged.
- **Adapters ask for the key on every call**, so a key saved in Settings takes effect without a restart.
  Changing the OpenRouter key clears the model cache.
- **The BrowserOS Neo address** follows the same idea: saved in Settings, then `CODEX_BROWSER_OS_URL`, then the
  built-in default. The image sets `CODEX_BROWSER_OS_URL` as its default, so on a new install Settings shows
  "From the container environment". Code reads it with `SettingsService.browserOsUrl()`, never `EngineConfig`.

## Alternatives Considered

### Alternative 1: Environment variables only (the previous state)

- **Why not**: needs a terminal or a container recreate to change a key, which defeats the Settings page.
  It still works, and wins when set.

### Alternative 2: Store keys in plain text in the database

- **Why not**: every `pg_dump`, including `/data/backups`, would contain usable keys.

### Alternative 3: A new, separate encryption key file

- **Why not**: it would be a new secret to generate in `init-data`, which is in `rootfs`. That changes the image
  and forces a `RUNTIME_VERSION` bump, so the feature couldn't ship as an in-app update. Reusing
  `PREVIEW_TOKEN_SECRET` needed no image change.

## Consequences

### Positive

- Non-developers can add and test keys in the browser. Backups hold no readable keys.
- The feature shipped as a normal in-app update (`RUNTIME_VERSION` stayed 3).

### Negative

- Saved keys are tied to `/data/secrets.env`. Restoring a volume without it, or rotating `PREVIEW_TOKEN_SECRET`,
  makes saved keys unreadable. They must be entered again.
- Encryption protects dumps, not a running container: anyone who can open the app (no login, see ADR-0002)
  can use the keys.

### Risks

- A new provider needs an entry in `PROVIDER_KEYS` and in the shared `ProviderKeyId` type, and must get its key
  through `KEY_PROVIDER`, never from `process.env`. Never put real provider keys in source, fixtures or commits.
