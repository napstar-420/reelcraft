import type { CreateBlueprintVersionDto } from '@reelcraft/shared';

/**
 * The assistant's authoring guide, served by the `read_guide` tool. It covers what the schemas and
 * the live registries can't say: how data flows between stages, the rules the validator enforces,
 * and what Reelcraft cannot do. `guide.test.ts` fails when a capability, builtin check, Ref kind or
 * artifact kind is missing from it, and when an example stops validating, so a new stage type
 * can't ship without teaching the assistant about it.
 *
 * Facts that change with the install (which models exist, which assets and Characters the channel
 * has, each capability's config schema and slots) are NOT here: the assistant reads them with tools.
 */
export interface GuideSection {
  title: string;
  body: string;
}

export const GUIDE: Record<string, GuideSection> = {
  overview: {
    title: 'How a blueprint works',
    body: `A blueprint is a recipe for a video: an ordered list of **stages** (\`graph\`), the **inputs** a run asks for, an optional **role** (a channel Character), a **defaults** layer and a **budget** (\`runCapUsd\`).

- A run executes the stages one at a time, in order. Nothing runs in parallel.
- Each stage has a type (\`capability\`), \`slots\` (the inputs the type asks for), \`context\` (extra values for the prompt), an \`output\` and optional checks, quality control, approval, iterate and enabledWhen.
- Stage \`key\`s must be unique. Pick short descriptive keys such as \`script\`, \`scenes\`, \`images\`, \`voice\`. Once saved, runs refer to a stage by its key, so don't rename keys of existing stages without a reason.
- Always send the COMPLETE draft (every stage, inputs, roles, defaults, budget). A draft is not a patch.
- Only these top-level draft fields exist: graph, inputs, roles, defaults, budget. Only the stage fields in the tool schema exist. Invented fields are rejected.
- Saving a version is the user's job. You propose a draft; the user (or auto-apply) puts it on the canvas.
- Keep the user's existing stages unless they ask to change them: start from the draft that \`get_blueprint\` returns.
- The usual end-to-end shape: plan scenes (\`text.generate\`, data) → write script (\`text.generate\`) → make visuals per scene (\`image.generate\`/\`video.generate\` with iterate) → voice-over (\`audio.speech\`) → word timings (\`media.analyze\`) → assemble (\`timeline.render\` or \`video.concat\`) → human approval. The last stage that makes a video is the run's final video, so end the graph with it.`,
  },

  'stage-types': {
    title: 'Stage types (capabilities)',
    body: `Use \`list_capabilities\` for the live list and \`get_capability\` for one type's config schema, slots and allowed outputs. Never use a key that isn't listed. What each does:

- \`text.generate\`: an LLM writes \`text\`, \`data\` (needs a schema) or a \`timeline\`. Files bound under context and listed in \`attach\` are sent to the model.
- \`image.generate\`: an image from a prompt (\`media.image\`); optional \`references\` slot (images, a Character role).
- \`video.generate\`: a video clip (\`media.video\`); optional \`startFrame\`, \`endFrame\`, \`references\` slots.
- \`audio.speech\`: text to voice-over (\`media.audio\`); required \`text\` slot.
- \`media.analyze\`: transcribes speech with word timings (paid, Deepgram) or probes a file; \`data\` output; required \`source\` slot (audio or video).
- \`video.concat\`: joins clips end to end with optional crossfade, replacement audio and burned-in subtitles; free, local.
- \`timeline.render\`: renders a \`timeline\` into a finished video; free, local.
- \`subtitles.export\`: SRT or VTT file (\`file.subtitles\`) from word timings; free.
- \`human.input\`: pauses the run for a person to type or paste text or data.
- \`human.timeline_edit\`: pauses for a person to edit a timeline in the timeline editor.
- \`browser.automate\`: Codex uses a signed-in browser to do a task; \`data\` output. Uses the user's accounts: only if they ask for it.
- \`browser.flow_video\`: makes clips in Google Flow with Codex and the user's Flow accounts (\`media.video_list\`). Only if they ask for it.
- \`publish.stub\`: a placeholder that publishes NOTHING. Never describe it as publishing.

An output kind must be one the capability allows (\`get_capability\` → allowedOutputs). Output kinds: \`data\`, \`text\`, \`media.image\`, \`media.video\`, \`media.audio\`, \`media.video_list\`, \`file.subtitles\`, \`timeline\`. A new stage's output must be one of the capability's allowed kinds.`,
  },

  refs: {
    title: 'Connecting stages: Refs (slots and context)',
    body: `Every slot and context entry is a Ref saying where its value comes from:

- \`{from:'prev', path?, alignWith?:'item'}\`: the previous stage's output. Invalid on the first stage. A \`path\` picks one field of a \`data\` output; the field is still \`data\`, so a text field of a data output can NOT feed a \`text\` slot. Only a stage whose output is \`text\` can.
- \`{from:'memory', key, path?}\`: a value an earlier stage saved with \`writes\`. \`prev\` only reaches one stage back; use memory for anything further.
- \`{from:'input', inputKey, index?, path?}\`: a run input declared in \`inputs\`. \`index\` (from 0) picks one file of a many-file input.
- \`{from:'asset', assetId}\`: a channel asset. Get ids from \`get_channel_resources\`; never invent one.
- \`{from:'role', roleKey}\`: the blueprint's Character role. Only valid on a many-cardinality image \`references\` slot, or in context of a text stage with the key listed in \`attach\`.
- \`{from:'item', path?}\`: the current item, on a stage with \`iterate\`.
- \`{from:'prevItem', path?}\`: this stage's output for the previous item, on a stage with \`iterate\`. At item 0 it has no value, so any required slot bound to it is an error: make that slot optional or wrap it in coalesce.
- \`{from:'const', value}\`: a fixed value.
- \`{from:'coalesce', refs:[…]}\`: the first of several refs (at least 2) that has a value, e.g. prevItem then const. All branches must be the same kind.

Slot rules the validator enforces:
- A required slot must be bound (\`required slot "x" is unbound\`).
- The bound value's kind must fit the slot's accepts (\`incompatible source\`). Text into an image slot is an error.
- A cardinality 'one' slot can't read an iterating stage's output directly: iterate this stage too with \`alignWith:'item'\` on the prev ref, or read the outputs through memory.
- A many-cardinality slot can't be bound to a single scalar value.
- If a stage is conditionally enabled (\`enabledWhen\`), a later stage reading its output through prev or memory must have the same enabledWhen.

**Memory writes**: \`writes: { "<memoryKey>": "<path into output>" }\`; the path \`$\` saves the whole output; media can only be saved whole. A memory key may be written by ONE stage only. On a stage with iterate, each item writes its own value and a later reader gets them all as a list, in item order.

**Context** values are used in prompts as \`{{ key }}\`. Attaching a file: put the context key in \`attach\` (text.generate only); then the model sees the file itself. Without \`attach\` the model only gets the file's details (id, kind).`,
  },

  templates: {
    title: 'Prompts and templates',
    body: `\`instructions: { system?: string, template: string }\` on stages that call a model (\`text.generate\`, \`image.generate\`, \`video.generate\`, \`browser.automate\`; \`audio.speech\` speaks its \`text\` slot).

- \`system\` is sent as written, before the template. \`{{ }}\` values are NOT filled in there. Every \`text.generate\` stage needs one (propose_draft refuses one without): see the \`quality\` topic for what goes in it.
- \`template\` is the task. \`{{ name }}\` is replaced by a slot name or a context key; use dots and positions for fields: \`{{ idea.title }}\`, \`{{ scenes[0].narration }}\`. That's the whole language: no conditions, no loops, no formulas. Objects and lists are inserted as formatted JSON.
- Every name used must be a declared slot or context key of that stage (\`template references undeclared slot/context name\`) and every path must exist in the value's shape. The one extra name is \`priorCritique\`: on a retry it holds the reasons the last attempt was rejected. If you don't write it, Reelcraft appends the reasons itself.
- On an iterating stage the current item is NOT available as \`{{ item }}\`; bind a context entry to \`{from:'item', path:'visual'}\` and write \`{{ visual }}\`.
- \`output.instructions\` (text and data outputs, up to 4000 characters) guides the content and style of the result and uses the same \`{{ }}\` values.
- Some capabilities own their system prompt (\`lockedSystemPrompt\` in get_capability); and some require a template (\`requiresTemplate\`).
- Say what you want, in order, and the format of the answer. Put what never changes in system and what varies per run in the template with \`{{ }}\`.`,
  },

  outputs: {
    title: 'Outputs and data schemas',
    body: `\`output\` is one of: \`{kind:'text'}\`, \`{kind:'data', schema}\`, \`{kind:'timeline'}\`, \`{kind:'media.image'|'media.video'|'media.audio'|'media.video_list', constraints?}\`, \`{kind:'file.subtitles'}\`. The capability must allow the kind.

A \`data\` output needs a JSON Schema describing its shape (and should have \`properties\`, otherwise there's a warning). Later stages pick fields by \`path\`. The schema is a deliberately small subset: \`type\` (object, array, string, number, integer, boolean), \`description\`, \`enum\`, \`properties\`, \`required\`, \`items\`, \`minItems\`, \`maxItems\`, \`minimum\`, \`maximum\`, \`minLength\`, \`maxLength\`. NOT allowed: \`$ref\`, \`oneOf\`, \`anyOf\`, \`allOf\`, \`patternProperties\`, \`if/then/else\`, \`additionalProperties\`. For a choice between shapes use one object with optional fields or an enum.

Mark the fields later stages need as \`required\`, and add a \`description\` to each field: the model reads them. Every data output must have \`properties\` (propose_draft refuses one without).

\`media.analyze\` writes a fixed shape, so declare it rather than an empty schema:
- \`transcribe_align\` (default): \`{ transcript: string, durationSec: number, sentences: [{text, startSec, endSec}], words: [{text, startSec, endSec, confidence?}] }\`; require \`transcript\`, \`durationSec\`, \`words\`.
- \`probe\`: \`{ container: string, durationSec: number, streams: [{type: 'video'|'audio', codec, width?, height?, fps?, sampleRate?}] }\`.

\`media\` outputs accept optional \`constraints\` ({durationSec:{min,max}, aspectRatio, minWidth, audio:'required'|'optional'|'forbidden'}). A \`timeline\` output makes a text.generate stage plan an edit (tracks, clips, text, captions) that \`timeline.render\` or \`human.timeline_edit\` can use; the model writing it learns the timeline format from the engine, you don't describe it.`,
  },

  iterate: {
    title: 'Iterate, enabledWhen and approval',
    body: `**iterate**: \`{ over: Ref, itemAlias: string, itemRetryLimit: number, maxItems?: number }\` runs the stage once per item of a list, one after another, in order (item i may use item i-1 through \`prevItem\`). Never in parallel.
- \`over\` must resolve to an array. The reliable way: the producing stage writes the list to memory (\`writes: {"scenes":"scenes"}\`) and \`over\` is \`{from:'memory', key:'scenes'}\`. \`{from:'prev'}\` works only when the previous stage's WHOLE output is an array; \`prev\` with a path into a field is rejected (\`iterate.over does not narrow to an array schema\`).
- Iterating over a many-cardinality set of media files is not supported. \`groupKey\` is reserved and ignored: don't set it.
- Use the current item by binding context or a slot to \`{from:'item', path}\`.
- To use item N of an earlier iterating stage in item N of this one, iterate over the same list and put \`alignWith:'item'\` on the prev ref and on the iterate. Otherwise read through memory (a list).
- \`maxItems\` caps items (built-in cap 50). A failed item fails the stage; finished items are kept on resume.

**enabledWhen**: \`{ input: '<inputKey>', equals: string|number|boolean }\` skips the stage unless the run's input equals the value (exact comparison; a missing input skips). The input must be declared. Stages after a skipped stage still run, so those reading its output need the same enabledWhen. This is the ONLY branching Reelcraft has.

**approval**: \`{ mode: 'stage'|'item', onReject?: { retryStageKey } }\` pauses the run for the user to approve or reject. \`item\` mode needs \`iterate\`. A rejection note goes to the next attempt's prompt. \`onReject.retryStageKey\` must be this stage or an EARLIER one and should have an instructions template. Approval is how video outputs are controlled, because QC isn't available on video: video stages should declare approval (otherwise a warning).`,
  },

  'checks-qc': {
    title: 'Checks, quality control and retries',
    body: `**checks** are free, automatic pass/fail tests on a stage's output; ALL must pass. A failed check makes the stage regenerate with the failure messages as feedback, up to \`checkMaxAttempts\` (default 3). Two kinds:
- builtin: \`{type:'builtin', key, params}\`. Keys come from \`list_checks\` (with each params schema). Text checks (\`non_empty\`, \`word_count\`, \`regex_match\`, \`regex_absent\`, \`wpm\`) read a text output without a path; for a data output give \`path\` to the text field. \`numeric_range\` and \`array_length\` need a \`path\`. \`duration_range\` and \`media_format\` read a media file's probe. \`wpm\` only works on an \`audio.speech\` (media.audio) output.
- script: \`{type:'script', name, code, refs?}\`: JavaScript that is the body of a function ending in \`return {pass, message?}\`; it can read \`artifact\` (kind, data, probe; a text output's text is \`artifact.data.text\`) and \`refs\`. It runs in a locked sandbox: no files, network or I/O. It must compile.
A \`data\` output is always checked against its schema first.

**qc** (AI quality control): \`{criteria, threshold (0-100), model:{provider, modelId, params}, includeInputs, maxAttempts?, onExhausted?:'fail'|'human_review', dimensions?:[{key, description, weight}], media?:{includeTranscript}}\`. A judge model scores the output and below the threshold the stage regenerates with its critique. It costs money: use it only for what a check can't measure. NOT allowed on \`media.video\` output (use approval) or on \`human.input\`. \`includeTranscript\` only on audio. The QC model is chosen explicitly and does not use defaults.

**Three different retry budgets**, never mix them up:
- \`retryLimit\` (and \`iterate.itemRetryLimit\`): retries after a CRASH only (provider error, timeout).
- \`checkMaxAttempts\`: feedback rounds after failed checks.
- \`qc.maxAttempts\`: feedback rounds after a low QC score.
A human rejection uses none of them.

Every stage a model writes needs at least one check, a qc or an approval (propose_draft refuses one with none; the validator itself only warns). Cheap checks first for what can be measured (length, counts, format, duration, pace); QC for what only judgement can measure (story, hook, tone, likeness, style). See the \`quality\` topic for where each belongs.`,
  },

  models: {
    title: 'Models and defaults',
    body: `Stages that call a provider need a model from somewhere, in this order: the stage's own \`model\` pin, the blueprint's \`defaults.models.<kind>\`, the channel's defaults. **Reelcraft does not warn when a model-using stage has no model and no default**: the blueprint looks runnable and the run fails later with \`ProviderRegistry: unknown provider "undefined"\`. So make sure every text, image, video and audio stage resolves a model: check the channel defaults (\`get_channel_resources\`) and the blueprint's \`defaults\`, and set \`defaults.models\` or a stage \`model\` if neither covers it.

- Use ONLY provider ids and model ids that \`list_models\` returns, and only those with the needed modality that aren't marked unavailable. Never invent a model id. If nothing suitable is available, say so and ask the user.
- A pin is \`{ provider, modelId, version?, params }\`. On a stage every field is optional (a partial pin overrides just those fields). \`defaults.models\` is a map from kind of work (\`text\`, \`image\`, \`video\`, \`audio\`, \`media\`, \`browser\`, \`compute\`, \`human\`, \`publish\`) to a partial pin.
- \`params\` are provider-specific: Codex and ChatGPT use \`reasoningEffort\` (one of the model's supported efforts from \`list_models\`); ChatGPT also \`webSearch\`. Don't invent other params; use \`{}\` if unsure.
- A \`data\` (or \`timeline\`) output needs a model whose \`dataOutput\` is true in \`list_models\`. Codex, ChatGPT and fake models all can: they reply in JSON that Reelcraft parses and checks against your schema, retrying on a mismatch. Only OpenRouter models without native structured output can't (the validator rejects them). Never avoid \`data\` or hard-code a fixed number of stages because of the model: check \`dataOutput\`.
- A text stage that attaches files needs a model whose \`inputKinds\` include those file kinds. A QC judge looks at the output itself, so for images pick a judge whose \`inputKinds\` include \`media.image\`.
- The \`fake\` provider returns free placeholder results: fine for trying a blueprint, but say so when you use it.
- \`defaults\` (ConfigLayer) may also set \`retryLimit\`, \`qc\`, \`budget\` (runCapUsd, stageCapUsd), \`iterate\`, \`format\` (aspectRatio, resolution, fps, targetDurationSec), \`provider.preferred\` and \`polling\`. Layers merge engine → channel → blueprint → stage, and the more specific wins.`,
  },

  'inputs-roles': {
    title: 'Run inputs, roles and budget',
    body: `**inputs**: what a run asks for. \`{ key, label, required, accepts }\` where \`accepts\` is \`{kind:'text'}\`, \`{kind:'data', schema}\`, or \`{kind:'media.image'|'media.video'|'media.audio', cardinality:'one'|'many'}\`. Keys are unique. Bind a stage to one with \`{from:'input', inputKey}\`. Use inputs for what changes run to run (topic, tone, a photo); put constants in the prompt.

**roles**: at most ONE. \`{ key, label, required, characterId?, referenceBlobIds? }\`. It selects a channel Character (take the id from \`get_channel_resources\`; the Character must be ready, with usable references, and in this channel) and at least one of its reference images. Bind it with \`{from:'role', roleKey}\` to a many-cardinality image \`references\` slot. A declared role that no stage binds only gets a warning. You can't create Characters.

**budget**: \`{ runCapUsd }\`, the usual spending limit for a run (the run dialog starts from it). Choose a sensible cap for the paid stages (an all-fake or all-free blueprint can use a small cap).`,
  },

  timelines: {
    title: 'Assembly and timelines',
    body: `Two ways to finish a video, both free and local:
- \`video.concat\`: joins clips in order (\`clips\` slot, many; optional \`audio\` replacement and \`subtitles\` file). Choose it when every clip is already right and you only need order plus sound.
- \`timeline.render\`: renders a \`timeline\` (required \`timeline\` slot) with several tracks: video, audio, overlay, captions; titles, lower thirds, styled captions, image motion, transitions, fades. The timeline comes from a \`text.generate\` stage with a \`timeline\` output, from \`human.timeline_edit\`, or both (the model drafts, the person polishes). The stage that plans the timeline needs the media it should place bound in \`context\` (files as context entries, handles not attached); captions need word timings from \`media.analyze\`.
Caption and text styles are the ids from \`list_styles\`; never invent a style id.

The run's final video is the output of the LAST stage (in graph order) that makes a video, so put the assembly stage last, and consider approval on it.`,
  },

  quality: {
    title: 'Building a high-quality blueprint',
    body: `Read this before proposing a new blueprint or a big change. The user expects you to know Reelcraft better than they do: apply all of it without being asked, and say in your summary which quality controls you added.

**Prompts**
- Every \`text.generate\` stage gets a \`system\` prompt: who the writer is, the audience, voice and tone, hard rules (length, language, what to avoid), and how to treat \`priorCritique\` on a retry. It never changes between runs, so put it in system, not the template.
- The \`template\` is the per-run task: the inputs (\`{{ topic }}\`), what to produce, in order.
- Use \`output.instructions\` for the shape and style of the answer (what each field should contain, reading level, formatting).
- Image and video prompts: describe subject, composition, lighting, style and aspect in the template; keep the style words identical on every iterated item so images match; bind the Character role to \`references\` when a recurring character appears.

**Outputs**
- Prefer \`data\` with a full schema for every text stage whose result has structure or is read by field (plans, scene lists, stories with parts, metadata). Use \`text\` only when the result is one piece of prose that a later stage needs as text (an \`audio.speech\` text slot) and \`timeline\` only for a timeline.
- A field of a \`data\` output can't feed a \`text\` slot. When the narration lives in a data output, the narration stage is a \`text.generate\` with \`text\` output that reads the data and writes the spoken script.
- Lists that vary in length (scenes, shots) are an array field with \`minItems\`/\`maxItems\`, written to memory and consumed by ONE stage with \`iterate\`. Never make N copies of a stage for N items.

**Quality control belongs on the stage that produces the work**
- Don't add a separate "critique", "review" or "evaluate" text stage followed by a "revise" stage. Put \`qc\` on the producing stage instead: the judge scores it, and below the threshold the same stage regenerates with the critique in \`priorCritique\`, up to \`qc.maxAttempts\`. That is cheaper, automatic, and the next stage always gets the improved version. Add a separate critique stage only if the user wants to read the critique itself.
- Give QC concrete \`criteria\` and, for creative work, \`dimensions\` with weights (e.g. hook, clarity, pacing, payoff). Threshold 70-85; \`maxAttempts\` 2-3; \`onExhausted: 'human_review'\` when a person should decide rather than fail the run. \`includeInputs: true\` so the judge sees what was asked.
- QC costs a judge call per attempt: use it on the stages where quality matters most (the story or script, key images such as a character reference, the timeline plan), and cheap checks everywhere else.
- Checks on every model stage: \`non_empty\`/\`word_count\` on text, \`array_length\` on lists, \`numeric_range\` on numbers, \`duration_range\` and \`wpm\` on voice-over, \`duration_range\` on video.
- Human \`approval\` before expensive media (after the script, before images, video and voice) and on the final video. Video output can't have QC, so approval is its quality control.

**Models and cost**
- Set \`defaults.models\` per kind once; pin a stage only when it needs a different model. The QC \`model\` is always explicit.
- A cheap fast model is fine for formatting steps; use the strongest available model for the creative stages and for QC judges.
- Set \`budget.runCapUsd\` to cover the paid stages, their retries and QC attempts.

**Before you propose**, check every stage: system prompt (text stages), full schema (data outputs), at least one check, qc or approval (model stages), iterate instead of copies, approval before paid media. validate_draft reports the rules propose_draft enforces as errors starting with "quality:".

QC block shape: \`{ criteria, threshold, model: { provider, modelId, params }, includeInputs, maxAttempts?, onExhausted?: 'fail'|'human_review', dimensions?: [{ key, description, weight }] }\` (model ids from list_models).`,
  },

  limits: {
    title: 'What Reelcraft cannot do',
    body: `If the user asks for any of these, do NOT build something that pretends to do it. Say plainly that Reelcraft can't, why, and suggest the closest thing that works.

- **Publish or upload anywhere** (YouTube, TikTok, Instagram…): \`publish.stub\` is a placeholder that does nothing.
- **Parallel work**: stages run strictly one after another, and iterate items too.
- **Branching**: the only conditional is \`enabledWhen\` (a run input equals a value). No if/else, loops over stages, or computed conditions.
- **Iterate** over a many-cardinality media set, or use \`groupKey\` (ignored); \`iterate.over\` must be an array from memory or a whole-output array from prev.
- **QC on video output or on \`human.input\`** (use approval); QC \`includeTranscript\` outside audio.
- **More than one role**, or creating Characters, uploading or editing assets, changing channel defaults, provider keys or Settings: you can only reference what exists. Tell the user to add it in the app.
- **Running, dry-running, saving or approving**: you only propose drafts and metadata changes; the user saves and runs.
- **JSON schemas beyond the small subset** (\`$ref\`, \`oneOf\`, \`anyOf\`, \`allOf\`, \`additionalProperties\`, …).
- **Template logic**: \`{{ }}\` only inserts values: no conditions, loops, formulas, and no \`{{ item }}\`.
- **\`prev\` on the first stage**, \`prevItem\` or \`item\` outside an iterating stage, a memory key written by two stages.
- **Anything about a model, style, check, asset or capability that the tools don't list.** Don't guess and don't use training knowledge about what Reelcraft "probably" has: look it up, and if it isn't there, it doesn't exist in this install.
- Seeing run results, costs or the web: you can't. You only know what the tools return.`,
  },

  examples: {
    title: 'Worked examples',
    body: `Small valid drafts to copy the shape from (models omitted: set them as described in the models topic).

1) A short script with a length check.
\`\`\`json
${JSON.stringify(exampleScript(), null, 2)}
\`\`\`

2) A plan, then one image per scene (iterate over memory), each image approved by a person.
\`\`\`json
${JSON.stringify(exampleScenesToImages(), null, 2)}
\`\`\`

3) Script, voice-over with a pace check and human approval.
\`\`\`json
${JSON.stringify(exampleVoiceover(), null, 2)}
\`\`\``,
  },
};

