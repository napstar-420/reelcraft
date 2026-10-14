// The web editor's type check reaches this file through the package, so the module declaration
// has to come with it.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./assets.d.ts" />
import React from 'react';
import { continueRender, delayRender } from 'remotion';
import { loadFont } from '@remotion/fonts';
// Open Font License fonts, shipped with the app so a render needs no network.
import caveatBold from '@fontsource/caveat/files/caveat-latin-700-normal.woff2';
import patrickHand from '@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2';

let loading: Promise<void> | undefined;

/** Loads the hand and body fonts once. A font that fails to load leaves the text in its fallback. */
export function loadSketchFonts(): Promise<void> {
  loading ??= Promise.all([
    loadFont({ family: 'Caveat', url: caveatBold, weight: '700' }),
    loadFont({ family: 'Patrick Hand', url: patrickHand, weight: '400' }),
  ]).then(
    () => undefined,
    () => undefined,
  );
  return loading;
}

/** Holds a frame back until the fonts are in, so a render never draws in a fallback font. */
export function useSketchFonts(enabled: boolean): void {
  const [handle] = React.useState(() => (enabled ? delayRender('Loading sketch fonts') : null));
  React.useEffect(() => {
    if (handle === null) return;
    void loadSketchFonts().then(() => continueRender(handle));
  }, [handle]);
}
