---
title: Timeline editor
description: Arrange pictures, audio, titles and captions by hand, with a preview, a zoomable timeline, split and trim, editable captions, problem checks and a draft render.
---

The timeline editor opens from a [Human Timeline Edit](../stage-types/human-timeline-edit.md) stage. When
the run pauses for it, select **Open editor** on the stage, on the run page or on the stage's card in the
[blueprint canvas](../blueprints/blueprints.md). The editor is titled with the stage's name and **Timeline
editor** beneath it. **Run** takes you back.

It is always dark, whatever theme the rest of Reelcraft uses, and has four areas: the **Media** panel on
the left, the preview and its controls in the middle, the **Inspector** on the right, and the timeline
across the bottom.

## Saving, undoing and problems

Everything you change is saved automatically. The top of the page says **Saving…**, then **All changes
saved**. **Undo** and **Redo** step through your changes; typing in a field counts as one step, not one
per letter.

- **Couldn’t save — retrying on your next change**: the save failed. It tries again when you change
  something else.
- **Out of date**: the draft was changed somewhere else, such as another tab. A bar says so, with
  **Reload**, which continues from the newer version.
- **Read only**: the run isn't waiting for this stage any more.

Next to the save state, the editor checks your draft as you work and says **No problems** or, for example,
**1 problem**. Select it to see what is wrong in plain words, and **Show** to jump to the clip. The clips
involved are outlined in red. See [Timeline checks](./timeline-checks.md).

## Media

The **Media** panel lists everything the stage was given: pictures, video and audio, each with its name
(for example _Image Generation · 3_) and a picture. Use **All**, **Images**, **Video** and **Audio** to
filter. A tag shows whether a file is **In use** or used several times (×2).

Select a file to add it:

- pictures and video go **at the end of the main video track**;
- audio goes on an **audio** track, creating one if there isn't one, starting at the beginning.

A clip is added with its real length when Reelcraft knows it, and the playhead jumps to it.

**Add title** adds a title at the **playhead**, lasting 3 seconds, centred. Edit its words in the
inspector.

## Preview

The preview plays the timeline as it will be rendered, with the same styles, motion and captions, in the
shape of your video. Under it:

- the **position** and the total length, as minutes, seconds and the frame;
- **Go to start**, **Previous frame**, **Play** or **Pause**, **Next frame**, **Go to end**;
- **Mute** and **Unmute**.

Select the picture to play or pause.

## Timeline

The tracks run along a time ruler. **Video**, **Audio**, **Titles** and **Captions** each have their own
colour. Pictures and video show as a strip of their frames, with their name and length.

- **Move the playhead** by selecting the ruler or any empty part of a track, or by dragging along the
  ruler. It follows playback and is kept in view.
- **Zoom** with the zoom buttons, the slider, **⌘ or Ctrl + scroll**, or **+** and **−**. **Fit** shows the
  whole timeline again.
- **Select** a clip to edit it in the inspector.
- **Drag** a clip to move it in time. It snaps to the edges of other clips and to the nearest tenth of a
  second, and can't go before 0. A small label shows its start and length.
- **Drag a picture past its neighbour** on the main video track to change the order: the track lays itself
  out end to end again. A drop that only half covers a neighbour goes back, so clips never overlap there.
- **Drag an edge** to trim. The left edge changes where the clip starts and how much of the source is
  used; the right edge changes how long it lasts. A clip can't be longer than its source allows, and not
  shorter than a tenth of a second.

Above the tracks:

- **Split** cuts the clip or title at the playhead into two. The second part carries on from where the
  first ended, so the picture and sound don't jump.
- **Delete** removes the selection and leaves a gap.
- **Ripple delete** removes it and moves everything after it on that track earlier, so there is no gap.

## Keyboard shortcuts

Select the keyboard button at the top for this list. Shortcuts don't work while you are typing in a field.

| Keys                    | Does                                     |
| ----------------------- | ---------------------------------------- |
| Space                   | Play or pause                            |
| ← →                     | Step one frame                           |
| ⇧ ← →                   | Jump one second                          |
| Home, End               | Go to the start or the end               |
| S                       | Split at the playhead                    |
| Delete                  | Delete the selection                     |
| ⇧ Delete                | Delete it and close the gap              |
| [ and ]                 | Nudge the selection by 0.1 seconds       |
| ⌘ Z, ⇧ ⌘ Z (Ctrl on PC) | Undo, redo                               |
| + and −, 0              | Zoom, and fit the timeline to the window |
| Esc                     | Clear the selection                      |

## Inspector

With nothing selected, the inspector shows the **Project**: the canvas size, the frame rate, the length
and how many clips and titles there are. Select an item to see its name and settings. Which settings depend
on what it is.

**Titles**: **Text**, **Style**, **Position**.

**Clips and pictures**:

- **Start (s)**, **Duration (s)** and, for video, **Trim in (s)**;
- **Volume**, for video and audio;
- **Fit**: **Cover**, **Contain** or **Fill**;
- **If the source is shorter**: **Stop at its end (trim)**, **Loop it**, **Hold the last frame**, **Slow it
  down to fit**;
- **Fade in (s)** and **Fade out (s)**;
- **Motion**: **None**, **Ken Burns (zoom and drift)**, **Zoom in**, **Pan**, and the **Motion strength**;
- **Transition in** and **Transition out**: how the clip arrives and how it leaves: **None**, **Crossfade**,
  **Slide** or **Wipe**, each with a **Length (s)**. The two can't add up to more than the clip, so a length
  is held to what the other end leaves;
