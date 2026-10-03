---
title: Prompts
description: Write the instructions a stage sends to its model, fill in values with {{ }}, and understand what Reelcraft adds for you.
---

Stages that talk to an AI model read their instructions from the **Instructions** part of the
inspector's **Basics** section. It has two boxes, **System** and **Template**. **Generate Text**,
**Generate Image**, **Generate Video** and **Automate Browser** use them as the prompt. **Generate
Speech** speaks the text in its `text` slot instead, and only uses the Template if that slot is
empty. Stage types that don't call a model ignore both boxes.

## System and Template

- **System** is optional. It's sent before the Template on every call and sets tone, persona or
  rules that never change, such as "You write short, punchy scripts for vertical video." It's sent
  exactly as you write it: `{{ }}` values are **not** filled in here.
- **Template** is the task itself, the message the model answers. It's required for stages that read
  a prompt, such as **Generate Text**. Stage types that don't use a prompt ignore it.

Leave both empty and the stage sends no instructions. If you clear both boxes, the stage's
instructions are removed entirely.

## Filling in values with `{{ }}`

Put a name between double braces and Reelcraft replaces it with the value when the stage runs:

```text
Write a 30-second script about {{ topic }}.
Keep the tone {{ tone }}.
```

You can use any of these names:

- a **slot** of the stage, by its name;
- a **context** key you added (see [Connecting stages](./connecting-stages.md));
- the **item alias** (by default `item`) on a stage that iterates;
- `priorCritique`, described below.

To reach into a value that has fields, use dots and positions: `{{ idea.title }}`,
`{{ scenes[0].narration }}`.

How values are filled in:

- Text and numbers go in as they are.
- Objects and lists go in as formatted JSON.
- A name with no value goes in as nothing, with no error at run time. Reelcraft checks the names
  when you build the blueprint, and tells you if one doesn't exist (**template references undeclared
  slot/context name "…"**) or if a path doesn't match the value's shape.

There's nothing more to the `{{ }}` language: no conditions, no loops, no formulas.

## Files in a prompt

A file (an image, say) can't be pasted into text. On a **Generate Text** stage, bind the file under
**Context**, tick **Attach file**, and Reelcraft sends the file along with the prompt. The model
sees a list of the attached files, in order, with the context key as each file's name. Refer to the
file by that name in your prompt, for example "Describe the image named `photo`". See
[Connecting stages](./connecting-stages.md#images-and-other-files-in-a-prompt).

A character's name and description go in the same way when you attach a
[character role](../channels/characters.md).

## When an attempt is rejected

When a stage tries again because a check failed, quality control scored it too low, or you rejected
it, the reasons are added to the prompt so the model can fix them. Reelcraft adds them after your
task, under a short note saying the previous output was rejected.

To control where they go, write `{{ priorCritique }}` in the Template or in **Output instructions**.
Then Reelcraft puts them there and doesn't add them anywhere else. On the first attempt,
`priorCritique` is empty.

## Output instructions

A **Generate Text** stage with a `text` or `data` output also has **Output instructions** under
**Output & memory writes**: up to 4,000 characters of guidance about the *content and style* of the
result, such as "Use a concise, professional tone." They work like the Template, with the same
`{{ }}` values. For a `data` output, the [schema](./outputs.md) decides the structure and these
instructions guide what goes in it.

## What Reelcraft adds to a text prompt

For **Generate Text**, Reelcraft wraps your Template with a few blocks of its own, so you don't have
to:

- your Template, filled in;
- the feedback from an earlier rejected attempt, if any;
- your Output instructions, together with a reminder to produce only the requested output, with no
  extra commentary;
- the list of attached files, if any;
- a rule for when the model **can't** do the job.

You can see exactly what was sent on the [run page](../runs/run-page.md), under a stage's **Attempts**.

### When the model can't do the job

The model is told not to guess. If a required input or file is missing or unreadable, the inputs
don't contain what the task needs, or the instructions are contradictory or impossible, it replies
with an error instead of a made-up result. Reelcraft fails the stage with a message like:

> Model reported input_missing: The script input was empty.

The codes are:

| Code               | Meaning                                                    |
| ------------------ | ---------------------------------------------------------- |
| `input_missing`    | A required input or file wasn't provided or was empty      |
| `input_unreadable` | A file couldn't be read                                    |
| `input_mismatch`   | The inputs don't contain what the task needs               |
| `task_impossible`  | The instructions are contradictory or can't be done        |
| `refused`          | The model declined the task                                |

This isn't retried, because the same inputs would give the same answer. Fix the input or the
instructions and run again. The call is still charged. See
[When a stage fails](../runs/when-a-stage-fails.md).

## Tips

- Say what you want, in order, and name the format of the answer.
- Put things that never change in **System**, and things that change from run to run in **Template**
  with `{{ }}`.
- Test a prompt cheaply with a [dry run](../runs/dry-runs.md) first, then run only the stage you're
  working on from the [run panel](../runs/canvas-runs.md).
