/**
 * What each validator message means and how to fix it, for the assistant's `troubleshooting` guide
 * topic. `guide.test.ts` reads the validator's own source and fails when a message has no entry
 * here, so a new rule can't ship without telling the assistant what to do about it. `matches` are
 * fragments of the message text (the part that does not change); a name inside the message is
 * filled in at run time.
 */
export interface TroubleshootingEntry {
  matches: string[];
  means: string;
  fix: string;
}

export const TROUBLESHOOTING: TroubleshootingEntry[] = [
  {
    matches: ['a blueprint must declare at least one stage'],
    means: 'The draft has no stages.',
    fix: 'Add stages: start from a recipe (read_guide recipes).',
  },
  {
    matches: ['duplicate stage key'],
    means: 'Two stages share a key.',
    fix: 'Give every stage a unique short key. Renaming a key of a saved stage breaks references from old runs, so rename only the new one.',
  },
  {
    matches: ['is invalid on the first stage'],
    means: "The first stage reads {from:'prev'}, but nothing runs before it.",
    fix: 'Bind it to a run input, an asset, a const or memory instead, or move it later.',
  },
  {
    matches: [
      'A blueprint may declare at most one Character role',
      'must select a channel Character',
      'selects an unknown Character',
      'a Character that was deleted',
      'belongs to a different channel',
      'has no usable references',
      'must select at least one reference image',
      'is not usable for this Character',
      'is declared but never bound by any stage',
    ],
    means: 'The one Character role is incomplete or points at something that is not there.',
    fix: 'Declare at most one role. Set characterId to a ready Character of this channel and referenceBlobIds to at least one of its references: both come from get_channel_resources. You cannot create Characters or references: if none is ready, tell the user to add one in the channel. Bind the role to an image or video stage (`references` slot), or remove the role.',
  },
  {
    matches: ['unknown builtin check'],
    means: 'A check key does not exist.',
    fix: 'Use a key from list_checks.',
  },
  {
    matches: ['script check does not compile'],
    means: 'A script check has a JavaScript syntax error.',
    fix: 'Fix the code: it is the body of a function ending in `return { pass, message }`.',
  },
  {
    matches: ['wpm measures speaking pace'],
    means: 'The wpm check is on something other than a voice-over.',
    fix: 'Move wpm to an `audio.speech` stage, or use word_count on text.',
  },
  {
    matches: ['unknown capability', 'does not allow output kind'],
    means: 'The stage type does not exist here, or cannot produce that output kind.',
    fix: 'Use a key from list_capabilities and an output kind from get_capability allowedOutputs.',
  },
  {
    matches: ['a "data" output schema with no properties'],
    means: 'A data output has no declared fields.',
    fix: 'List every field later stages read, with a description, marked required (read_guide outputs).',
  },
  {
    matches: [
      'qc is not allowed on media.video output',
      'qc is not allowed on human.input',
      'Include transcript only works on an audio',
    ],
    means: 'QC is on an output or stage it does not support.',
    fix: 'Video output: use human approval instead of QC. human.input: use checks only. includeTranscript: only on audio output.',
  },
  {
    matches: [
      'stage declares neither checks nor qc',
      'video-modality stage declares neither checks nor approval',
    ],
    means: 'Nothing catches a bad result on this stage.',
    fix: 'Add a cheap check, a qc, or (for video) approval: see the quality topic.',
  },
  {
    matches: ['is unbound'],
    means: 'A required slot has no source.',
    fix: 'Bind it: slots come from get_capability. The bound value must fit what the slot accepts.',
  },
  {
    matches: ['incompatible source'],
    means:
      "The bound value's kind does not fit the slot (text into an image slot, a data field into a text slot).",
    fix: 'Bind a source of the right kind. A field of a data output is data: for a text slot, produce text in an earlier text stage.',
  },
  {
    matches: [
      'a video list needs a cardinality',
      'an image list needs a cardinality',
      "cardinality:'many' slot bound to a scalar source",
      "cardinality:'one' slot bound to an iterating producer",
      "cannot bind an iterating stage's output",
    ],
    means:
      'A many-slot got one value, or a one-slot got a list: what an iterating stage produces, or a video or image list.',
    fix: "Give a many-slot a list (an iterating stage's output saved to memory with writes {key:'$'}, read with {from:'memory'}). For a one-slot fed by an iterating stage, iterate this stage too with alignWith:'item', or read the list from memory.",
  },
  {
    matches: [
      'template references undeclared slot/context name',
      'output instructions reference undeclared slot/context name',
      'template path',
      'output instructions path',
    ],
    means:
      'A {{ name }} in a prompt is not a slot or context key of the stage, or the path into it does not exist.',
    fix: 'Declare the value under context (or slots), spell the name the same, and use paths that exist in its schema ({{ scene.visual }}). On an iterating stage bind {from:"item", path} in context and use that context name.',
  },
  {
    matches: [
      'a Character role may bind only to',
      'a Character role in Context must be attached',
      'a Character role may only bind to a reference slot',
    ],
    means: 'The Character role is bound somewhere it cannot go.',
    fix: "Bind {from:'role'} only to the `references` slot of an image or video stage, or to context of a text stage that lists the key in `attach`.",
  },
  {
    matches: ['references undeclared input'],
    means: 'enabledWhen names a run input that is not declared.',
    fix: 'Declare the input under inputs, or fix the key.',
  },
  {
    matches: ['which is conditionally enabled', 'written only by conditionally-enabled stage'],
    means: 'A stage reads the output of a stage that may be skipped.',
    fix: 'Give the reading stage the same enabledWhen as the skipped one.',
  },
  {
    matches: ['approval.mode "item" requires'],
    means: 'Per-item approval on a stage that does not iterate.',
    fix: 'Use approval mode "stage", or make the stage iterate.',
  },
  {
    matches: [
      'references unknown stage',
      'comes after this stage in the graph',
      'has no instructions template',
    ],
    means: 'onReject points at a missing or later stage, or at one with no prompt to improve.',
    fix: 'onReject.retryStageKey must be this stage or an earlier one, and that stage needs an instructions template so the rejection note can reach the next attempt.',
  },
  {
    matches: [
      'iterate.over a many-cardinality media source is not yet supported',
      'iterate.over does not narrow to an array schema',
      'iterate.over does not align with',
    ],
    means: 'iterate.over is not a list Reelcraft can loop over.',
    fix: "Have a data stage return an array field, write it to memory (writes {scenes:'scenes'}) and use over {from:'memory', key:'scenes'}. You cannot iterate over a set of files.",
  },
  {
    matches: [
      "alignWith:'item' requires this stage",
      "alignWith:'item' requires the previous stage",
    ],
    means: "alignWith:'item' is used without both stages iterating.",
    fix: 'Both stages must iterate over the same array; otherwise read the earlier stage through memory.',
  },
  {
    matches: ['bound to a required slot/context/check ref is always an error'],
    means: '{from:"prevItem"} has no value for the first item.',
    fix: 'Make the slot optional, or wrap it in a coalesce with a const for item 0.',
  },
  {
    matches: ['cannot be used while iterate.concurrency is above 1'],
    means:
      '{from:"prevItem"} needs the previous item to be finished, but items run at the same time.',
    fix: 'Stop binding prevItem in this stage, or set concurrency to 1 (items then run one at a time).',
  },
  {
    matches: ['is written by multiple stages'],
    means: 'Two stages write the same memory key.',
    fix: 'Use one writer per key: rename the keys.',
  },
  {
    matches: ['already exists in this channel'],
    means: 'Another blueprint in the channel has this name.',
    fix: "Choose another name (get_channel_resources lists the channel's other blueprints).",
  },
  {
    matches: [
      'does not support structured output',
      'is not available',
      'model discovery failed',
      'reasoning effort',
    ],
    means: 'The pinned model is not usable right now, or the effort is not one it supports.',
    fix: 'Pick a model from list_models (modality, dataOutput, not unavailable) and an effort from its supportedReasoningEfforts. If the provider is signed out, say what the user must reconnect in Settings. Do not give up data outputs: only OpenRouter models without structured output cannot write them.',
  },
  {
    matches: [
      'is not a Context binding of this stage',
      "so it can't be attached",
      "can't read",
      'attaches',
      'files but model',
    ],
    means:
      'An attached file is not a context entry, is not a file, or the model cannot read that kind or that many.',
    fix: 'Put the context key in `attach` only for file kinds; choose a model whose inputKinds include them (list_models) and mind its file limit.',
  },
  {
    matches: [
      'a role-consuming stage requires a pinned model',
      'for a role-consuming stage',
      'does not declare a reference limit',
      'does not support reference-image conditioning',
      'exceed',
    ],
    means: 'A stage that uses the Character needs a model that accepts reference images.',
    fix: 'Pin a model on that stage that supports reference images (list_models, inputKinds with media.image) and select no more references than its limit.',
  },
  {
    matches: [
      'a data output needs a schema with properties',
      'a text stage needs a system prompt',
      'a stage a model writes needs a check',
      'quality:',
    ],
    means: "One of the assistant's own quality rules, on a stage you added or changed.",
    fix: 'Do what the message says (full data schema; a system prompt on text stages; a check, qc or approval on every model stage) and read_guide quality. propose_draft refuses the draft until you do.',
  },
  {
    matches: ['quality (already in this blueprint)'],
    means:
      'The same kind of gap, but it was already in the blueprint before your change (a warning, not an error).',
    fix: "Don't widen a small request to fix it silently. Mention it in your reply and offer to add the missing system prompt, schema or check; fix it in the same proposal only when the user asked for a quality pass or you are rebuilding that stage.",
  },
];

/** Renders the entries as the guide topic's body. */
export function renderTroubleshooting(): string {
  return TROUBLESHOOTING.map(
    (e) =>
      `- ${e.matches.map((m) => `\`${m}\``).join(' · ')}\n  Meaning: ${e.means}\n  Fix: ${e.fix}`,
  ).join('\n');
}
