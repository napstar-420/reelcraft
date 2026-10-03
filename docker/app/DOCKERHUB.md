# Reelcraft

Self-hosted AI video and reel generation. Everything runs in one container on your own computer:
the app, its database, media storage, and the background job runner. You only need
[Docker Desktop](https://www.docker.com/products/docker-desktop/).

**Step-by-step guide:** <https://napstar-420.github.io/reelcraft/docs/>, covering Windows,
macOS and Linux.

## Start Reelcraft

1. In Docker Desktop, search for **reelcraft** and click **Run**.
2. Open **Optional settings** and fill in:
   - **Host port:** `8080`
   - **Volumes:** host path `reelcraft-data`, container path `/data`
3. Click **Run**, wait a minute or two, then open <http://localhost:8080>.

The volume holds all your projects, media and settings. Keep using the same volume name, and
your work stays safe when you update or recreate the container.

Prefer a terminal? This does the same:

```bash
docker run -d --name reelcraft --restart unless-stopped -p 8080:8080 -v reelcraft-data:/data <image>
```

More: [running Reelcraft](https://napstar-420.github.io/reelcraft/docs/run-reelcraft).

## Set it up

Reelcraft works out of the box with a free test provider. Open **Settings** in its sidebar to:

- paste API keys for OpenRouter, fal, ElevenLabs and Deepgram
  ([guide](https://napstar-420.github.io/reelcraft/docs/provider-keys));
- connect BrowserOS Neo ([guide](https://napstar-420.github.io/reelcraft/docs/browseros-neo));
- connect Codex with your ChatGPT plan
  ([guide](https://napstar-420.github.io/reelcraft/docs/codex)).

Keys can also be set as environment variables (`OPENROUTER_API_KEY`, `FAL_KEY`,
`ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`), which take priority over saved ones.

## Update

When a new version is out, Reelcraft shows **Update to …** at the bottom of its sidebar. Click
it, then **Update**. Reelcraft backs up your data, installs the update and restarts itself. If
the new version doesn't start, it goes back to the previous one on its own.

Some releases need a newer image. The app tells you when, and the steps are:

1. In Docker Desktop, open **Images**, find Reelcraft and pull the newest version.
2. Stop and delete the old Reelcraft container. Your data is in the volume, not the container.
3. Run the new image with the **same port and the same volume** (`reelcraft-data` → `/data`).

Database updates run automatically when it starts. Versions before 0.2.0 can't update
themselves, so update those this way once. More:
[updating](https://napstar-420.github.io/reelcraft/docs/updating) and
[backups](https://napstar-420.github.io/reelcraft/docs/backup). Each release's notes are on
[GitHub Releases](https://github.com/napstar-420/reelcraft/releases).

## Keep it private

Reelcraft has no login. Anyone who can reach the port can use it and your API keys. Use it on your
own computer or a network you trust, and don't expose port 8080 to the internet.

## More

- Guide: <https://napstar-420.github.io/reelcraft/docs/>
- Problems? See [troubleshooting](https://napstar-420.github.io/reelcraft/docs/troubleshooting).
- Source: <https://github.com/napstar-420/reelcraft>
- This image includes [MinIO](https://github.com/minio/minio) (AGPL-3.0), built unmodified from
  source.
