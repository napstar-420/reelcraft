# Reefcraft UI generation prompt

A reusable prompt for asking Claude (or any Claude-based design tool) to
generate UI for `apps/web` that fits this codebase — same stack, same design
system, same conventions — instead of inventing a new one each time.

Copy everything in the fenced block below, fill in the `<describe the
screen/feature...>` line at the bottom, and send it.

## How to use it

- **In Claude Code / this repo**: paste it as-is, the file paths already
  match.
- **In claude.ai or another design tool** (no repo access): also paste the
  contents of `apps/web/src/index.css`'s `:root`/`.dark`/`@theme inline`
  blocks and one or two files from `apps/web/src/components/ui/` so the tool
  can match the actual token values and component API, since it can't read
  the repo itself.

## The prompt

```
You are generating UI code for "Reefcraft," a React + TypeScript web app
(apps/web in a pnpm monorepo). Match this project's existing stack and
conventions exactly — do not introduce a different UI library, CSS
approach, or file layout.

STACK
- React 18, TypeScript (strict, plus exactOptionalPropertyTypes and
  noUncheckedIndexedAccess — never assign `undefined` to an optional field
  you didn't explicitly make `| undefined`, and never index an array/record
  without accounting for a possibly-`undefined` result).
- Tailwind CSS v4 (no tailwind.config.js — theme lives in
  apps/web/src/index.css via `@theme inline` and CSS custom properties).
- shadcn/ui, "radix-nova" style, Radix base, neutral base color, Lucide
  icons. Already-installed components live in apps/web/src/components/ui/:
  button, input, label, card, select, textarea, dialog, dropdown-menu,
  separator, tabs, badge, checkbox. Import them from "@/components/ui/*"
  (the "@" alias maps to apps/web/src).
  - If you need a component that isn't in that list, say which one you'd
    add via `pnpm dlx shadcn@latest add <name>` rather than hand-rolling a
    shadcn-style component from scratch.
- react-router-dom v7 for routing, @tanstack/react-query v5 for all server
  state (no useEffect+fetch data-loading, no separate global state library).
- react-hook-form is NOT installed — plain useState + controlled inputs is
  this app's existing form pattern; don't add a new form library for a
  single screen.

DESIGN TOKENS (already defined, use them — never hardcode a hex color)
- Colors are CSS variables in oklch, set on :root and mirrored on .dark:
  --background, --foreground, --card, --card-foreground, --popover,
  --popover-foreground, --primary, --primary-foreground, --secondary,
  --secondary-foreground, --muted, --muted-foreground, --accent,
  --accent-foreground, --destructive, --border, --input, --ring,
  --chart-1..5, --sidebar and its foreground/accent/border/ring variants.
- Use them through Tailwind utilities, not raw var(): bg-background,
  text-foreground, bg-primary, text-primary-foreground, border-border,
  ring-ring, bg-card, text-muted-foreground, bg-destructive/10
  text-destructive, etc.
- Radius scale: --radius (0.625rem base) drives --radius-sm/md/lg/xl/2xl/
  3xl/4xl via @theme inline. Use rounded-sm/md/lg/xl, not an arbitrary
  rounded-[Npx].
- Font: Geist Variable (--font-sans), loaded via @fontsource-variable/geist.
  Don't add a different font.
- Dark mode toggles by adding/removing a `.dark` class on an ancestor
  element (`@custom-variant dark (&:is(.dark *))`) — style with `dark:`
  variants, don't branch in JS on a theme value.

CONVENTIONS TO MATCH
- Functional components only, named exports (export function Foo() {...}),
  no default exports, no class components.
- Use the `cn()` helper from "@/lib/utils" to merge conditional classNames
  — never string-concatenate classNames or use a ternary inline for more
  than one conditional class.
- Pages live in apps/web/src/pages/*.tsx, one exported component per file,
  named after the route (e.g. ChannelsPage, RunPage). Reusable pieces live
  in apps/web/src/components/ (feature components) or
  apps/web/src/components/ui/ (shadcn primitives only — don't add
  non-shadcn components there).
- Data fetching: `useQuery({ queryKey: [...], queryFn: () => api.xyz(...) })`
  from apps/web/src/api/client.ts's `api` object; mutations via
  `useMutation`. If a new endpoint doesn't exist on `api` yet, name the
  method you'd add there rather than calling `fetch` directly in a
  component.
- Keep components small and focused — this codebase already prefers
  several small named sub-components over one large component when a
  screen has multiple independent concerns (see
  apps/web/src/components/canvas/StageInspector.tsx for the pattern: one
  function per form section, composed in the exported top-level component).
- No comments explaining WHAT code does — only a short comment for a truly
  non-obvious WHY (a workaround, an invariant). Prettier config: single
  quotes, semicolons, 2-space indent, trailing commas — match
  apps/web/src's existing formatting exactly, not shadcn's own upstream
  style (which uses double quotes and no semicolons).
- Accessibility: real <label>s (or shadcn's Label bound via htmlFor/id),
  visible focus states (shadcn's defaults already handle this — don't
  override focus-visible styles away), no icon-only buttons without an
  aria-label.

DOMAIN CONTEXT (so generated copy/labels make sense)
Reefcraft turns a "blueprint" (a graph of AI-generation "stages" — e.g.
llm.generate, image.generate, video.generate) into a "run" that executes
those stages in order against a "channel" (a project/workspace scope with
its own budget, assets, and characters). Existing top-level screens:
Channels, a channel's Blueprints list, the visual Blueprint canvas
(drag/drop stage graph), a Run's progress view, and a Timeline editor for
assembled video. Generated UI should read as internal creative-production
tooling — dense, functional, information-forward — not a marketing site.

WHAT TO GENERATE
<describe the screen/feature you want, e.g.:
"A settings panel for a channel: name (text), default budget cap in USD
(number), and a danger-zone 'Archive channel' button behind a confirmation
dialog. Use the existing shadcn Card/Dialog/Button/Input/Label
components.">
```
