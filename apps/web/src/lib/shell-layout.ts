export type ShellLayout = {
  /** `workbench` pages fill the window and scroll their own panes; `page` routes scroll as a whole. */
  frame: 'workbench' | 'page';
  /** Show the floating "Ask the assistant" button: not where the assistant is already on screen. */
  askButton: boolean;
};

const WORKBENCH = [
  /^\/(channels\/[^/]+\/build|blueprints\/[^/]+\/build)\/?$/,
  /^\/runs\/[^/]+/,
  /^\/channels(\/[^/]+)?\/?$/,
  /^\/settings(\/[^/]+)?\/?$/,
];
/** The assistant is docked on these, or the page is the assistant (Home). */
const ASSISTANT_ON_SCREEN = [
  /^\/$/,
  /^\/(channels\/[^/]+\/build|blueprints\/[^/]+\/build)\/?$/,
  /^\/runs\/[^/]+\/?$/,
];

/** How `AppShell` frames a route. */
export function shellLayoutForPath(pathname: string): ShellLayout {
  return {
    frame: WORKBENCH.some((re) => re.test(pathname)) ? 'workbench' : 'page',
    askButton: !ASSISTANT_ON_SCREEN.some((re) => re.test(pathname)),
  };
}
