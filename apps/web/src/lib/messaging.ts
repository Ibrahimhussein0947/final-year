import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ConversationItem {
  id: string;
  applicationId: string | null;
  /** The worker started this from an invitation and has not applied yet. */
  beforeApplying?: boolean;
  readOnly: boolean;
  with: { name: string; role: 'WORKER' | 'EMPLOYER' } | null;
  job: { id: string; title: string } | null;
  lastMessage: { preview: string; mine: boolean; createdAt: string } | null;
  unread: number;
}

export interface ChatMessage { id: string; mine: boolean; senderName: string; body: string; createdAt: string; readAt: string | null }
export interface MessagePage { readOnly: boolean; hasMore: boolean; messages: ChatMessage[] }

export const useConversations = (enabled = true) =>
  useQuery({ queryKey: ['conversations'], enabled, queryFn: async () => (await api<{ items: ConversationItem[] }>('/conversations')).items });

/** The worker starts a chat about an invitation (or either side reopens it). Returns the conversation id. */
export async function openInvitationConversation(invitationId: string): Promise<string> {
  return (await api<{ conversationId: string }>(`/invitations/${invitationId}/conversation`, { method: 'POST' })).conversationId;
}

export const useUnreadMessages = (enabled = true) =>
  useQuery({ queryKey: ['unread-messages'], enabled, queryFn: async () => (await api<{ unread: number }>('/conversations/unread-count')).unread });

export const useMessages = (conversationId: string | undefined) =>
  useQuery({ queryKey: ['messages', conversationId], enabled: !!conversationId, queryFn: () => api<MessagePage>(`/conversations/${conversationId}/messages?limit=50`) });

/** Open (or create) the conversation for an application and return its id. */
export async function openConversation(applicationId: string): Promise<string> {
  return (await api<{ conversationId: string }>(`/applications/${applicationId}/conversation`, { method: 'POST' })).conversationId;
}

export interface NotificationSettings { notifyJobMatches: boolean; notifySms: boolean; phoneVerified: boolean; smsProviderConfigured: boolean; autoApply: boolean; autoApplyMinScore: number }
export const useNotificationSettings = () =>
  useQuery({ queryKey: ['notification-settings'], queryFn: () => api<NotificationSettings>('/notifications/settings') });
