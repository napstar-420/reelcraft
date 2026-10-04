---
title: Generate Video with Flow
description: Make video clips in Google Flow with Codex and BrowserOS Neo, using your own Flow accounts.
---

**Generate Video with Flow** has Codex drive [Google Flow](https://labs.google/fx/tools/flow) in
your signed-in browser and make the clips for you. Flow has no API, so the stage works the way
[Automate Browser](./automate-browser.md) does: it uses the browser on your computer, with your
logins.

:::warning It acts as you

The browser is BrowserOS Neo's persistent profile. The stage clicks around Flow with your Google
accounts and spends their **Flow credits**. Use it only with accounts you're comfortable automating.

:::

## What it makes

A **video list**: all the clips the stage made, in order. Each clip plays on its own in the stage's
output. A later stage that takes several videos, such as
[Concatenate Video](./concatenate-video.md) or a [timeline](./human-timeline-edit.md), can use the
list: bind it with **Previous stage** to a slot that takes many videos.

## Providers and models

**Codex** with **BrowserOS Neo**, and nothing else. Set both up first: see
[Connect Codex](../codex.md) and [BrowserOS Neo](../browseros-neo.md). If either isn't ready, the
model picker says why.

## Template prompt (required)

The stage can't run without one. Reelcraft already tells the agent **how** to use Flow, and you
can read that text under **System** (it's locked). Your **Template** says **what** to make.

Reelcraft doesn't know the shape of the earlier stage's output, so you describe how to use it. For
example, after a stage that writes a list of scenes:

```text
Make one clip for each scene below, in order. Use the scene's "visual" text as the clip's prompt
and its "title" as the clip's label.

{{ scenes }}
```

See [Prompts](../blueprints/prompts.md).

## Settings

Under **Config**:

- **aspectRatio**: `16:9` or `9:16`. Empty uses the blueprint's or channel's
  [format](../channels/defaults.md#format) aspect ratio, and otherwise Flow's own default.
- **flowModel**: the Flow video model, chosen from a list: Omni 1.1 Flash, Veo 3.1 - Lite,
  Veo 3.1 - Fast or Veo 3.1 - Quality. Empty leaves Flow's choice. If your account doesn't offer
  the model you pick, the stage fails with an error naming it instead of using another.

## Inputs

- **references** (optional): images to add to Flow as **ingredients**, such as a
  [character's](../channels/characters.md) pictures. Bind a character role or other images to it.

### Telling the images apart

The agent sees each reference by name: a character's image as **Lucia, front view**, an asset by
the **name you gave it** in the channel's Assets (for example `Beach background`). Name your assets
for what they show, and refer to them by those names in the template ("use Lucia as the host, in
front of the Beach background").

## Durations

If the template gives a clip's duration, the agent sets Flow's duration to it. When the model
doesn't offer that exact length, it uses the closest one (the longer when two are equally close).

## Missing clips

A clip that fails twice stops the stage with an error naming it, instead of finishing with clips
missing. Clips already made are kept, so a retry only makes the rest.

## Accounts and credits

Flow charges credits for each clip, and an account can run out partway through.

1. Sign in to each Google account in BrowserOS Neo.
2. Open the blueprint's **Defaults** card (or the channel's) and, under **Flow accounts**, choose
   **Choose accounts**. The list shows the accounts signed in to Neo; search it and tick the ones to
   use. The order you tick them is the order they're used in.
3. When an account runs out of credits, the stage switches to the next one and carries on.
4. When **every** account is out, the run pauses as **Paused Quota**. It resumes by itself when the
   credits come back, using the time Flow shows (or in 6 hours if Flow doesn't say), and carries on
   with the clips it hasn't made yet. You can also select **Resume** at any time to try again now.

If you leave the list empty, the stage uses whichever account Flow is signed in with, and the run
pauses when that one runs out.

## Cost

Reelcraft doesn't bill anything. The clips use your Flow credits, and the agent uses your ChatGPT
plan through Codex.

## Tips

- A long job can take hours. Finished clips are kept, so if the run pauses or the agent stops, the
  next attempt doesn't remake them.
- Keep each clip's prompt in the data from the earlier stage, and have the template map it in.
- Flow's screens change. If the stage gets stuck, look at the stage's log to see what the agent
  saw, and adjust the template.
