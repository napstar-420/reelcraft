/** Delete is irreversible and wipes every blueprint/run/asset under the
 * channel, so unlike Archive (a single-click `AlertDialog`) it requires
 * typing the channel's name before the confirm button enables — the server
 * is still the real guard via `ChannelService.delete()`'s 409 on active
 * runs; this is purely a client-side speed bump against a mis-click. */
export function isDeleteConfirmed(typed: string, channelName: string): boolean {
  return typed.trim().length > 0 && typed === channelName;
}