- **Apply to all clips**: gives every other clip on the same track the same **Transition in** and
  **Transition out** as this one, including **None**. A clip too short to fit both gets them shortened.
  Audio is left alone.

- **Place in a box**: shows a picture or clip in a box on the frame instead of filling it (centred, half the
  frame), so it can be moved, resized and animated like a graphic. **Fill the frame** puts it back.

**Graphics and things placed in a box** (words, drawings and shapes, and pictures or clips in a box, such as
the ones [Compose Timeline](../stage-types/compose-timeline.md) places and rendered motion graphics):

- **Words**: the **Words**, **Letter size (px)**, **Colour**, **Font** (the theme's **Hand** and **Body** fonts,
  the timeline's library fonts, or **Other…** to type a family), **Weight** and **Line up**. Words in coloured
  parts also list the **Parts**, each with its own colour; changing the **Words** puts them back in one colour;
- **Drawing**: **Colour every line**, to give a drawing one colour; **Shape**: which **Shape**, and its **Colour**;
- **Box**: **X**, **Y**, **Width** and **Height** in pixels of the frame (or the world), **Turn (°)** and
  **Layer** (higher is on top). With a world, **Placed**: **On the screen** stays put, **In the world** moves
  with the camera;
- **Arrival**: **How it arrives** (**Draw on**, **Write out**, **Type**, **Pop**, **Fade**, **Slide**,
  **Highlight** or **Appear**; pictures and clips can pop, fade, slide or appear), how long it **Takes**, where
  a slide comes **From**, the **Pen** that follows lines being drawn, and for typed words a **Cursor**;
- **Remove moves**: drops the small moves an item makes after it arrives.

**Delete item** removes it. See [Timelines](./timelines.md) for what each setting does.

### Captions

Captions are shown a few words at a time, with the word being spoken highlighted. Select the **Captions**
track to change how they look and what they say.

**Template** is a gallery of looks, each shown as a small example you can compare at a glance. Choosing one
gives the captions its whole look: how the text is drawn, how the spoken word stands out, how many words
show at once and where they sit. It replaces any tweaks you made under **Look**, but keeps words you edited.

| Template        | Looks like                                                          |
| --------------- | ------------------------------------------------------------------- |
| **Clean**       | Readable text on a soft dark box; the spoken word turns yellow      |
| **Bold Pop**    | Large, heavy capitals with a thick black outline                    |
| **Karaoke**     | White text on a dark box; the spoken word sits on a purple box      |
| **Hype**        | Huge capitals, thick outline and a hard shadow, in the middle       |
| **Neon**        | Glowing cyan lettering with a hot-pink spoken word                  |
| **Minimal**     | Light, quiet text with a soft shadow; the spoken word is underlined |
| **Cinema**      | Italic serif subtitles like a film, with no highlight               |
| **Terminal**    | Green typewriter text on black; the spoken word is a green block    |
| **Sticker**     | Black capitals on a yellow label; the spoken word flips to black    |
| **Comic**       | Chunky yellow capitals with a drop shadow; the spoken word grows    |
| **Newsroom**    | A solid red band with left-aligned capitals                         |
| **Glass**       | A frosted box with crisp white text and an ice-blue spoken word     |
| **Highlighter** | White outlined text; the spoken word is marked in yellow            |

**Look** changes this captions item only, on top of its template:

- **Position**: **Top**, **Middle** or **Bottom**;
- **Spoken word**: how the word being spoken stands out: **Change colour**, **Highlight box**,
  **Underline**, **Grow** or **No highlight**;
- **Text colour** and **Highlight**, the colour of the spoken word;
- **Size**;
- **Words per page**, from 1 to 6;
- **Uppercase**.

**Reset** puts the look back to the template.

Templates use only fonts that every Reelcraft install has, so a template looks the same in the editor and in
the final video.

**Transcript** lists the captions page by page, each with the time it starts (select it to go there). The
page being spoken is outlined.

- Edit the text of a page to fix a word. If you keep the same number of words, each keeps its timing.
  Otherwise the page's time is shared among the new words.
- **Split page** cuts a page in two. **Merge with next page** joins it to the one after. **Delete page**
  removes it, so those words aren't shown.
- **Reset to transcript** throws away your edits and goes back to automatic pages.

Once you edit a page, **Words per page** no longer applies to it.

## Draft render

Select **Render draft** to turn your **saved** timeline into a real video, a little lower in quality so it
is quick, and watch it before you submit. Any changes not yet saved are saved first.

- **Rendering your draft…** shows how long it has been going. A render usually takes a minute or two, and
  the first one on a new install is slower while Reelcraft fetches the browser it draws with. **Cancel
  render** stops it.
- When it's done, the video plays in the window. **Open in a new tab** opens it on its own, and **Render
  again** makes a new one.
- If you've changed the timeline since, it says so: _You’ve changed the timeline since this was rendered._

Each editor keeps only its latest draft, and a draft is deleted with its run. It's free: it renders inside
Reelcraft. The final video is made by the [Render Timeline](../stage-types/render-timeline.md) stage.

## Submit timeline

When you're done, select **Submit timeline**. Reelcraft runs the [timeline checks](./timeline-checks.md)
again:

- If they pass, the run continues.
- If they don't, a red box lists what's wrong, for example _timeline.coverage: primary video track has gaps_,
  and you stay in the editor to fix it.
