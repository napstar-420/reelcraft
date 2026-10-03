---
title: Starting a run
description: Run a saved blueprint version, fill in its inputs and set a spending limit.
---

A **run** is one go at making a video: Reelcraft carries out the blueprint's stages in order, with the
inputs and budget you give it. You can start as many runs as you like from the same blueprint.

## Before you start

- The blueprint's latest version must be **saved** and show **Runnable**. See
  [Versions](../blueprints/versions.md).
- The models and keys it uses must be set up. See [Models](../blueprints/models.md) and
  [AI provider keys](../provider-keys.md).
- If it uses a [character](../channels/characters.md), the character must be **Ready**.
- If you only want to try it out without paying, do a [dry run](./dry-runs.md) first.

## Start a run

1. Open the blueprint's canvas. Under **Save & run**, select **Run**. (If **Run** is off, the card says
   **Save to run your changes**: save first.)
2. In the dialog, titled **Run blueprint**, set the **Budget cap (USD)**. It starts as the blueprint's
   [run cap](../blueprints/settings.md#budget). The run never spends more than this unless you raise
   it. See [Budget and costs](./budget-and-costs.md).
3. Fill in the blueprint's inputs. A **\*** marks a required one:
   - text inputs: type the text;
   - data inputs: paste JSON, which must be valid;
   - image, video and audio inputs: choose a file. An input that accepts `many` files lets you pick
     several.
4. Select **Start real run**.

Reelcraft checks your entries first, and shows what to fix under each box, for example **Topic is
required.** or **Script must contain valid JSON.**

![The Run blueprint dialog](/img/usage/run-dialog.png)

The run page opens as soon as the run starts. See [Run page](./run-page.md).

:::note A real run costs real money

The dialog reminds you: **This is a real run. It uses each stage's configured provider, including
Codex, and may consume provider usage.**

:::

## What happens when you start

1. Reelcraft creates the run, uploads your files, and freezes what it needs: the blueprint version,
   your inputs, the assets and the character. Changing an asset or a character afterwards doesn't
   change this run.
2. It checks that everything the run needs still exists, such as the assets and the character. If
   something is missing, you're told, for example that a character was deleted.
3. It starts the first stage.

## If starting fails

If a file upload or the start itself fails, the run is kept, in the **Created** state, and the dialog
shows **Run saved for retry**: _Run … remains in CREATED state. Retrying continues that run and will
not create a duplicate._ Fix the cause, such as your connection, and select **Retry upload & run** (or
**Retry start**).

If the run can't start at all, the reason appears under **Run could not start**.

## Other ways to start a run

- **Rerun** on a finished run starts a new one from the beginning with the same inputs. See
  [Retries](./retries.md#start-over-with-rerun).
- The [run panel](./canvas-runs.md) on the canvas runs stages one at a time while you're building.
