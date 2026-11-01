import { createContext, useContext } from 'react';

export type CommandPaletteApi = { open: (query?: string) => void };

export const CommandPaletteContext = createContext<CommandPaletteApi>({ open: () => {} });

/** Opens the Cmd+K search from anywhere in the app. */
export function useCommandPalette(): CommandPaletteApi {
  return useContext(CommandPaletteContext);
}
