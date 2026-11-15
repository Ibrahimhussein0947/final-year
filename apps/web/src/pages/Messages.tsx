import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CheckCheck, Lock, MessageSquare, Send } from 'lucide-react';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { PageBody } from '@/pages/PageHeader';
import { api, ApiError } from '@/lib/api';
import { useConversations, useMessages, type ChatMessage, type ConversationItem, type MessagePage } from '@/lib/messaging';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

function ConversationList({ items, activeId }: { items: ConversationItem[]; activeId?: string }) {
  return (
    <ul aria-label="Conversations" className="divide-y divide-border">
      {items.map((c) => (
        <li key={c.id}>
          <Link
            to={`/messages/${c.id}`}
            aria-current={c.id === activeId ? 'page' : undefined}
            className={cn('block px-4 py-3 hover:bg-surface-2', c.id === activeId && 'bg-surface-2')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={cn('truncate text-sm', c.unread ? 'font-bold' : 'font-medium')}>{c.with?.name ?? 'Conversation'}</span>
              {c.unread > 0 && <Badge tone="accent">{c.unread}</Badge>}
            </div>
            {c.job && <p className="truncate text-xs text-muted">{c.job.title}{c.beforeApplying ? ' · before applying' : ''}</p>}
            {c.lastMessage && (
              <p className={cn('mt-0.5 truncate text-xs', c.unread ? 'text-text' : 'text-muted')}>
                {c.lastMessage.mine ? 'You: ' : ''}{c.lastMessage.preview} · {timeAgo(c.lastMessage.createdAt)}
              </p>
            )}
            {c.readOnly && <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted"><Lock className="h-3 w-3" aria-hidden />Closed</p>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Bubble({ m, last }: { m: ChatMessage; last: boolean }) {
  return (
    <li className={cn('flex flex-col', m.mine ? 'items-end' : 'items-start')}>
      {/* React escapes the text, so markup typed into a message is shown literally and never runs. */}
      <p className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm', m.mine ? 'bg-accent text-on-accent' : 'bg-surface-2')}>{m.body}</p>
      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
        {new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        {m.mine && last && (m.readAt ? <><CheckCheck className="h-3 w-3" aria-hidden />Seen</> : <><Check className="h-3 w-3" aria-hidden />Sent</>)}
      </span>
    </li>
  );
}

function Thread({ id, conv }: { id: string; conv?: ConversationItem }) {
  const qc = useQueryClient();
  const q = useMessages(id);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { setOlder([]); setHasMoreOlder(null); setText(''); setError(null); }, [id]);

  const newest = q.data?.messages ?? [];
  const all = [...older, ...newest];
  const lastId = newest[newest.length - 1]?.id;

  // Mark the other person's messages as read whenever new ones arrive while this thread is open.
  const unreadFromThem = newest.some((m) => !m.mine && !m.readAt);
  useEffect(() => {
    if (!unreadFromThem) return;
    void api(`/conversations/${id}/read`, { method: 'POST' }).then(() => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['unread-messages'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    });
  }, [id, unreadFromThem, lastId, qc]);

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [lastId]);

  const send = useMutation({
    mutationFn: (body: string) => api<{ message: ChatMessage }>(`/conversations/${id}/messages`, { method: 'POST', body: { body } }),
    onSuccess: ({ message }) => {
      setText('');
      setError(null);
      qc.setQueryData<MessagePage>(['messages', id], (old) => (old ? { ...old, messages: [...old.messages, message] } : old));
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not send. Check your connection and try again.'),
  });

  async function loadOlder() {
    const first = all[0];
    if (!first) return;
    const page = await api<MessagePage>(`/conversations/${id}/messages?limit=50&before=${encodeURIComponent(first.createdAt)}`);
    setOlder((o) => [...page.messages, ...o]);
    setHasMoreOlder(page.hasMore);
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (text.trim() && !send.isPending) send.mutate(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };
  const readOnly = q.data?.readOnly ?? conv?.readOnly ?? false;
  const showMore = hasMoreOlder === null ? !!q.data?.hasMore : hasMoreOlder;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border px-4 py-3">
        <Link to="/messages" className="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-accent md:hidden"><ArrowLeft className="h-3 w-3" aria-hidden />All conversations</Link>
        <h2 className="font-semibold">{conv?.with?.name ?? 'Conversation'}</h2>
        {conv?.job && <p className="text-xs text-muted">About: {conv.job.title}{conv.beforeApplying ? ' · before applying: nothing about the worker is shared until they apply' : ''}</p>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {q.isLoading && <Skeleton className="h-32" />}
        {q.isError && <Alert tone="danger">Could not load this conversation.</Alert>}
        {showMore && <div className="mb-3 text-center"><Button variant="ghost" size="sm" onClick={loadOlder}>Load earlier messages</Button></div>}
        {q.data && all.length === 0 && <p className="py-8 text-center text-sm text-muted">No messages yet. Say hello.</p>}
        <ul className="space-y-3">{all.map((m, i) => <Bubble key={m.id} m={m} last={i === all.length - 1} />)}</ul>
        <div ref={end} />
      </div>

      {readOnly ? (
        <p className="flex items-center gap-2 border-t border-border bg-surface-2 px-4 py-3 text-sm text-muted"><Lock className="h-4 w-4" aria-hidden />This application has ended, so the conversation is read-only.</p>
      ) : (
        <form onSubmit={submit} className="border-t border-border p-3">
          {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="sr-only">Message</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                maxLength={2000}
                rows={2}
                placeholder="Write a message (Enter to send, Shift+Enter for a new line)"
                className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm"
              />
            </label>
            <Button type="submit" variant="accent" loading={send.isPending} disabled={!text.trim()} aria-label="Send message"><Send className="h-4 w-4" aria-hidden /></Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function MessagesPage() {
  const { id } = useParams();
  const q = useConversations();
  const navigate = useNavigate();
  const items = q.data ?? [];
  const active = items.find((c) => c.id === id);

  // On wide screens open the first conversation automatically.
  useEffect(() => {
    if (!id && items.length > 0 && window.matchMedia('(min-width: 768px)').matches) navigate(`/messages/${items[0].id}`, { replace: true });
  }, [id, items, navigate]);

  return (
    <PageBody>
      <h1 className="mb-4 text-3xl font-extrabold tracking-tight">Messages</h1>
      {q.isLoading && <Skeleton className="h-64" />}
      {q.isError && <Alert tone="danger">Could not load your conversations.</Alert>}
      {q.data && items.length === 0 && (
        <EmptyState
          icon={MessageSquare}
          title="No conversations yet"
          body="You can message an employer or a candidate once there is an application between you. Look for the Message button on an application."
        />
      )}
      {items.length > 0 && (
        <div className="grid h-[70vh] min-h-[420px] overflow-hidden rounded-2xl border border-border bg-surface shadow-card md:grid-cols-[320px_1fr]">
          <div className={cn('min-h-0 overflow-y-auto border-border md:border-r', id && 'hidden md:block')}>
            <ConversationList items={items} activeId={id} />
          </div>
          <div className={cn('min-h-0', !id && 'hidden md:block')}>
            {id ? <Thread key={id} id={id} conv={active} /> : <p className="p-8 text-center text-sm text-muted">Choose a conversation.</p>}
          </div>
        </div>
      )}
    </PageBody>
  );
}

// Used by the "Message" buttons elsewhere.
export function useOpenConversation() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function open(applicationId: string) {
    setBusy(applicationId);
    setError(null);
    try {
      const { conversationId } = await api<{ conversationId: string }>(`/applications/${applicationId}/conversation`, { method: 'POST' });
      navigate(`/messages/${conversationId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the conversation.');
    } finally {
      setBusy(null);
    }
  }
  return { open, error, busy };
}

// keep an unused-import guard for tooling that tree-shakes helpers
void useQuery;
