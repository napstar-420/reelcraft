import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export function ChannelsPage() {
  const [name, setName] = useState('');
  const queryClient = useQueryClient();
  const channels = useQuery({ queryKey: ['channels'], queryFn: api.listChannels });
  const createChannel = useMutation({
    mutationFn: () => api.createChannel({ name, theme: {}, defaults: {} }),
    onSuccess: () => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });

  return (
    <section>
      <h1>Channels</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) createChannel.mutate();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Channel name" />
        <button type="submit" disabled={createChannel.isPending}>
          Create
        </button>
      </form>

      {channels.isLoading && <p>Loading…</p>}
      <ul>
        {channels.data?.map((c) => (
          <li key={c.id}>
            <Link to={`/channels/${c.id}`}>{c.name}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
