import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CopyButton } from './copy-button';
import {
  childPath,
  isInlineString,
  isOpenByDefault,
  jsonKind,
  summarizeValue,
} from './data-view.logic';

const SCALAR_CLASS = {
  number: 'text-sky-600 dark:text-sky-400',
  boolean: 'text-violet-600 dark:text-violet-400',
  null: 'text-muted-foreground italic',
} as const;

/** `null` = each node's own default; `true`/`false` = expand/collapse all. */
type OpenOverride = boolean | null;

function entriesOf(value: unknown): Array<{ label: string; key: string | number; child: unknown }> {
  return Array.isArray(value)
    ? value.map((child, index) => ({ label: `#${index + 1}`, key: index, child }))
    : Object.entries(value as Record<string, unknown>).map(([key, child]) => ({
        label: key,
        key,
        child,
      }));
}

function Children({
  value,
  depth,
  path,
  override,
}: {
  value: unknown;
  depth: number;
  path: string;
  override: OpenOverride;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {entriesOf(value).map(({ label, key, child }) => (
        <Entry
          key={label}
          label={label}
          value={child}
          depth={depth}
          path={childPath(path, key)}
          override={override}
        />
      ))}
    </div>
  );
}

/** Revealed on row hover/focus so the tree stays quiet until you need it. */
function CopyPath({ path }: { path: string }) {
  return (
    <CopyButton
      text={path}
      label={`Copy path ${path}`}
      className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
    />
  );
}

function Label({ label, path }: { label: string; path: string }) {
  return (
    <span className="font-medium text-foreground" title={path}>
      {label}
    </span>
  );
}

function Entry({
  label,
  value,
  depth,
  path,
  override,
}: {
  label: string;
  value: unknown;
  depth: number;
  path: string;
  override: OpenOverride;
}) {
  const kind = jsonKind(value);
  const [open, setOpen] = useState(override ?? isOpenByDefault(depth));

  if (kind === 'object' || kind === 'array') {
    return (
      <div>
        <div className="group/row flex items-center gap-1">
          <button
            type="button"
            className="flex items-center gap-1 rounded text-left text-sm hover:bg-muted/60"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            <Label label={label} path={path} />
            <span className="text-xs text-muted-foreground">{summarizeValue(value)}</span>
          </button>
          <CopyPath path={path} />
        </div>
        {open && (
          <div className="mt-1.5 ml-1.5 border-l pl-3">
            <Children value={value} depth={depth + 1} path={path} override={override} />
          </div>
        )}
      </div>
    );
  }

  const header = (
    <>
      <Label label={label} path={path} />
      <CopyPath path={path} />
    </>
  );

  if (kind === 'string' && !isInlineString(value as string)) {
    return (
      <div className="group/row pl-4.5 text-sm">
        <div className="flex items-center gap-1">{header}</div>
        <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{value as string}</p>
      </div>
    );
  }

  return (
    <div className="group/row flex items-center gap-1 pl-4.5 text-sm">
      {header}
      {kind === 'string' ? (
        <span className="min-w-0 text-muted-foreground">{value as string}</span>
      ) : (
        <span className={`font-mono ${SCALAR_CLASS[kind]}`}>{String(value ?? 'null')}</span>
      )}
    </div>
  );
}

/** A `data` artifact as a collapsible tree (default) or the raw JSON — the
 * same Visual/Raw split the output-schema editor uses. Each key can copy its
 * dot path, the form a context `path` or memory write expects. */
export function DataView({ data }: { data: unknown }) {
  const json = JSON.stringify(data, null, 2) ?? 'null';
  const kind = jsonKind(data);
  const isContainer = kind === 'object' || kind === 'array';
  // Bumping `version` remounts every node so each re-reads `override` as
  // its initial open state — expand/collapse all without lifting per-node
  // state into a shared map.
  const [tree, setTree] = useState<{ override: OpenOverride; version: number }>({
    override: null,
    version: 0,
  });
  const setAll = (override: boolean) => setTree((t) => ({ override, version: t.version + 1 }));

  return (
    <Tabs defaultValue="tree" className="gap-0">
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <TabsList variant="line">
          <TabsTrigger value="tree">Tree</TabsTrigger>
          <TabsTrigger value="raw">Raw JSON</TabsTrigger>
        </TabsList>
        <div className="ml-auto flex items-center">
          {isContainer && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="Expand all"
                aria-label="Expand all"
                onClick={() => setAll(true)}
              >
                <ChevronsUpDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="Collapse all"
                aria-label="Collapse all"
                onClick={() => setAll(false)}
              >
                <ChevronsDownUp />
              </Button>
            </>
          )}
          <CopyButton text={json} />
        </div>
      </div>
      <TabsContent value="tree" className="max-h-[50vh] overflow-auto p-4 wrap-anywhere">
        {isContainer ? (
          <Children key={tree.version} value={data} depth={0} path="" override={tree.override} />
        ) : (
          <div className="text-sm">{String(data ?? 'null')}</div>
        )}
      </TabsContent>
      <TabsContent value="raw">
        <pre className="max-h-[50vh] overflow-auto p-4 text-sm whitespace-pre-wrap wrap-anywhere">
          {json}
        </pre>
      </TabsContent>
    </Tabs>
  );
}
