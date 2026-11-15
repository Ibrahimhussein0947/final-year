import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import HiringBoardPage from '@/pages/employer/HiringBoard';

const row = (id: string, name: string, status: string, allowedNext: string[], extra: object = {}) => ({
  id, status, appliedAt: '2026-11-01T00:00:00Z', coverNote: null, allowedNext,
  candidate: { workerId: `w-${id}`, name, headline: 'Mechanic', occupation: null, yearsExperience: 4, location: 'Adama', skills: [], photoUrl: null, phone: null },
  interviews: [], match: { score: 80, confidence: 0.9, strength: 'strong' }, qualified: true, autoApplied: false, ...extra,
});
const payload = {
  job: { id: 'j1', title: 'Brake technician', vacancies: 2, status: 'ACTIVE' },
  counts: {},
  items: [
    row('a1', 'Abebe Kebede', 'PENDING', ['UNDER_REVIEW', 'SHORTLISTED', 'REJECTED']),
    row('a2', 'Hanna Tesfaye', 'SHORTLISTED', ['UNDER_REVIEW', 'ACCEPTED', 'REJECTED']),
    row('a3', 'Dawit Alemu', 'REJECTED', []),
    row('a4', 'Sara Bekele', 'WITHDRAWN', []),
  ],
};

let calls: { url: string; method: string; body: string | null }[] = [];
beforeEach(() => {
  calls = [];
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: (init?.body as string) ?? null });
    if (String(url).includes('/status')) return new Response('{}', { status: 200 });
    if (String(url).includes('/applications')) return new Response(JSON.stringify(payload), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => vi.unstubAllGlobals());

function renderBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <MemoryRouter initialEntries={['/employer/jobs/j1/board']}>
          <Routes><Route path="/employer/jobs/:id/board" element={<HiringBoardPage />} /></Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}
const column = (label: RegExp) => screen.getByRole('region', { name: label });

describe('hiring board', () => {
  it('puts each candidate in the column for their stage and lists withdrawn ones below', async () => {
    renderBoard();
    await screen.findByText('Abebe Kebede');
    expect(within(column(/^Pending, 1/)).getByText('Abebe Kebede')).toBeInTheDocument();
    expect(within(column(/^Shortlisted, 1/)).getByText('Hanna Tesfaye')).toBeInTheDocument();
    expect(within(column(/^Rejected, 1/)).getByText('Dawit Alemu')).toBeInTheDocument();
    expect(screen.getByText(/1 candidate withdrew: Sara Bekele/)).toBeInTheDocument();
  });

  it('moves a candidate with the card menu, using the same status call as the list', async () => {
    renderBoard();
    await screen.findByText('Abebe Kebede');
    const menu = within(column(/^Pending, 1/)).getByLabelText(/Move Abebe Kebede to/);
    expect(within(menu).queryByText('Accepted')).toBeNull(); // only moves the server allows are offered
    fireEvent.change(menu, { target: { value: 'SHORTLISTED' } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/applications/a1/status'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body!)).toEqual({ status: 'SHORTLISTED' });
  });

  it('asks before a final decision and does nothing if the employer says no', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    renderBoard();
    await screen.findByText('Hanna Tesfaye');
    fireEvent.change(within(column(/^Shortlisted, 1/)).getByLabelText(/Move Hanna Tesfaye to/), { target: { value: 'REJECTED' } });
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('refuses a drop on a stage the process does not allow, and explains why', async () => {
    renderBoard();
    await screen.findByText('Abebe Kebede');
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? '', effectAllowed: '' };
    fireEvent.dragStart(screen.getByText('Abebe Kebede').closest('li')!, { dataTransfer });
    fireEvent.drop(column(/^Accepted, 0/), { dataTransfer });
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be moved from “Pending” to “Accepted”/);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('final decisions cannot be dragged or moved', async () => {
    renderBoard();
    await screen.findByText('Dawit Alemu');
    const card = screen.getByText('Dawit Alemu').closest('li')!;
    expect(card.getAttribute('draggable')).toBe('false');
    expect(within(card).queryByLabelText(/Move Dawit Alemu to/)).toBeNull();
  });
});
