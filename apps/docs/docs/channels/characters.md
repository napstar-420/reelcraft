---
title: Characters
description: Keep a person or mascot looking the same across videos with reference images.
---

A **character** is someone who appears in your videos, such as a host, a mascot or a narrator. You
give it **reference images**, and stages that make images or video send those images to the model,
so the character looks the same every time.

Characters belong to one channel. Open a channel and select the **Characters** tab.

## Create a character

1. Select **New character**.
2. Enter a **Name** and a **Description**, such as its appearance and personality.
3. Select **Create**.

The new character is a **Draft** until it has at least one reference image. Then it becomes
**Ready**. Only Ready characters can be used in a run.

## Add reference images

1. Select the character's card to open it.
2. Under **Add reference**, drop an image onto the box, or select it to choose a file.
3. Pick the image's **view**:

   | View            | Use it for                       |
   | --------------- | -------------------------------- |
   | `front`         | Face on                          |
   | `three_quarter` | Turned partly to the side        |
   | `profile`       | Side on                          |
   | `full_body`     | Head to toe                      |
   | `expression`    | A particular facial expression   |
   | `detail`        | A close-up, such as an accessory |

4. Select **Confirm**.

Each image card lets you change its view, add a **Caption** (saved when you leave the box),
**Set primary** or **Delete** it. The first image becomes the **Primary** one. The primary image is
the character's picture on its card, and it's always sent first to the model.

## Use a character in a blueprint

A blueprint uses a character through a **role**: a named slot, such as "Host", that you fill with
one of the channel's characters.

1. Open the blueprint and go to **Blueprint settings** → **Role**.
2. Select **+ add role**.
3. Choose the **Character**. Characters without images show **(no references)** and can't be
   picked.
4. Under **Reference images**, tick the images to send. The primary is ticked for you, and at least
   one must stay ticked.
5. Bind the role in each stage that should use the character:
   - in a **Generate Image** or **Generate Video** stage, bind its `references` slot to **role** and
     pick the role;
   - in a **Generate Text** stage, add it under **Context**, bind it to **role**, and tick
     **Attach file**, so the model sees the images and the character's name and description.

   See [Connecting stages](../blueprints/connecting-stages.md).

A blueprint can have one role. Every ticked image is sent to each stage that uses the role, with the
primary first. A model can only accept so many images: if you tick more than the stage's model
accepts, the run won't start and tells you why.

## Edit a character

Select the pencil on the character's card to change its name or description. Changes to its name,
description or images apply to **runs you start afterwards**.

When a run starts, it keeps its own copy of the character, so editing or deleting the character
never changes a run that's already going or finished. A [rerun](../runs/retries.md) uses the
character as it is at the time of the rerun.

## Delete a character

1. Open the character.
2. Select **Delete character**, then confirm with **Delete character**.

The character and its reference images are removed from the channel. Past runs keep the copy they
used. A blueprint whose role used the character shows an error until you choose another character
in **Blueprint settings** → **Role**, and it can't run until you do.
