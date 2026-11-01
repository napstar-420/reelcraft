import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AppRail } from '@/components/shell/app-rail';
import { CommandPalette } from '@/components/shell/command-palette';
import { CommandPaletteContext } from '@/components/shell/command-palette-context';
import { AssistantDock } from '@/components/assistant/assistant-dock';
import { AssistantProvider } from '@/components/assistant/assistant-provider';
import { useAssistantUi } from '@/components/assistant/assistant-context';
import { useRunBuckets } from '@/hooks/useRunBuckets';
import { shellLayoutForPath } from '@/lib/shell-layout';

/** The frame around every page: the icon rail, Cmd+K search, and the assistant: docked on the
 * right of every page (Cmd+J), or the page itself on Home. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AssistantProvider>
      <ShellFrame>{children}</ShellFrame>
    </AssistantProvider>
  );
}

function ShellFrame({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const layout = shellLayoutForPath(location.pathname);
  const { needsYou } = useRunBuckets();
  const { dockOpen, setDockOpen, openAssistant } = useAssistantUi();
  const [palette, setPalette] = useState<{ open: boolean; query: string }>({
    open: false,
    query: '',
  });
  const open = useCallback((query = '') => setPalette({ open: true, query }), []);
  const paletteApi = useMemo(() => ({ open }), [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setPalette((p) => ({ open: !p.open, query: '' }));
      } else if (key === 'j') {
        event.preventDefault();
        if (layout.assistant === 'dock' && dockOpen) setDockOpen(false);
        else openAssistant();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [layout.assistant, dockOpen, setDockOpen, openAssistant]);

  return (
    <CommandPaletteContext.Provider value={paletteApi}>
      <div className="flex h-svh min-h-0 bg-background">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <AppRail needsYou={needsYou.length} />
        <main
          id="main-content"
          className={
            layout.frame === 'workbench'
              ? 'min-h-0 min-w-0 flex-1 overflow-hidden'
              : 'min-h-0 min-w-0 flex-1 overflow-y-auto'
          }
        >
          {children}
        </main>
        {layout.assistant === 'dock' ? <AssistantDock /> : null}
      </div>
      <CommandPalette
        open={palette.open}
        initialQuery={palette.query}
        onOpenChange={(next) => setPalette((p) => ({ ...p, open: next }))}
      />
    </CommandPaletteContext.Provider>
  );
}
