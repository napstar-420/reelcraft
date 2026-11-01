---
title: The assistant
description: One chat, on every page, that makes, changes, runs and reviews your videos with you.
---

The **Assistant** is a chat that can do almost everything in Reelcraft for you. Ask it to make a
video ("a 30-second faceless reel about space facts: script, voice-over, one image per scene, then
render"), to explain what a blueprint does, to find out why a run failed and fix it, or to check how
a finished video turned out.

It runs on **Codex** or **Claude**, so you need to [connect Codex](../codex.md) or
[connect Claude](../claude-code.md) first. If the one you picked isn't connected, the assistant
says so and links to **Settings**.

## Open it

- On **Home**, the chat is the top of the page.
- On every other page, it is the column on the right. **Cmd J** (Ctrl J on Windows and Linux), or the
  **Assistant** button in the rail on the left, shows and hides it. When it's hidden, an
  **Assistant** button waits in the bottom right corner.
- In **Cmd K** search, **Ask the assistant about …** sends your text to it.

It is the same chat everywhere: you can start on Home, open a run, and carry on talking.

The assistant knows what you're looking at. The box above the message field shows it, such as
**Run #a1b2c3d4 · Scene images** or the name of the blueprint you're editing, and "this run" or
"this stage" in your message mean that one. Select **✕** on it to send a message about nothing in
particular.

Type your message and press **Enter** (**Shift + Enter** starts a new line). Messages can contain up
to 64,000 characters.

When both are connected, pick **Codex** or **Claude** in the provider menu at the top of the chat. A
chat keeps the provider it started with: switching starts a new chat. Pick the **Model** and its
**Effort** next to it. A higher effort is slower and uses more of your plan.

## Modes

The three buttons under the message field set how much the assistant does on its own. **Shift +
Tab** in the message field switches between them.

- **Manual**: the assistant reads whatever it needs, but before it changes or starts anything it
  shows a card with exactly what it will do and waits for you:
  - **Yes** does it.
  - **Yes, and switch to Auto** does it and lets the assistant carry on without asking in this chat.
  - **No, do this instead…** lets you say what you want instead (or nothing). Nothing is done.

  A card shows a blueprint change as the stages added, removed and changed, and a run action with
  what it re-makes and its estimated cost. If you don't answer within 30 minutes, nothing is done.

- **Auto**: the assistant does what it needs without asking. Changes to a blueprint can still be
  undone, and every run stops at its own budget.
- **Plan**: the assistant only reads and investigates, then shows a **Plan** card with the steps it
  would take and what they cost. Choose **Approve and run in Auto**, **Approve and run in Manual**, or
  **Keep planning** to say what should change.

New chats start in the mode set in **Settings › Assistant**.

## What it can do

The assistant doesn't guess what Reelcraft can do. Before it uses a stage type, a model, a check, a
style, an asset or a character, it looks it up in **your** Reelcraft. You see these steps as a
collapsed line such as **12 steps · Changed the draft**. Select it to see each one.

**Channels and blueprints.** It can create, rename, archive and delete channels and blueprints,
change a channel's default settings, build a blueprint's stages or change them, save a version, and
bring an older version back. Every change it makes to a blueprint is checked with the same rules as
**Save**, and is shown in the chat with **Open blueprint** and **Undo**. Its changes are your
blueprint's unsaved draft until it (or you) saves a version. If you have the blueprint open, the
editor shows the change straight away. If you were in the middle of an edit, the editor asks
instead: **Load its version** or **Keep mine**.

**Runs.** It can start a **Free test run** or a real run, re-make stages of a run after fixing them
(only that stage, up to it, or from it to the end), retry a failed stage, pause, continue and stop a
run, raise its budget, approve or reject a stage waiting for review, and fill in a stage waiting for
input. A run it starts appears in the chat with its live status. Run inputs that are files (images,
audio, video) can only be added by you, on the run.

**Reviewing what runs made.** It can read every run: which stage failed and why, what each cost,
the exact prompt each try sent and what it received, which check or quality control rejected an
output, and what stages passed on to each other. It looks at pictures, at a video (or the final
video) as a sheet of frames at the times it chooses, and listens to voice-overs, music and
soundtracks as a timed transcript with how loud they are and where they go quiet. Listening uses
[VoiceStudio](../voice-studio.md) when it's running (free), otherwise Deepgram (a small cost, so in
Manual mode it asks first).

What it reads from a run is treated as information, never as instructions. Pictures, frames and
transcripts go to the same provider that runs the assistant. A free test run's text and pictures are
placeholders, so it judges those runs by structure only.

**Questions about Reelcraft.** Ask how to do something yourself, such as where a setting is, how to
update, or how to connect Codex, and it searches this guide (the copy that came with your Reelcraft)
and answers with a link to the page.

When you ask for something Reelcraft can't do, it says so instead of faking it. For example,
Reelcraft can't publish a video to a platform, and the assistant can't create characters or upload
assets for you.

## Watching runs

The assistant watches the runs it starts or sets going again. When one fails, waits for a review or
an input, runs out of budget, or ends, the chat gets a **Run update** and the assistant deals with it
in the chat's mode: it might find the cause and fix it, review the output, or just tell you how it
went. You can also ask it to watch any run.

The runs it watches are listed above the message field as **Watching #a1b2c3d4**. Select **✕** to stop
watching one. Each run can wake the assistant only so many times (5 unless you change
**Wake-ups per run** in **Settings › Assistant**), and it stops watching a run when the run ends.

When the assistant is waiting for your answer and the chat is hidden, a message says **The assistant
needs your OK**, and the **Assistant** button shows a dot.

## Questions

When your request leaves a choice to you, the assistant asks. A question card lists the options, and
the last one is always **Other…**: choose it to type your own answer. Select **Send answers** to
continue. If you type a new message instead, the question is skipped.

## Chats

Your chats are kept, so you can come back to one later. At the top of the chat:

- **New chat** (the speech bubble with **+**): start fresh. Do this when a chat gets long or the
  assistant loses track.
- **Chat history** (the clock): pick an earlier chat, or **Delete this chat**.

Select **Stop** (the square) to interrupt the assistant while it works.

After you update Reelcraft, a chat started before the update shows **Reelcraft was updated since this
chat started**. Select **Start new chat** so the assistant uses the new version's tools.

## Good to know

- The assistant sees what its tools read (your channels, blueprints, runs and what they made) and
  your conversation. That goes to Codex or Claude, under your ChatGPT or Claude plan's terms. Your
  provider keys and settings never do.
- Usage counts against your ChatGPT or Claude plan, and a long chat uses more of it than a short one.
  Real runs it starts are paid by your provider keys, like runs you start.
- If a request fails with a message from Codex or Claude, such as a model that isn't available to
  your account, pick another **Model** and send it again.
