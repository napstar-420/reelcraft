---
title: Checks
description: Add automatic pass-or-fail tests to a stage, so a bad output is caught and redone before the run moves on.
---

A **check** is an automatic test on a stage's finished output, such as "the script is between 60 and
90 words" or "the video is at most 30 seconds long". If a check fails, Reelcraft makes the stage try
again, telling it what went wrong, instead of passing a bad result to the next stage.

Checks are free: they run inside Reelcraft and never call an AI service. For a judgement a test can't
make, such as "is this script funny?", use [quality control](./quality-control.md) as well.

## Add a check

1. Open the stage and go to **Checks & Quality control** → **Checks**.
2. Select **+ Add builtin check** or **+ Add script check**.
3. Fill it in, as described below.

Select **Remove check** to delete one. A stage can have as many checks as you like, and **all** of
them must pass.

## Builtin checks

Choose the check under **Select a builtin check…**, then fill in its settings. Most checks look at a
**path**: where in the output to look. Leave the path empty to check the whole output. See
[Paths](./connecting-stages.md#paths).

| Check            | What it tests                                                       | Settings                         |
| ---------------- | ------------------------------------------------------------------- | -------------------------------- |
| `non_empty`      | The value isn't empty: not blank text, an empty list or an empty object | `path` (optional)            |
| `word_count`     | The number of words in some text                                    | `path`, `min`, `max`             |
| `regex_match`    | The text matches a pattern                                          | `pattern`, `flags`, `path`       |
| `regex_absent`   | The text does **not** match a pattern, such as a banned word        | `pattern`, `flags`, `path`       |
| `numeric_range`  | A number is between a minimum and a maximum                         | `path` (required), `min`, `max`  |
| `array_length`   | A list has between a minimum and a maximum number of items          | `path` (required), `min`, `max`  |
| `duration_range` | A video's or audio's length, in seconds                             | `min`, `max`                     |
| `media_format`   | A media file's container (such as `mov,mp4,m4a,3gp,3g2,mj2`) and/or codec (such as `h264`) | `container`, `codec` |
| `wpm`            | Speaking pace: the words of a **Generate Speech** output spoken per minute | `min`, `max`              |

A `min` or `max` you leave empty isn't checked. See [Built-in checks](../reference/built-in-checks.md)
for each one in detail.

### Checking text

Text checks (`non_empty`, `word_count`, `regex_match`, `regex_absent`, `wpm`) work on a `text` output
without a path. For a `data` output, give a `path` to a text field, such as `script`.

### Checking speech pace

`wpm` is for **Generate Speech** stages. Reelcraft keeps the words it spoke with the audio, divides by
the audio's length, and compares the result to your `min` and `max`. On any other kind of output it
fails, and the blueprint warns you: **wpm measures speaking pace and needs a Generate Speech
(media.audio) output**.

### Data outputs are always checked against their schema

For a `data` output, Reelcraft first checks that the output matches its [schema](./outputs.md). If it
doesn't, that's the only failure reported, and your other checks don't run.

## Script checks

When no builtin does what you need, write a **script check**: a short piece of JavaScript.

1. Select **+ Add script check**.
2. Give it a **Name**, shown in results.
3. Write the script in the code box. Write it as the body of a function: it ends with `return`.
4. Optionally add **refs** with **+ add ref**: extra values to read alongside the output, connected
   like [slots](./connecting-stages.md). Give each a name.

A script can read two things:

- `artifact`: the output. It has `kind`, `data` and, for media, `probe`. A `text` output's text is
  `artifact.data.text`, and a `data` output's fields are in `artifact.data`.
- `refs`: your refs, by name.

It must return an object with `pass` (true or false) and, optionally, a `message` to show:

```js
const scenes = artifact.data.scenes;
if (scenes.length < 3) {
  return { pass: false, message: `Only ${scenes.length} scenes, need at least 3` };
}
return { pass: true };
```

Scripts run in a small, locked-down sandbox. They can't read files, use the network or see anything
besides `artifact` and `refs`, and they're stopped if they run longer than a fraction of a second or
use too much memory. Keep them simple and quick.

A script that doesn't compile is reported as an error when you save the blueprint. One that crashes,
runs out of time or returns the wrong shape counts as a failed check.

## Test a check

You can try a check against an existing output before running anything. Under the check, paste an
output's **artifact id** and select **Test**. You see **Result: pass** or **Result: fail** and the
message.

## When a check fails

1. The stage's attempt is marked as failed on its checks.
2. The stage tries again. The messages of the checks that failed are added to the new attempt's prompt
   (see [Prompts](./prompts.md#when-an-attempt-is-rejected)).
3. After **Max check attempts** failures, the stage fails and the run stops. The default is 3. The
   box appears once the stage has at least one check, and you can change it.

Each failed attempt is paid for, so keep checks reasonable and set a sensible maximum.

A check that is **broken**, such as a script with an error or bad settings, is reported as an
authoring problem. Asking the model again can't fix it, so fix the check.

Look at a failed check on the [run page](../runs/run-page.md), under the stage's **Attempts**.
See also [When a stage fails](../runs/when-a-stage-fails.md).
