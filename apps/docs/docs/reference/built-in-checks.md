---
title: Built-in checks
description: Every built-in check, with its settings and the messages it gives.
---

Add these in a stage's **Checks & Quality control** section with **+ Add builtin check**. See
[Checks](../blueprints/checks.md) for how checks work.

A **path** says where in the output to look: a field name, or fields separated by dots such as
`scene.narration`. Leave it empty to check the whole output. Text checks read the text of a `text` output,
or the words spoken in a **Generate Speech** output, without needing a path.

Settings marked *required* must be filled in. A `min` or `max` left empty isn't checked.

| Check            | What it tests                                                          | Settings                                |
| ---------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| `non_empty`      | A value is not empty: text that isn't blank, a list with items, an object with fields | `path`                  |
| `word_count`     | The number of words in some text                                       | `path`, `min`, `max`                    |
| `regex_match`    | Some text matches a pattern                                            | `pattern` (required), `flags`, `path`   |
| `regex_absent`   | Some text does **not** match a pattern                                 | `pattern` (required), `flags`, `path`   |
| `numeric_range`  | A number is within a range                                             | `path` (required), `min`, `max`         |
| `array_length`   | A list has a number of items within a range                            | `path` (required), `min`, `max`         |
| `duration_range` | The length of a video or audio file, in seconds                        | `min`, `max`                            |
| `media_format`   | The file's container and/or codec                                      | `container`, `codec`                    |
| `wpm`            | Words spoken per minute, in a **Generate Speech** output               | `min`, `max`                            |

## Details

**Words** are counted by splitting on spaces and line breaks.

**Patterns** (`regex_match`, `regex_absent`) are regular expressions of up to 200 characters. `flags` are
the usual single letters, up to 5, such as `i` to ignore capital letters. The text must be text: a pattern
on a number fails. A pattern that isn't valid is an authoring error.

**`duration_range`** and **`media_format`** read the file's technical details. They fail with *artifact has
no probe metadata* if Reelcraft couldn't read the file.

**`wpm`** divides the spoken words by the audio's length in minutes. It only works on **Generate Speech**
outputs.

## Messages

A failing check says why, prefixed with its name. For example:

- `word_count: 41 words, expected at least 60`
- `regex_absent: pattern "buy now" unexpectedly matched`
- `numeric_range: 12 is above maximum 10`
- `array_length: length 2 is below minimum 3`
- `duration_range: 34.2s is above maximum 30s`
- `wpm: 187.3 words/min is above maximum 170`
- `non_empty: value at "script" is empty`

A check that is itself wrong, such as a bad setting or a script with an error, is reported as an authoring
problem instead. See [When a stage fails](../runs/when-a-stage-fails.md).
