import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { CapabilityConfigForm } from '../components/CapabilityConfigForm';
import { SchemaEditor } from '../components/SchemaEditor';
import { CheckTesterPage } from '../components/CheckTesterPage';
import { TemplateLibraryPanel } from '../components/TemplateLibraryPanel';
import { DryRunTrigger } from '../components/DryRunTrigger';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Shared home for Phase 9's editor panels — Chunk 6 adds the capability
 * config form and schema editor; Chunk 7 extends this same page with the
 * check tester, template library, and dry-run trigger rather than standing
 * up a competing page. No visual graph canvas (Locked Decision 3) — the
 * blueprint graph itself stays JSON-authored. */
export function EditorPage() {
  const capabilities = useQuery({ queryKey: ['capabilities'], queryFn: api.listCapabilities });
  const [selectedKey, setSelectedKey] = useState('');

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Editor</h1>
      </div>

      <Tabs defaultValue="capability-config">
        <TabsList>
          <TabsTrigger value="capability-config">Capability Config</TabsTrigger>
          <TabsTrigger value="schema-editor">Schema Editor</TabsTrigger>
          <TabsTrigger value="check-tester">Check Tester</TabsTrigger>
          <TabsTrigger value="template-library">Template Library</TabsTrigger>
          <TabsTrigger value="dry-run">Dry Run</TabsTrigger>
        </TabsList>

        <TabsContent value="capability-config" className="flex flex-col gap-4">
          <Select value={selectedKey} onValueChange={setSelectedKey}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select a capability…" />
            </SelectTrigger>
            <SelectContent>
              {capabilities.data?.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedKey && <CapabilityConfigForm capabilityKey={selectedKey} />}
        </TabsContent>

        <TabsContent value="schema-editor">
          <SchemaEditor />
        </TabsContent>

        <TabsContent value="check-tester">
          <CheckTesterPage />
        </TabsContent>

        <TabsContent value="template-library">
          <TemplateLibraryPanel />
        </TabsContent>

        <TabsContent value="dry-run">
          <DryRunTrigger />
        </TabsContent>
      </Tabs>
    </section>
  );
}
