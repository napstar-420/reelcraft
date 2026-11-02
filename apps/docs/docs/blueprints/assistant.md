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

### Attach files

Give the assistant a picture, a video or a sound, for example a reference video to recreate, a
photo of a host, or a logo. Select **Attach files** (the paperclip) next to **Send**, drop files on
the message box, or paste them. A message can carry up to 10 files: pictures up to 20 MB, videos and
sounds up to 1 GB and 15 minutes. Each file uploads straight away and shows **Ready** when it's done.
Select **✕** on a file to remove it before you send.

The assistant sees pictures with your message. It looks at a video as frames at the times it
chooses and listens to sound as a timed transcript, the same way it reviews what a run made. Files
stay with the chat, and are deleted when you delete the chat. They don't go into a channel's
**Library** unless you ask the assistant to put them there.

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
  - **Yes to everything this turn** does it, and everything else it changes in this answer, without
    more cards. A delete still asks.
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
input. A run it starts appears in the chat with its live status. For run inputs that are files
(images, audio, video), it uses files you attached, files from the channel's **Library**, or what
another run made.

**The Library, characters and voices.** From a file you attached, or a picture or sound a run made,
it can save an asset to a channel's **Library**, create a character (or add pictures to one, or
choose its main picture), and make a [VoiceStudio](../voice-studio.md) voice from a clear recording.
It can also delete assets and characters when you ask. A channel or blueprint it deletes goes to
the trash (**Settings › Trash**), and the chat shows **Restore**. It can't make a character from a description
alone: give it a picture, or ask it to make one with a run first.

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

**Recreating a video.** Attach a video, or paste its link, and ask for one like it. The assistant
breaks it down: its format, every shot with its timing and words, the narration and its pace,
captions, music and sound effects. It shows the result as a **Breakdown** card: the video plays in
the card, and selecting a shot jumps to it. Each shot says how it would be made (**Picture**, **Video
clip**, **Motion graphic**, **Text card**, **From the Library** or **Style reference**). In
**Manual** and **Plan** mode it asks whether the breakdown is right before it builds anything.

It then builds a reusable blueprint from ordinary stages that follows the same structure, pacing and
style, with the topic as a run input, and starts a first run that follows the reference closely. When
that run ends it compares the two videos side by side (length, number of shots, shot length, loudness
and frames at the same moments) and suggests what to change. It takes the structure and the style,
not the reference's own words, characters or footage.

