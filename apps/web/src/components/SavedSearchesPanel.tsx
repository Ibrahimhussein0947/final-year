import { useState } from 'react';
import { Bell, BellOff, Bookmark, Trash2 } from 'lucide-react';
import { Alert, Card, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { describeFilters, useSavedSearchActions, useSavedSearches } from '@/lib/savedSearches';

/**
 * Lets a signed-in worker keep the current job search and get an alert when a new job matches it.
 * `current` is the filters in the page right now (words and filters, no paging or sorting).
 */
export function SavedSearchesPanel({ current, onOpen }: { current: Record<string, string>; onOpen: (filters: Record<string, string | number>) => void }) {
  const list = useSavedSearches(true);
  const { create, update, remove } = useSavedSearchActions();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canSave = Object.keys(current).length > 0;
  const items = list.data?.items ?? [];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({ name: name.trim() || 'My search', filters: current, alertsEnabled: true });
      setName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    }
  }

  return (
    <Card className="mt-4 p-4">
      <div className="flex items-center gap-2">
        <Bookmark className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="text-sm font-bold">Saved searches and alerts</h2>
      </div>

      {canSave ? (
        <form onSubmit={save} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField label="Save what you are looking for now" placeholder="Name, for example: Part-time driving in Adama" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" variant="accent" loading={create.isPending}>Save and alert me</Button>
        </form>
      ) : (
        <p className="mt-2 text-sm text-muted">Search or choose filters above, then save them here to be told when a new matching job is posted.</p>
      )}
      {error && <div className="mt-2"><Alert tone="danger">{error}</Alert></div>}

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(s.filters)}>
                <span className="block truncate text-sm font-semibold hover:underline">{s.name}</span>
                <span className="block truncate text-xs text-muted">{describeFilters(s.filters)}</span>
              </button>
              <Button
                variant="ghost" size="sm" aria-pressed={s.alertsEnabled}
                aria-label={s.alertsEnabled ? `Turn alerts off for ${s.name}` : `Turn alerts on for ${s.name}`}
                onClick={() => update.mutate({ id: s.id, alertsEnabled: !s.alertsEnabled })}
              >
                {s.alertsEnabled ? <Bell className="h-4 w-4 text-accent" aria-hidden /> : <BellOff className="h-4 w-4" aria-hidden />}
                <span className="ml-1 text-xs">{s.alertsEnabled ? 'Alerts on' : 'Alerts off'}</span>
              </Button>
              <Button variant="ghost" size="sm" aria-label={`Delete ${s.name}`} onClick={() => remove.mutate(s.id)}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
