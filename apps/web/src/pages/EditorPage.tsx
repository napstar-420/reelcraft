import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { CapabilityConfigForm } from '../components/CapabilityConfigForm';
import { SchemaEditor } from '../components/SchemaEditor';
import { CheckTesterPage } from '../components/CheckTesterPage';
import { TemplateLibraryPanel } from '../components/TemplateLibraryPanel';
import { DryRunTrigger } from '../components/DryRunTrigger';

/** Shared home for Phase 9's editor panels — Chunk 6 adds the capability
 * config form and schema editor; Chunk 7 extends this same page with the
 * check tester, template library, and dry-run trigger rather than standing
 * up a competing page. No visual graph canvas (Locked Decision 3) — the
 * blueprint graph itself stays JSON-authored. */
export function EditorPage() {
  const capabilities = useQuery({ queryKey: ['capabilities'], queryFn: api.listCapabilities });
  const [selectedKey, setSelectedKey] = useState('');

  return (
    <section>
      <h1>Editor</h1>

      <h2>Capability config</h2>
      <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
        <option value="">Select a capability…</option>
        {capabilities.data?.map((c) => (
          <option key={c.key} value={c.key}>
            {c.key}
          </option>
        ))}
      </select>
      {selectedKey && <CapabilityConfigForm capabilityKey={selectedKey} />}

      <SchemaEditor />

      <CheckTesterPage />

      <TemplateLibraryPanel />

      <DryRunTrigger />
    </section>
  );
}
