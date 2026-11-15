import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '@/app/auth';
import { useToast } from '@/app/toast';
import { getAccessToken, refreshSession } from '@/lib/api';
import { notificationLink, notificationText, type AppNotification } from '@/lib/applications';

/**
 * Keeps one live connection open while someone is signed in. Events are only a hint to refetch: everything is
 * also stored on the server, so after any disconnect we simply refetch and nothing is lost.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const location = useLocation();
  const path = useRef(location.pathname);
  path.current = location.pathname;
  const role = useRef(user?.role);
  role.current = user?.role;

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let socket: Socket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const refetchAll = () => {
      for (const k of ['notifications', 'conversations', 'unread-messages', 'messages', 'summary']) void qc.invalidateQueries({ queryKey: [k] });
    };

    const open = () => {
      if (stopped) return;
      socket = io({
        // a function, so every (re)connection presents the newest access token
        auth: (cb) => cb({ token: getAccessToken() ?? '' }),
        transports: ['websocket'],
        reconnection: false, // we reconnect ourselves, after refreshing an expired token
      });
      socket.on('connect', refetchAll); // catch up on anything missed while offline
      const again = (delay: number) => {
        if (stopped) return;
        clearTimeout(retry);
        // refresh first: the usual reason for a rejected or closed connection is an expired access token
        retry = setTimeout(() => refreshSession().catch(() => undefined).finally(open), delay);
      };
      socket.on('connect_error', () => { socket?.close(); again(5000); });
      socket.on('disconnect', (reason) => { if (reason !== 'io client disconnect') again(reason === 'io server disconnect' ? 500 : 3000); });

      socket.on('notification:new', (n: AppNotification) => {
        void qc.invalidateQueries({ queryKey: ['notifications'] });
        void qc.invalidateQueries({ queryKey: ['summary'] });
        const viewing = n.type === 'message.new' && path.current.startsWith('/messages');
        if (!viewing) toast.push({ title: notificationText(n), to: notificationLink(n, role.current) });
      });
      socket.on('message:new', (e: { conversationId: string }) => {
        void qc.invalidateQueries({ queryKey: ['conversations'] });
        void qc.invalidateQueries({ queryKey: ['unread-messages'] });
        void qc.invalidateQueries({ queryKey: ['messages', e.conversationId] });
      });
      socket.on('message:read', (e: { conversationId: string }) => void qc.invalidateQueries({ queryKey: ['messages', e.conversationId] }));
    };

    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [userId, qc, toast]);

  return <>{children}</>;
}
