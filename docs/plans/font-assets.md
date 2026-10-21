# Fonts as assets

## Why

Words in a video can only use the two bundled fonts (Caveat, Patrick Hand) or whatever the render machine
happens to have. A channel with a brand font has no way to use it. CLAUDE.md lists fonts as one more asset
kind: uploaded to the library like any other, picked from the catalogue, never a special path.

## What

1. **Upload.** The `font` asset kind (already in the database and DTOs) becomes uploadable: `.ttf`, `.otf`,
   `.woff`, `.woff2`. At upload Reelcraft checks the file's signature and, for TrueType/OpenType, reads the
   family name from the `name` table; WOFF files (compressed) use the asset's name. Stored as
   `meta: { family, format }`. A file that isn't a font is refused (`asset_font_invalid`).
2. **Library and catalogue.** `{from:'library', kinds:['font']}` lists fonts: id, `font` kind, the family as
   label, handle `asset:<id>`. Fonts are snapshotted at run start like every library asset.
3. **Timeline.** A timeline may list the fonts it uses: `fonts: [{ family, handle }]` (version 2). Graphic
   text names the family in `content.font`, as today.
4. **Compose Timeline.** A text layer's `font` may be a font asset's id: compose writes its family into the
   text and adds the font to `timeline.fonts`. Any other value is used as a family name, as today.
5. **Rendering.** The resolver, render staging and checks treat font handles like media handles (the file is
   copied into the job). The composition loads every listed font with `@remotion/fonts` and holds the first
   frame until they are in (same as the bundled fonts).
6. **Editor preview.** The editor lists font resources with a URL, so the live preview loads them too.
   Library (`asset:`) handles on a composed timeline are now resolved for the preview as well.
7. **Web.** The asset dialog accepts font files as **Font**; the asset card shows the family.
8. **Docs.** Assets page (fonts), Compose Timeline (font by id), Timelines (fonts list).

## Not in scope

Font upload for the caption and text-style presets (they keep their own fonts), font subsetting, variable
font axes.
