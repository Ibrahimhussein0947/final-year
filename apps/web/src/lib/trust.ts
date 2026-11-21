import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Trust {
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  proven: { identity: boolean; education: boolean; experience: boolean; credentials: boolean };
}
export interface NextStep { key: string; text: string; done: boolean; link: string }
export interface MyTrust extends Trust { next: NextStep[]; steps: NextStep[] }

export const useMyTrust = () =>
  useQuery({ queryKey: ['my-trust'], queryFn: async () => (await api<{ trust: MyTrust }>('/workers/me/trust')).trust });
