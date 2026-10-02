# Reelcraft

Self-hosted AI video and reel generation. Everything runs in one container on your own computer:
the app, its database, media storage, and the background job runner. You only need
[Docker Desktop](https://www.docker.com/products/docker-desktop/).

## Start Reelcraft

1. In Docker Desktop, search for **reelcraft** and click **Run**.
2. Open **Optional settings** and fill in:
   - **Host port:** `8080`
   - **Volumes:** host path `reelcraft-data`, container path `/data`
3. Click **Run**, wait about a minute, then open <http://localhost:8080>.

The volume holds all your projects, media and settings. Keep using the same volume name, and
your work stays safe when you update or recreate the container.

Prefer a terminal? This does the same:

```bash
docker run -d --name reelcraft -p 8080:8080 -v reelcraft-data:/data <image>
```

## Add your AI provider keys

Reelcraft works out of the box with a free test provider. To use real AI services, add their API
keys as **Environment variables** in the same Optional settings:

| Variable             | Service    |
| -------------------- | ---------- |
| `OPENROUTER_API_KEY` | OpenRouter |
| `FAL_KEY`            | fal        |
| `ELEVENLABS_API_KEY` | ElevenLabs |
| `DEEPGRAM_API_KEY`   | Deepgram   |

## Update

1. In Docker Desktop, open **Images**, find Reelcraft and pull the newest version.
2. Stop and delete the old Reelcraft container. Your data is in the volume, not the container.
3. Run the new image with the **same port and the same volume** (`reelcraft-data` → `/data`).

Database updates run automatically when it starts. Each release's notes are on
[GitHub Releases](https://github.com/napstar-420/reelcraft/releases).

## Keep it private

Reelcraft has no login. Anyone who can reach the port can use it and your API keys. Use it on your
own computer or a network you trust, and don't expose port 8080 to the internet.

## More

- Source and documentation: <https://github.com/napstar-420/reelcraft>
- Codex and BrowserOS Neo setup: see "Run with Docker" in the README.
- This image includes [MinIO](https://github.com/minio/minio) (AGPL-3.0), built unmodified from
  source.
