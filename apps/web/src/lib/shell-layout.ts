export type ShellLayout = 'constrained' | 'wide' | 'workbench';

const WORKBENCH_PATH = /^\/(channels\/[^/]+\/build|blueprints\/[^/]+\/build)\/?$/;
const WIDE_PATH = /^\/runs\/[^/]+/;

/** How `AppShell` frames a page. The blueprint canvas is a workbench: it
 * fills the viewport and manages its own scrolling and padding. Run pages
 * want the full width but still scroll as a page. Everything else reads
 * better constrained to a max width. */
export function shellLayoutForPath(pathname: string): ShellLayout {
  if (WORKBENCH_PATH.test(pathname)) return 'workbench';
  if (WIDE_PATH.test(pathname)) return 'wide';
  return 'constrained';
}
