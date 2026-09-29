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

| Step     | What happens                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submit` | Open a tab: a **temporary chat** for text; a **regular chat** for images, because image generation is unavailable in temporary chats. Check sign-in, set effort, attach references, type, send. |
| `poll`   | Read the tab: Stop button means running; the reply's Copy button means text is done; a loaded `Generated image` means an image is done.                                                         |
| `fetch`  | Text: capture what ChatGPT's own Copy button writes (markdown), strip web-search citation tokens, and parse JSON for `data`/`timeline`. Image: download every generated image. Close the tab.   |
| `cancel` | Click Stop and close the tab.                                                                                                                                                                   |

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

- **Image chats stay in your ChatGPT history.** Text chats are temporary and do not appear there.
- **Effort is sticky account-wide** in ChatGPT. Every job sets it explicitly, and your ChatGPT app
  keeps whatever the last job used.
- Web search uses ChatGPT's `hints=search` URL hint. The "+" menu ignores synthetic clicks, and
  Neo's trusted input doesn't reliably reach background tabs.
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
4. Image stage with one reference: a media artifact appears, and the chat is in ChatGPT history.
5. Cancel mid-generation: the tab closes and the attempt is cancelled.
6. Sign out of ChatGPT in Neo: the pin editor and Run show the sign-in message.
