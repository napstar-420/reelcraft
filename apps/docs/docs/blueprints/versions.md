---
title: Versions
description: How saving works, what makes a blueprint runnable, and how to look at or restore an older version.
---

Every time you save a blueprint, Reelcraft keeps a **version** of it: a copy that never changes.
Runs always use a saved version, so you can keep editing without affecting runs that have already
started.

## Saving

Your edits on the canvas are kept automatically as you work, even if you close the tab or reload the
page. While they differ from the last save, the top bar shows **Unsaved changes**.

To save them as a version, select **Save** (or press Ctrl or ⌘ + S). Versions are numbered like `v1.3`:

- The first save is `v1.0`.
- **Save** adds 1 to the second number: `v1.0` → `v1.1` → `v1.2`.
- **Bump to v2.0** starts a new major version. Use it from the arrow next to **Save**, to mark a big
  change, such as a new style of video. It doesn't do anything else differently.

After a save you'll see, for example, **Saved as v1.3 (runnable)**.

To throw away your unsaved changes and go back to the last save, select **Discard** in the top bar.

## Runnable or not

Reelcraft checks the blueprint while you edit. The top bar shows:

- **Runnable**: it has no errors, so it can run.
- **Not runnable yet**: it has at least one error. It also says how many problems there are.

Errors and warnings appear on the stages they belong to, as **✗** and **⚠** counts on the stage cards.
Open a stage to see the messages, or select the **problems** button at the bottom of the canvas to see
them all and jump to a stage. Problems with the blueprint as a whole appear in a bar above the canvas.
See [Validation messages](../reference/validation-messages.md) for the common ones.

You can still save a blueprint that isn't runnable, for example to keep work in progress, but you
can't run that version.

## Running needs a saved version

**Run** in the top bar always runs the latest saved version, all of it, as a live run or a dry run. It's
off while you have unsaved changes: hover over it and it says **Save your changes to run this version**.

To try your unsaved changes before saving, use the **Run** tab or a stage card's play button instead. It runs a
temporary copy of the canvas as it is, which doesn't appear in your versions. See
[Canvas runs](../runs/canvas-runs.md).

## Look at an older version

1. Select **Versions** in the top bar. The menu lists every saved version, newest first, with:
   - when it was saved;
   - how many runs used it;
   - **latest** next to the newest one;
   - **not runnable** for versions that weren't runnable.
2. Select a version.

The canvas shows that version, read-only, with the note **Viewing v1.1 (read-only)**. You can open
its stages to see their settings, but you can't change them. **Run**, **Save** and the **Run** tab are
off. Your unsaved changes are kept, out of
sight. Select **Back to latest** to return to them.

![The Versions menu, listing v1.2 (latest), v1.1 and v1.0](/img/usage/versions-menu.png)

## Restore an older version

1. Open the version from the **Versions** menu.
2. Select **Restore this version**, then **Restore**.

Restoring saves a **new** version with the older version's content. For example, restoring `v1.1`
when the latest is `v1.4` saves `v1.5`. Nothing is overwritten, so you can always go back. If you
had unsaved changes, they're discarded; the confirmation warns you when that's the case.