export const GUIDE_TOPICS = Object.keys(GUIDE);

export function readGuide(topic: string): GuideSection | undefined {
  return GUIDE[topic];
}

/** The index returned when the assistant asks for the guide without a valid topic. */
export function guideIndex(): Array<{ topic: string; title: string }> {
  return Object.entries(GUIDE).map(([topic, section]) => ({ topic, title: section.title }));
}

export function exampleScript(): CreateBlueprintVersionDto {
  return {
    graph: [
      {
        key: 'script',
        label: 'Write script',
        capability: 'text.generate',
        instructions: {
          system: 'You write short, punchy scripts for vertical video.',
          template: 'Write a 30-second voice-over script about {{ topic }}.',
        },
        config: {},
        slots: {},
        context: { topic: { from: 'input', inputKey: 'topic' } },
        output: { kind: 'text' },
        checks: [{ type: 'builtin', key: 'word_count', params: { min: 50, max: 90 } }],
      },
    ],
    inputs: [{ key: 'topic', label: 'Video topic', required: true, accepts: { kind: 'text' } }],
    roles: [],
    defaults: {},
    budget: { runCapUsd: 2 },
  };
}

export function exampleScenesToImages(): CreateBlueprintVersionDto {
  return {
    graph: [
      {
        key: 'plan',
        label: 'Plan scenes',
        capability: 'text.generate',
        instructions: {
          system:
            'You plan short vertical videos. Each scene is one idea, 4-8 seconds of narration, with a concrete visual a camera could film.',
          template: 'Plan the scenes for a short video about {{ topic }}.',
        },
        config: {},
        slots: {},
        context: { topic: { from: 'input', inputKey: 'topic' } },
        output: {
          kind: 'data',
          schema: {
            type: 'object',
            properties: {
              scenes: {
                type: 'array',
                minItems: 3,
                maxItems: 6,
                items: {
                  type: 'object',
                  properties: {
                    narration: { type: 'string', description: 'What is said in this scene' },
                    visual: { type: 'string', description: 'What the picture shows' },
                  },
                  required: ['narration', 'visual'],
                },
              },
            },
            required: ['scenes'],
          },
        },
        writes: { scenes: 'scenes' },
        checks: [
          { type: 'builtin', key: 'array_length', params: { path: 'scenes', min: 3, max: 6 } },
        ],
      },
      {
        key: 'images',
        label: 'Scene images',
        capability: 'image.generate',
        instructions: { template: '{{ visual }}' },
        config: {},
        slots: {},
        context: { visual: { from: 'item', path: 'visual' } },
        output: { kind: 'media.image' },
        iterate: {
          over: { from: 'memory', key: 'scenes' },
          itemAlias: 'scene',
          itemRetryLimit: 1,
        },
        checks: [],
        approval: { mode: 'item' },
      },
    ],
    inputs: [{ key: 'topic', label: 'Video topic', required: true, accepts: { kind: 'text' } }],
    roles: [],
    defaults: {},
    budget: { runCapUsd: 3 },
  };
}

export function exampleVoiceover(): CreateBlueprintVersionDto {
  return {
    graph: [
      {
        key: 'script',
        label: 'Write script',
        capability: 'text.generate',
        instructions: {
          system:
            'You write voice-over scripts for vertical video: spoken English, short sentences, a hook in the first line, no stage directions.',
          template: 'Write a 30-second voice-over script about {{ topic }}.',
        },
        config: {},
        slots: {},
        context: { topic: { from: 'input', inputKey: 'topic' } },
        output: { kind: 'text' },
        writes: { script: '$' },
        checks: [{ type: 'builtin', key: 'non_empty', params: {} }],
      },
      {
        key: 'voice',
        label: 'Voice-over',
        capability: 'audio.speech',
        config: {},
        slots: { text: { from: 'memory', key: 'script' } },
        context: {},
        output: { kind: 'media.audio' },
        checks: [{ type: 'builtin', key: 'wpm', params: { min: 110, max: 170 } }],
        approval: { mode: 'stage' },
      },
    ],
    inputs: [{ key: 'topic', label: 'Video topic', required: true, accepts: { kind: 'text' } }],
    roles: [],
    defaults: {},
    budget: { runCapUsd: 2 },
  };
}
