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
  isKindEnabled,
  loadNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
} from '@/lib/notification-prefs';

/** Which notifications interrupt this browser. The bell always keeps every
 * one, so turning a kind off never loses it. Saved per browser. */
export function NotificationsCard() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => loadNotificationPrefs());

  function setKind(kind: NotificationKind, on: boolean) {
    const kinds = { ...prefs.kinds, [kind]: on };
    setPrefs({ ...prefs, kinds });
    saveNotificationPrefs({ kinds });
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
