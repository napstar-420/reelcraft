export type ShellLayout = {
  /** `workbench` pages fill the window and scroll their own panes; `page` routes scroll as a whole. */
  frame: 'workbench' | 'page';
  /** Where the assistant is: docked on the right, or the page itself (Home). */
  assistant: 'dock' | 'page';
};

const WORKBENCH = [
  /^\/(channels\/[^/]+\/build|blueprints\/[^/]+\/build)\/?$/,
  /^\/runs\/[^/]+/,
  /^\/channels(\/[^/]+)?\/?$/,
  /^\/settings(\/[^/]+)?\/?$/,
];

/** How `AppShell` frames a route. */
export function shellLayoutForPath(pathname: string): ShellLayout {
  return {
    frame: WORKBENCH.some((re) => re.test(pathname)) ? 'workbench' : 'page',
    assistant: pathname === '/' ? 'page' : 'dock',
  };
}
