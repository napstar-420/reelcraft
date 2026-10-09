---
title: Notifications
description: Hear when a run starts, needs you, fails or finishes, from the bell in Reelcraft.
---

Runs take a while, and some stop to wait for you. Reelcraft tells you when something happens, so you
don't have to keep the page open.

## The bell

The bell at the top right of every page keeps a list of what happened, newest first. A number on it
shows how many you haven't read.

- Select the bell to open **Notifications**.
- Select a notification to open it. It marks itself read and takes you to the run. For
  **Approval needed** it opens the **Review output** panel for that stage, and for **Input needed** it opens
  the form. For a timeline edit it opens the editor.
- Select **Mark all as read** to clear the number.

The list is kept by Reelcraft, not by your browser, so it is the same in every tab and browser you use.

## What you're told about

| Notification                       | When                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Run started**                    | A run begins working                                                                                   |
| **Approval needed**                | A stage is waiting for you to review its output. See [When a run needs you](./when-a-run-needs-you.md) |
| **Input needed**                   | A run is waiting for a form, or **Timeline edit needed** for the timeline editor                       |
| **Paused: budget reached**         | A run hit a budget limit. See [Budget and costs](./budget-and-costs.md)                                |
| **Paused: provider quota reached** | A provider is out of quota. The run resumes by itself when it resets                                   |
| **Run resumed**                    | A run that was waiting for quota continued by itself                                                   |
| **Run failed**                     | A run stopped with an error. It names the stage and the reason                                         |
| **Run completed**                  | A run finished                                                                                         |
| **Run cancelled**                  | A run was cancelled                                                                                    |
| **Still waiting for you**          | A run has waited for you for 24 hours, and again at 48 hours                                           |

[Dry runs](./dry-runs.md) never send notifications. [Canvas runs](./canvas-runs.md) do, and say
**(canvas run)** after the blueprint's name.

## Pop-ups

While you're looking at Reelcraft, a notification also appears as a pop-up in the corner, with an
**Open** button. A pop-up only appears in the tab you're looking at.

To choose which ones pop up, go to **Settings** and find **Notifications**. Switch off any you don't
want. The choice is saved in this browser only. The bell always keeps every notification, so turning one
off here never loses it. **Run cancelled** is off by default, since you usually just did it yourself.
