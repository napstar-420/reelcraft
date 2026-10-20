# ADR 0017: Motion graphics are model-written Remotion clips

- Status: accepted
- Date: 2026-10-20

## Context

Videos need motion graphics: animated titles, charts that grow, counters, diagrams that build, lower thirds,
callouts and transitions. ADR 0015 says that motion should come from Remotion through one generic stage, with
no hand-built item per effect.

There were two ways to bring a model's motion into a video:

- **A clip.** The model writes a Remotion component, and Reelcraft renders it to a video placed on the
  timeline like any other.
- **Embedded code.** The component goes into the timeline and is bundled into the final render.

There were also two kinds of model:

- Plain text models, which can only answer with code.
- The agent CLIs (Codex, Claude), which can also run commands and look at pictures.

## Decision

**Two generic stages, clips first.**

- `motion.generate` (Generate Motion Graphic) has a text model write one Remotion component. Its output is a
  `MotionSource` (`data`): the code, size, frame rate, length, background, props and the files it may load.
- `motion.render` (Render Motion Graphic) renders a `MotionSource` with the render worker's new `motion` mode,
  and outputs `media.video`. It is free and local.

Splitting the two keeps the existing tools working on each half: checks, approval, editing and re-rendering.
Compose Timeline places the clip like any video, so the timeline format doesn't change. Embedding code in the
timeline can come later, once clips have shown what models write well.

**Transparency.**

- A transparent graphic renders as VP9 WebM with `yuva420p`.
- An opaque one renders as h264 MP4.

We checked this with a real render. The composition's `@remotion/media` `<Video>` keeps the alpha channel: red
under a transparent clip shows through in the final render. A clip renders the same pixels every time.

**What the code may do.**

- One TSX module with a default export.
- Imports only from `react`, `remotion`, `@remotion/paths`, `@remotion/shapes`, `@remotion/transitions`,
  `@remotion/noise` and `@remotion/animation-utils`, all pinned at 4.0.526.
- No network, storage, `eval`, raw HTML, scripts or frames.
- Nothing that makes renders differ: no `Math.random`, clock, timers or CSS animations.

`motion-code-check.ts` enforces these rules with esbuild's `transformSync`, so comments and types are gone
before the rules are applied. It runs:

- as the `motion_code` built-in check, whose failure message goes back to the model through
  `checkMaxAttempts`;
- again before `motion.render` spawns a job.

The bundle also refuses any import outside the allowlist, so an import the check missed fails the build
instead of loading. The page runs in headless Chrome with only the local bundle and the files it was given.

**Every text model can write it; agents also test their work.** `motion.generate` sends an ordinary text
request with structured output, so OpenRouter, ChatGPT, Codex, Claude and the fake provider all work. A request
also carries the job-folder parameters the agent CLIs already use for code jobs (the Blender scene stages,
ADR-less in #180): `__workspace` (files for the folder), `__allowedCommands` (the only commands the agent may
run) and `__workspaceInstructions` (how to use them). One mechanism, not two.

- **Codex and Claude** (`CliJobProviderAdapter`) write the files into their job folder, and the prompt says
  how to use them. Claude gets file tools and `Bash` limited to the allowed commands.
- **Other providers** ignore them. OpenRouter no longer forwards any param starting with `__`.

For a motion graphic the workspace holds:

- `GUIDE.md`: the same rules as the prompt;
- `Motion.tsx`: a starting example;
- `check.mjs`: runs the checker, renders stills of the start, middle and end through the render worker, and
  lists them for the agent to look at.

`fake-text-*` answers a motion request with a sample graphic, so tests and dry runs are free.

## Consequences

- Any motion the model can write is available without new code: no effect list to maintain.
- Motion clips are silent, so `motion.render` outputs don't require an audio stream by default (other video
  outputs still do).
- The render worker now depends on the allowed `@remotion/*` packages, React and React DOM, all in the app
  bundle. The Docker image already has Chrome, Node and the bundler, so `RUNTIME_VERSION` is unchanged.
- Rendering a graphic bundles it with webpack each time, which takes a few seconds before the frames render.
- The workspace has been run by hand, the way an agent would. A real Codex or Claude job using it has not
  been run yet. Inside Codex's sandbox, Chrome and the temp folder may need adjusting; `check.mjs` already
  points `TMPDIR` at the job folder.
- Not done here: code embedded in the timeline, a live code editor with a preview, and font upload. (All
  three followed; see the addendum.)

## Addendum: embedded motion (2026-10-21)

A motion graphic can now also go into the timeline as code: a `motion` item (overlay tracks, version 2) with the
graphic's code, size, props and files, and an optional box on the screen. When a timeline has motion items, the
render worker writes each item's code to its own file and bundles a generated entry that registers the timeline
composition with those components (`timelineRootWith`), under the same import allowlist. Each item is drawn
inside `<Sequence width height durationInFrames>`, so `useVideoConfig()` in the code reports the graphic's own
size and length, and scaled into its box. Its files are copied in under the names the code loads; two graphics
loading different files under one name are refused. `timeline.motion_code` checks the code with the other
timeline checks. Compose Timeline places one with a `motion` layer. The browser preview can't bundle code, so
it shows a placeholder; draft and final renders draw it. Timelines without motion items bundle as before.

Clips stay the right choice when a graphic should be checked, approved or reused on its own; embedding saves
a render per graphic and draws at the video's own resolution.
