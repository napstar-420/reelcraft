---
title: Sharing blueprints
description: Export a blueprint as a signed package file, import one someone sent you, and manage who you trust.
---

You can send a blueprint to someone else, on another computer or in another channel, as a **package**:
one `.reelpack` file. Whoever you send it to imports it into their own Reelcraft and can run it.

A package holds one saved version of a blueprint. If the blueprint uses characters or assets from
your channel, the file can carry their images and media too, so the other person doesn't have to
rebuild them.

Packages are signed with your **package identity**, so the person who imports one can tell it came
from you and that nobody changed it afterwards. See [Who made a package](#who-made-a-package).

## Export a blueprint

1. Save the blueprint. Only a saved version can be exported, and only one that is **Runnable**. See
   [Versions](./versions.md).
2. Select **Export package…**. You'll find it in two places:
   - on the canvas, in the menu next to **Save** (**More save options**);
   - on the blueprint's card in the channel's **Blueprints** tab, in the **⋯** menu.
3. For each character and asset the blueprint uses, choose whether to include its media. Leave it
   ticked to send the images with the package. Untick it to leave a **slot** for the importer to fill
   with their own.
4. Check the list of anything that looks like an email address or a secret, if there is one.
   Remove it from the blueprint first if you don't want to share it.
5. Select **Export package**. Your browser downloads a file named like `my-shorts-1.2.reelpack`.

The export uses the latest saved version, not unsaved edits on the canvas.

### What's in a package, and what isn't

A package contains the stages, inputs, roles, defaults and prompts of that version, plus any media you
chose to include.

It never contains:

- your [provider keys](../provider-keys.md);
- your runs or their outputs;
- the **Run cap (USD)**, because the importer sets their own;
- anything that is only on the canvas and not saved.

Prompts and fixed values are shared as they are, so the export dialog warns you about text that
looks like an email address or a key.

Media you can't include stays a slot: something that was deleted, or a single file over 50 MB.
A package can't be larger than 200 MB in total.

## Import a package

1. Open the channel you want the blueprint in.
2. On the **Blueprints** tab, select **Import package…**. You can also use **Import package…** on
   the page for naming a new blueprint.
3. Choose or drop the `.reelpack` file.
4. Reelcraft reads it and shows what's in it: the name, the version, who signed it, and what it
   uses. Problems are listed above the form. See [When an import is refused](#when-an-import-is-refused).
5. For each slot, choose what to use:
   - **Use “…” from the package**: the media that came with it. This creates a new character or
     asset in your channel. If a character or asset with that name already exists, the new one is
     called, for example, “Host (imported)”.
   - **Use my character “…”** or **Use my asset “…”**: one of your own.
   - **Leave empty**, for a character the blueprint doesn't strictly need.
6. Check the **Blueprint name**, and set the **Run cap (USD)**. The package never sets this for you.
7. Select **Import**. The blueprint opens on the canvas, as version `v1.0`.

If a stage uses a provider you haven't set up, the blueprint is imported but marked **Not runnable
yet** until you add a key in [Settings](../provider-keys.md) or change that stage's model. The
import dialog warns you about this first.

If an import fails part-way, nothing is added: no blueprint, characters or assets.

### Importing a package you already have

If the channel already has a blueprint that came from the same package, the dialog says so and
offers two choices:

- **Add as a new version**: saves the package as the next version of that blueprint. Your earlier
  versions stay, so you can compare them or restore one. Any unsaved edits on its canvas are kept as
  a draft of the version it had before, and the canvas asks whether to open them (see
  [Edited elsewhere](./versions.md#edited-elsewhere)). This is only offered when the package is a newer or older version signed by the same
  author.
- **Install as a separate copy**: makes a new blueprint, named for example “My Shorts (2)”.

A package can only update a blueprint when the same author signed both. If someone else signed it,
or its contents changed without a new version number, you can only install a separate copy.

## Who made a package

Every Reelcraft has its own **package identity**: a signing key made the first time it's needed.
Open **Settings** and find **Package identity** to see yours, written like
`local · ab12 cd34 …`. The `local` means it belongs to this install, not to an account, and the
numbers and letters identify the key.

When you import a package, the dialog shows the same line for whoever signed it:

- **made on this install**: you exported it yourself;
- **trusted author**: you chose to trust this key before;
- **new author**: you haven't seen this key before. You can tick **Trust this author from now on**
  to stop seeing this warning for their packages;
- **Unsigned**: the file has no signature, so there's no way to tell who made it.

A signature shows that a package is unchanged and comes from the same key as earlier ones. It doesn't
prove who the person is. Only trust an author you know, and look at what you're importing first.

Under **Trusted authors** in Settings, select **Remove** next to a key to stop trusting it.

### Back up your identity

If you lose your identity, packages you export later will look like they come from someone new, and
people can't install them as updates to ones you sent before.

- **Back up identity** downloads a file with your private key. Keep it somewhere safe and don't share
  it: anyone who has it can sign packages as you.
- **Restore identity…** loads a backup, for example on a new computer.
- **Create new identity…** replaces the key with a new one. Back up the old one first if you may want
  it back. If Reelcraft says the saved identity can't be read, it was saved with an encryption secret
  that has since changed. Restore a backup or create a new identity.

## When an import is refused

Reelcraft checks a package before adding anything, and shows every problem at once. These stop the
import:

| Message                                                                                                | What it means                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **This isn't a Reelcraft package.**                                                                    | The file isn't a `.reelpack`, or it's damaged.                                                                      |
| **This package was modified or damaged after it was signed.**                                          | A file inside changed after the author signed it. Ask for the file again.                                           |
| **A file was modified or damaged.**                                                                    | One of the files inside doesn't match what the author listed.                                                       |
| **A media file is not what it says it is.**                                                            | An image or video isn't the type the package says.                                                                  |
| **This package was made by a newer version of Reelcraft.**                                             | [Update Reelcraft](../updating.md), then try again.                                                                 |
| **This package needs Reelcraft … or newer.**                                                           | Same: update first.                                                                                                 |
| **Stage "…" needs "…", which this version of Reelcraft does not have.**                                | The blueprint uses a stage type your version doesn't have. Update Reelcraft, or ask the author for another version. |
| **This file is too large to be a Reelcraft package.** / **This package would take up too much space.** | Packages are limited to 200 MB, with files up to 50 MB each.                                                        |

These are shown as warnings, and you can still import:

- **This package isn't signed, so there's no way to tell who made it.**
- **This package is from an author you have not trusted yet.**
- **Uses …, which has no key in Settings.** Add the key before you run it.
- **Stage "…" names Google accounts from the author's computer.** Change them in the stage's settings.
- **…is already installed from this package**, and the notes about older versions and unsaved edits.

Unsigned packages can be imported, but they can't update a blueprint you already have.
