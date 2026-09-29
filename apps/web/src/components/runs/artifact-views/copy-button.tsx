import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** `label` renders an icon-only button with that accessible label/tooltip. */
export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const icon = copied ? <Check /> : <Copy />;
  return label ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={copied ? 'Copied' : label}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        void copy();
      }}
    >
      {icon}
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      onClick={() => void copy()}
    >
      {icon}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
