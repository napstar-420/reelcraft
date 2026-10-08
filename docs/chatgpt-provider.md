# ChatGPT (browser) provider

The `chatgpt` provider lets a ChatGPT subscription serve `text.generate` and `image.generate`
stages. There is no API behind it: the API drives the user's own signed-in chatgpt.com tab in
BrowserOS Neo over Neo's MCP server (`CODEX_BROWSER_OS_URL`, default `http://127.0.0.1:9010/mcp`).
It is local and single-user, like the Codex provider.

## Setup

1. Start BrowserOS Neo and sign in to chatgpt.com inside it.
2. Pin a stage to provider `chatgpt`. There is no model picker. Choose **Effort** (Instant,
   Medium or High, the same three stops as ChatGPT's model menu) and toggle **Web search**.

If Neo is down or ChatGPT is signed out, the pin editor shows the reason, and both saving and
running refuse the pin. If ChatGPT signs out mid-run, the stage fails once with "You're not signed
in to ChatGPT…" and does not retry. Sign in, then use re-run stage.

## How a job runs

| Step     | What happens                                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submit` | Open a tab: a **temporary chat** for text; a **regular chat** for images, because image generation is unavailable in temporary chats. Check sign-in, set effort, attach references, type, send.                      |
| `poll`   | Read the tab: Stop button means running; the reply's Copy button means text is done; a loaded `Generated image` means an image is done.                                                                              |
| `fetch`  | Text: capture what ChatGPT's own Copy button writes (markdown), strip web-search citation tokens, and parse JSON for `data`/`timeline`. Image: download every generated image, then archive the chat. Close the tab. |
| `cancel` | Click Stop, archive the chat (images), and close the tab.                                                                                                                                                            |

Costs settle at `$0`. The job handle holds only the Neo page id, and Neo tabs outlive API
restarts, so a restart mid-job keeps polling the same tab.

### Prompt assembly

The ChatGPT UI has one text box, so `buildChatgptPrompt` folds everything into the pasted
message in this order: the system prompt (wrapped with an instruction to treat it as system-level),
then the rendered stage prompt (which already ends with the output contract and stage output
instructions), then the required JSON Schema for `data`/`timeline` stages. A stage with neither a
system prompt nor a schema is pasted verbatim. The exact pasted text is kept in the attempt's raw
response as `pastedPrompt`.

## Things to know

- **Image chats are archived automatically.** Text chats are temporary and never appear in your
  history. Image generation does not work in temporary chats, so each image job opens a regular chat.
  Before closing its tab, Reelcraft archives that chat (the same call as ChatGPT's own **Archive**
  menu item), including on failure or cancel. Find them under Settings > Data controls > Archived
  chats. Archiving is best-effort: if it fails, a warning is logged and the image is still returned.
  ChatGPT's chat lists lag an archive by up to a minute, so the sidebar may show the chat briefly.
- **Effort is sticky account-wide** in ChatGPT. Every job sets it explicitly, and your ChatGPT app
  keeps whatever the last job used. Jobs that run side by side (an iterating stage with
  `iterate.concurrency` above 1) take turns from "set effort" to "sent", so each prompt goes out with
  its own effort; everything else about a job stays in its own tab.
- **Concurrency is not capped.** Each running item is its own tab and its own chat, started within
  seconds of the others. Three at once was tried and worked (all images generated and downloaded);
  more is untested, and ChatGPT may rate-limit or show captchas for many image chats at once. Start
  with 2 or 3.
- The one Neo connection is shared by all jobs. A call that only times out no longer drops it, so a
  slow upload in one tab does not reconnect the others.
- Web search is turned on from the composer's "+" menu, which ignores synthetic clicks, so two
  trusted mouse clicks are sent over CDP (they work in a background tab). The old `hints=search`
  URL hint was dropped by ChatGPT. The "Web search" pill then sits inside the composer text.
- Neo returns `evaluate` results over ~6 KB as files, so large results (images, long replies) are
  read back in small chunks. See `inPage` in `chatgpt-page.ts`.
- Every chatgpt.com selector lives in `apps/api/src/provider/chatgpt/chatgpt-page.ts`. When
  ChatGPT changes its UI, failures read "… — the ChatGPT UI may have changed" and that file is
  the one to fix.
- Prompts go to your consumer ChatGPT account, under its terms and usage limits. Limit and error
  messages surface as failed stages with ChatGPT's text.

## Manual acceptance

With `pnpm dev` running and Neo signed in:

1. Text stage, Instant, no search: the output matches ChatGPT's copied reply, and no new chat
   appears in history.
2. Text stage, High, web search on: the reply cites current information, with no
   `:chatgpt-content-reference` tokens.
3. `data` stage with a system prompt: the output parses and validates.
4. Image stage with one reference: a media artifact appears, and the chat is under Archived chats (not in the sidebar, give it a minute).
5. Cancel mid-generation: the tab closes and the attempt is cancelled.
6. Sign out of ChatGPT in Neo: the pin editor and Run show the sign-in message.
