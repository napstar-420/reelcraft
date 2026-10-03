---
title: Back up, move and uninstall
description: Save the Reelcraft volume to a file, restore it on another computer, or remove Reelcraft.
---

Everything Reelcraft keeps is in one Docker volume, `reelcraft-data`: your projects, media,
settings, saved keys, the Codex sign-in, and the passwords Reelcraft generated on its first start
(`/data/secrets.env`). Backing up means saving that volume to a file.

These commands run in a terminal: **PowerShell** on Windows, **Terminal** on macOS and Linux. They
assume your container is named `reelcraft` and the volume `reelcraft-data`, as in
[Run Reelcraft](./run-reelcraft.md).

## Back up

Stop Reelcraft first, so the database is saved in a consistent state. Then save the volume to
`reelcraft-backup.tgz` in the folder your terminal is in, and start Reelcraft again:

```bash
docker stop reelcraft
docker run --rm --entrypoint tar \
  -v reelcraft-data:/data -v "${PWD}:/backup" \
  zohaibkhan97/reelcraft \
  -czf /backup/reelcraft-backup.tgz --numeric-owner -C /data .
docker start reelcraft
```

On PowerShell, put the `docker run` command on one line, or end each line with a backtick
(`` ` ``) instead of `\`.

This uses the Reelcraft image you already have, so nothing extra is downloaded. Keep the backup
file somewhere safe, such as an external drive. **It contains your saved API keys** and the key
that unlocks them, so treat it like a password.

## Restore or move to another computer

1. On the new computer, [install Docker Desktop](./install-docker.md) and copy the backup file
   into a folder there.
2. In a terminal in that folder, create an empty volume and unpack the backup into it:

   ```bash
   docker volume create reelcraft-data
   docker run --rm --entrypoint tar \
     -v reelcraft-data:/data -v "${PWD}:/backup" \
     zohaibkhan97/reelcraft \
     -xzf /backup/reelcraft-backup.tgz --numeric-owner -C /data
   ```

3. [Run Reelcraft](./run-reelcraft.md) with that volume as usual.

Restore only into a **new, empty** volume. To restore over an existing installation, stop and
delete the container, delete the old volume (see below), and then follow these steps.

The backup can be restored on any computer, whatever its chip (Intel/AMD or Apple Silicon/ARM).

## Uninstall

1. **Delete the container.** In Docker Desktop, open **Containers**, stop **reelcraft** and
   delete it. Or run `docker rm -f reelcraft`.
2. **Delete the image** to free about 3 GB. In **Images**, delete **zohaibkhan97/reelcraft**.
   Or run `docker rmi zohaibkhan97/reelcraft`.
3. **Delete your data**, only if you are sure. In **Volumes**, delete **reelcraft-data**. Or run
   `docker volume rm reelcraft-data`.

:::danger

Deleting the `reelcraft-data` volume permanently deletes all your projects, media, settings and
saved keys. Back it up first if you may want them again.

:::

If you keep the volume, running the image again with it brings everything back.
