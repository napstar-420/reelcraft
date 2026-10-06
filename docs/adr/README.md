# Architecture Decision Records

Decisions behind the self-hosted Reelcraft (Docker image, releases, in-app updates, Settings, user guide).
Start with [`docs/self-hosting.md`](../self-hosting.md) for how it all fits together. Each ADR says what we
chose, what else was on the table and what it costs. To record a new decision, copy the format of an existing
one, take the next number, and add a row here. Supersede an ADR instead of editing history.

| ADR                                                            | Title                                                                          | Status   | Date       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- | ---------- |
| [0001](0001-single-all-in-one-image.md)                        | One all-in-one image on a single volume                                        | accepted | 2026-10-03 |
| [0002](0002-public-images-no-built-in-auth.md)                 | Public images, no built-in login                                               | accepted | 2026-10-03 |
| [0003](0003-release-please-and-signed-releases.md)             | Releases come from release-please, and every release is signed                 | accepted | 2026-10-03 |
| [0004](0004-in-app-updater-in-the-image.md)                    | The in-app updater lives in the image; image and app bundle version separately | accepted | 2026-10-03 |
| [0005](0005-provider-keys-encrypted-in-settings.md)            | Provider keys are saved encrypted in the database, and the environment wins    | accepted | 2026-10-03 |
| [0006](0006-codex-sign-in-through-neo-with-manual-fallback.md) | "Connect Codex" signs in through BrowserOS Neo, with a manual fallback         | accepted | 2026-10-03 |
| [0007](0007-user-guide-as-separate-docusaurus-project.md)      | The user guide is a separate Docusaurus project on GitHub Pages                | accepted | 2026-10-03 |
| [0008](0008-blueprint-packages-signed-with-local-identity.md)  | Blueprint packages are signed with a local identity                            | accepted | 2026-10-06 |
| [0009](0009-blueprint-assistant.md)                            | The blueprint assistant is a tool-calling agent in the canvas, Codex first     | accepted | 2026-10-06 |

ADRs 0001–0007 were decided during the self-hosting work in October 2026 and recorded together on 2026-10-03, so the dates are when they were written down.
