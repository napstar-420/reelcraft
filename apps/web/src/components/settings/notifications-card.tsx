import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { NotificationKind } from '@reelcraft/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { docsUrl } from '@/lib/docs-url';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_INFO,
  enabledKinds,
  isKindEnabled,
  loadNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
} from '@/lib/notification-prefs';
import { disablePush, enablePush, isPushActive, pushSupport, syncPush } from '@/lib/push';
import type { PushSupport } from '@/lib/push.logic';

const SUPPORT_MESSAGE: Record<Exclude<PushSupport, 'ready'>, string> = {
  insecure:
    'Your browser only allows system notifications on a secure page. Open Reelcraft at localhost, or over https.',
  unsupported: "This browser doesn't support system notifications.",
  denied:
    "Notifications are blocked for this site. Allow them in your browser's site settings, then try again. A browser built into another app can't ask: open Reelcraft in your regular browser.",
};

const DISMISSED_MESSAGE =
  'The permission prompt was closed without an answer. Switch it on again and choose Allow.';

/** Which notifications interrupt this browser, as pop-ups and, once switched
 * on, as system notifications that arrive even with every tab closed. The bell
 * always keeps every one, so turning a kind off never loses it. Saved per
 * browser. */
export function NotificationsCard() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => loadNotificationPrefs());
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const support = pushSupport();
  const pushOn = isPushActive();

  function setKind(kind: NotificationKind, on: boolean) {
    const kinds = { ...prefs.kinds, [kind]: on };
    const next = { ...prefs, kinds };
    setPrefs(next);
    saveNotificationPrefs({ kinds });
    void syncPush(enabledKinds(next));
  }

  async function setPush(on: boolean) {
    setBusy(true);
    setError(null);
    // Only `default` can show the prompt; once granted or blocked it never appears.
    setAsking(on && Notification.permission === 'default');
    try {
      if (on) {
        const result = await enablePush(enabledKinds(prefs));
        if (result === 'denied') setError(SUPPORT_MESSAGE.denied);
        if (result === 'dismissed') setError(DISMISSED_MESSAGE);
      } else {
        await disablePush();
      }
    } catch (err) {
      setError(
        `Could not ${on ? 'turn on' : 'turn off'} system notifications: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    } finally {
      setPrefs(loadNotificationPrefs());
      setAsking(false);
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Choose which events pop up in this browser. Every event is still kept in the bell at the
          top of the page.{' '}
          <a
            href={docsUrl('runs/notifications')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            About notifications <ExternalLink className="size-3" />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 border-b pb-4">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="notify-browser">Browser notifications</Label>
            <p className="text-xs text-muted-foreground">
              Get the events below as system notifications, even when Reelcraft isn&apos;t open.
              Needs this computer to reach the internet.
            </p>
            {asking ? (
              <p role="status" className="text-xs text-foreground">
                Waiting for your answer. Your browser asks next to the address bar: choose Allow. If
                you don&apos;t see a pop-up, look for a bell icon there and select it.
              </p>
            ) : null}
            {support !== 'ready' && !pushOn ? (
              <p className="text-xs text-muted-foreground">{SUPPORT_MESSAGE[support]}</p>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <Switch
            id="notify-browser"
            checked={pushOn}
            disabled={busy || (support !== 'ready' && !pushOn)}
            onCheckedChange={(on) => void setPush(on)}
          />
        </div>
        {NOTIFICATION_KINDS.map((kind) => {
          const info = NOTIFICATION_KIND_INFO[kind];
          const id = `notify-${kind}`;
          return (
            <div key={kind} className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={id}>{info.label}</Label>
                <p className="text-xs text-muted-foreground">{info.hint}</p>
              </div>
              <Switch
                id={id}
                checked={isKindEnabled(prefs, kind)}
                onCheckedChange={(on) => setKind(kind, on)}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
