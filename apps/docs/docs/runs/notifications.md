---
title: Notifications
description: Hear when a run starts, needs you, fails or finishes, from the bell in Reelcraft or as a notification on your computer.
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

## Browser notifications

To hear about a run even when Reelcraft isn't open, turn on system notifications:

1. Go to **Settings** and find **Notifications**.
2. Switch on **Browser notifications**.
3. When your browser asks, choose **Allow**.

From then on, the notifications you've left switched on appear as notifications on your computer, even with
every Reelcraft tab closed. Select one to open the run. If Reelcraft is already open, it comes to the front
and goes to the right place. While this is on, the pop-up in the corner is replaced by the system
notification, so you get one alert, not two.

It is saved for this browser only. To turn it off, switch off **Browser notifications**.

### If it won't turn on

- **"Your browser only allows system notifications on a secure page."** Browsers only allow this on
  `localhost` or an `https` address. If you open Reelcraft from another computer by its network address over
  plain `http`, the bell and pop-ups still work, but system notifications don't. Open it at
  `localhost` on the computer it runs on instead.
- **"Notifications are blocked for this site."** You chose **Block** earlier. Allow notifications for the
  site in your browser's site settings, then switch it on again.
- **Nothing arrives.** The computer running Reelcraft needs to reach the internet: browsers deliver
  notifications through their maker's push service. The bell still keeps every notification either way.
- **iPhone and iPad** only receive notifications from sites added to the Home Screen, which Reelcraft
  doesn't support yet.
