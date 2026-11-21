import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createAfricasTalkingSms, createNotifier, createResendEmail } from '../integrations/notify';

type Call = { url: string; headers: http.IncomingHttpHeaders; raw: string };

function server(status: number, reply: unknown) {
  const calls: Call[] = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      calls.push({ url: req.url ?? '', headers: req.headers, raw });
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply));
    });
  });
  return new Promise<{ base: string; calls: Call[]; close: () => Promise<void> }>((resolve) =>
    srv.listen(0, '127.0.0.1', () =>
      resolve({ base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, calls, close: () => new Promise((r) => srv.close(() => r())) }),
    ),
  );
}

describe("Africa's Talking SMS adapter", () => {
  it('posts a form with the apiKey header', async () => {
    const s = await server(201, { SMSMessageData: { Recipients: [{ statusCode: 101, status: 'Success' }] } });
    await createAfricasTalkingSms('myuser', 'key-12345678', 'EthioTalent', false, fetch, s.base)('+251911000000', 'Hello there');
    const form = new URLSearchParams(s.calls[0].raw);
    expect(s.calls[0].url).toBe('/version1/messaging');
    expect(s.calls[0].headers.apikey).toBe('key-12345678');
    expect(Object.fromEntries(form)).toEqual({ username: 'myuser', to: '+251911000000', message: 'Hello there', from: 'EthioTalent' });
    await s.close();
  });

  it('omits the sender when none is set', async () => {
    const s = await server(201, { SMSMessageData: { Recipients: [{ statusCode: 100 }] } });
    await createAfricasTalkingSms('u', 'key-12345678', undefined, false, fetch, s.base)('+251911000000', 'x');
    expect(new URLSearchParams(s.calls[0].raw).has('from')).toBe(false);
    await s.close();
  });

  it('throws when a recipient is rejected even though HTTP said 201, and when HTTP fails', async () => {
    const rejected = await server(201, { SMSMessageData: { Recipients: [{ statusCode: 403, status: 'InvalidPhoneNumber' }] } });
    await expect(createAfricasTalkingSms('u', 'key-12345678', undefined, false, fetch, rejected.base)('+251911000000', 'x')).rejects.toThrow('InvalidPhoneNumber');
    await rejected.close();
    const down = await server(401, {});
    await expect(createAfricasTalkingSms('u', 'key-12345678', undefined, false, fetch, down.base)('+251911000000', 'x')).rejects.toThrow('401');
    await down.close();
  });
});

describe('Resend email adapter', () => {
  it('posts JSON with a bearer token', async () => {
    const s = await server(200, { id: 'abc' });
    await createResendEmail('re_key_12345', 'EthioTalent <no-reply@example.com>', fetch, s.base)('a@b.com', 'Subject', 'Body');
    expect(s.calls[0].url).toBe('/emails');
    expect(s.calls[0].headers.authorization).toBe('Bearer re_key_12345');
    expect(JSON.parse(s.calls[0].raw)).toEqual({ from: 'EthioTalent <no-reply@example.com>', to: ['a@b.com'], subject: 'Subject', text: 'Body' });
    await s.close();
  });

  it('throws on provider errors, but the notifier swallows them', async () => {
    const s = await server(422, { message: 'bad' });
    const send = createResendEmail('re_key_12345', 'a@example.com', fetch, s.base);
    await expect(send('a@b.com', 's', 't')).rejects.toThrow('422');
    await expect(createNotifier(undefined, send).sendEmail('a@b.com', 's', 't')).resolves.toBeUndefined();
    await s.close();
  });

  it('reports whether email is configured', () => {
    expect(createNotifier().emailConfigured?.()).toBe(false);
    expect(createNotifier(undefined, async () => undefined).emailConfigured?.()).toBe(true);
  });
});