**Editing a video.** It can change a finished video made by a
[Compose Timeline](../stage-types/compose-timeline.md) stage, or a timeline waiting for you in a
[Human Timeline Edit](../stage-types/human-timeline-edit.md) stage: trim, split, move or remove clips,
add titles and tracks, change captions, volume and transitions. It renders a quick draft and looks at
it before telling you it's done. Each change appears in the chat with **Open editor** and **Undo**,
and in the [timeline editor](../video/timeline-editor.md#the-assistant-in-the-editor) if you have it
open. It only re-renders the video when you ask, after saying what that costs.

**Links and the browser.** Paste a link and ask the assistant to use it. It downloads a picture,
video or sound into the chat, from a link straight to the file or from a video page such as YouTube,
TikTok or Instagram, up to 1080p and 15 minutes. Links to your own computer or local network are
refused. Downloading from a site is subject to that site's terms, so only share links you're allowed
to use.

With [BrowserOS Neo](../browseros-neo.md) connected, the assistant can also open pages in Neo, read
them, look at a screenshot, scroll, click and type, for example to find the video on a page. Neo is
signed in to your accounts, so the assistant never signs in, buys, posts or changes settings unless
you ask it to. In **Manual** mode it asks before every click or keystroke. The tabs it opens close
when it finishes answering.

**Goals.** Ask for a result rather than one change, such as "keep going until the voice-over is
under 30 seconds, at most 3 tries or $5", and the assistant works toward it on its own: it runs the
blueprint, reviews what the run made, fixes the blueprint and runs it again. Each run or re-run
counts toward the limits you gave (3 runs when you name none), and Reelcraft won't let it go past
them. When the goal is met or the limits are used up, a **Goal** card shows the outcome, what it
tried and every run with its cost. It can also compare two runs side by side, stage by stage.

**Questions about Reelcraft.** Ask how to do something yourself, such as where a setting is, how to
update, or how to connect Codex, and it searches this guide (the copy that came with your Reelcraft)
and answers with a link to the page.

When you ask for something Reelcraft can't do, it says so instead of faking it. For example,
Reelcraft can't publish a video to a platform.

## What it remembers

Each chat starts fresh, but the assistant keeps **notes** between chats: your preferences, your
corrections, and things that went wrong and why. Tell it to remember something ("always make these
9:16", "my host is Mia, not Maya") and it saves a note. The chat shows **Remembered for "…"** with
**Undo**. Notes for a channel apply whenever a chat is about that channel; other notes apply in
every chat.

You can read, edit, add and remove notes yourself:

- notes for every chat: **Settings › Assistant**, under **What the assistant remembers**;
- a channel's notes: the channel's **Assistant notes** tab.

Notes the assistant saved show a sparkle. Each note can be up to 500 characters, with up to 50 notes
for every chat and 50 for each channel.

The assistant can also search your earlier chats, video breakdowns and goal reports when you refer
to past work ("make it like the space reel last week"). A chat's memory is deleted with the chat,
and a channel's notes and memories are deleted with the channel.

## Watching runs

The assistant watches the runs it starts or sets going again. When one fails, waits for a review or
an input, runs out of budget, or ends, the chat gets a **Run update** and the assistant deals with it
in the chat's mode: it might find the cause and fix it, review the output, or just tell you how it
went. You can also ask it to watch any run.

The runs it watches are listed above the message field as **Watching #a1b2c3d4**. Select **✕** to stop
watching one. Each run can wake the assistant only so many times (5 unless you change
**Wake-ups per run** in **Settings › Assistant**), and it stops watching a run when the run ends.

When the assistant is waiting for your answer and the chat is hidden, a message says **The assistant
needs your OK**, and the **Assistant** button shows a dot. When no Reelcraft page shows the chat at all, you get a **The assistant needs you**
[notification](../runs/notifications.md) instead, and, if you turn it on, one when it has finished
dealing with a run update. Selecting the notification opens the chat.

## Questions

When your request leaves a choice to you, the assistant asks. A question card lists the options, and
the last one is always **Other…**: choose it to type your own answer. Select **Send answers** to
continue. If you type a new message instead, the question is skipped.

## Chats

Your chats are kept, so you can come back to one later. At the top of the chat:

- **New chat** (the speech bubble with **+**): start fresh. Do this when a chat gets long or the
  assistant loses track.
- **Chat history** (the clock): pick an earlier chat, **Delete this chat**, or open **Activity in all
  chats**: everything the assistant changed or did, newest first, each with a link to its chat.

Select **Stop** (the square) to interrupt the assistant while it works.

**Usage** (the gauge) shows what the chat has used: the tokens it read and wrote, how many answers,
the runs it started with what they spent, and how full the conversation is.

When a conversation gets very long, or after you update Reelcraft, your next message continues the
chat in a fresh session. The assistant first writes a summary of the chat so far, and the fresh
session starts from it, using the new version's tools after an update. The chat shows a divider
(**The chat got long: continued in a fresh session**); select it to read the summary. Nothing in the
chat is lost. Start a new chat instead whenever you change subject.

## Good to know

- The assistant sees what its tools read (your channels, blueprints, runs and what they made) and
  your conversation. That goes to Codex or Claude, under your ChatGPT or Claude plan's terms. Your
  provider keys and settings never do.
- Usage counts against your ChatGPT or Claude plan, and a long chat uses more of it than a short one
  (see **Usage** at the top of the chat).
  Real runs it starts are paid by your provider keys, like runs you start.
- If a request fails with a message from Codex or Claude, such as a model that isn't available to
  your account, pick another **Model** and send it again.
