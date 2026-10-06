# ADR-0008: Blueprint packages are signed with a local identity

**Date**: 2026-10-06
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

People running separate Reelcraft installs want to share blueprints. A blueprint depends on things that only
exist on its author's install: characters, reference images and uploaded assets. Reelcraft has no accounts
(ADR-0002), so there is nobody to vouch for who made a file, and a shared file could be edited on the way.

## Decision

- A **blueprint package** (`.reelpack`) is a zip holding one saved blueprint version: `manifest.json`,
  `manifest.sig`, `pipeline.json` and `media/`. The manifest lists a SHA-256 for every other file, so one
  signature over the manifest covers the whole package. The shared schema is in
  `packages/shared/src/dto/package.dto.ts`.
- Every install has a **local identity**: an Ed25519 key pair made on first use. The private key is stored
  encrypted in Settings with the same cipher as provider keys (ADR-0005); the public key is a plain setting.
  The identity is called "local" and is shown by its fingerprint (the first 16 bytes of the public key's
  SHA-256, as hex). There is no display name and no account.
- Importers use **trust on first use**: the first package from a fingerprint asks whether to trust that author.
  Trusted fingerprints are kept in `package_trusted_author`.
- Signing uses `node:crypto` only, like release signing (ADR-0003).
- The package never carries a budget. The importer sets the run cap.
- Identities can be backed up and restored from Settings. This is the one place a private key leaves the API,
  and only because the user asks for it. Provider keys stay write-only.
- An identity that can't be decrypted (the encryption secret changed) is reported as unreadable and never
  replaced silently. The user restores a backup or creates a new identity.

## Alternatives considered

- **Unsigned JSON.** Simplest, but nothing says who made a file or whether it was changed, and updates
  from the same author can't be told apart from a lookalike.
- **A display name as identity.** Anyone can type any name.
- **Accounts or a central key registry.** Needs a hosted service and a login, which a self-hosted install
  doesn't have. The fingerprint already identifies a key without either.

## Consequences

- Losing the identity makes later packages look like they come from a new author. The backup and restore
  buttons are the mitigation.
- A signature proves a package is unchanged and from one key, not that the author is who they claim to be.
  Trust is each importer's decision.
- Because a downloaded package is plain JSON and media, a package can't be protected from being shared on.
