# Phase 8 — Characters

Phase 8 provides reusable, channel-owned Characters conditioned by explicitly
selected reference images. A one-role blueprint stores a Character ID and an
ordered reference subset. Starting a run revalidates the selection and stores
an immutable snapshot before the orchestration wakeup is emitted.

References are uploaded directly to object storage and confirmed by the API;
generated images are promoted by copying their object into the Character
namespace so run retention cannot remove an identity asset. Role bindings
resolve to ordered `media.image` manifests and their exact blob IDs are kept
in attempt input provenance. A selected set that exceeds a consuming pinned
model's declared limit is rejected at start rather than silently truncated.

LoRA training is intentionally outside this phase. Character descriptions and
reference images are the v1 consistency mechanism.
