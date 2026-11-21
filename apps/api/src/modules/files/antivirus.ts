import net from 'node:net';
import { env } from '../../config/env';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';

/**
 * Antivirus check for uploads, using a ClamAV daemon (clamd) over its plain TCP INSTREAM protocol, so no extra package is needed.
 *
 *  - CLAMAV_HOST unset: scanning is off and uploads work as before.
 *  - Scanner reachable: an infected file is rejected before anything is written to disk, and the block is audited.
 *  - Scanner configured but unreachable: the upload is accepted with a warning in the log, unless CLAMAV_REQUIRED=true,
 *    in which case it is refused (503) so nothing unscanned gets in.
 * A clean result means "no known signature matched", not "safe": keep the signature database updated (freshclam does this).
 */
export type ScanResult = { status: 'clean' } | { status: 'infected'; signature: string };
export type VirusScanner = (data: Buffer) => Promise<ScanResult>;

const CHUNK = 64 * 1024;

export function createClamdScanner(host: string, port: number, timeoutMs = 15_000): VirusScanner {
  return (data) =>
    new Promise<ScanResult>((resolve, reject) => {
      const socket = net.connect({ host, port });
      let reply = '';
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error('clamd timed out'))), timeoutMs);

      const parse = () => {
        // Replies look like "stream: OK", "stream: Eicar-Test-Signature FOUND" or "INSTREAM size limit exceeded. ERROR".
        const text = reply.replace(/\0/g, '').trim();
        if (/\bFOUND$/.test(text)) {
          const signature = text.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '') || 'unknown';
          finish(() => resolve({ status: 'infected', signature }));
        } else if (/\bOK$/.test(text)) finish(() => resolve({ status: 'clean' }));
        else finish(() => reject(new Error(`clamd answered: ${text.slice(0, 120) || 'nothing'}`)));
      };

      socket.on('error', (err) => finish(() => reject(err)));
      socket.on('data', (d) => {
        reply += d.toString('utf8');
        if (reply.includes('\0')) parse(); // zINSTREAM replies end with a NUL byte
      });
      socket.on('close', () => {
        if (!settled) parse();
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let i = 0; i < data.length; i += CHUNK) {
          const part = data.subarray(i, i + CHUNK);
          const header = Buffer.alloc(4);
          header.writeUInt32BE(part.length);
          socket.write(header);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // a zero-length chunk ends the stream
      });
    });
}

let scanner: VirusScanner | null = env.CLAMAV_HOST ? createClamdScanner(env.CLAMAV_HOST, env.CLAMAV_PORT) : null;
/** Swap the scanner (tests, or a different engine). */
export function setVirusScanner(next: VirusScanner | null) {
  scanner = next;
}
export const virusScanningEnabled = () => scanner !== null;

/** Throws if the file is infected, or (with CLAMAV_REQUIRED) if it could not be scanned. */
export async function assertClean(data: Buffer, ownerId: string, kind: string): Promise<void> {
  const unavailable = () => new AppError(503, 'SCAN_UNAVAILABLE', 'Files cannot be checked for viruses right now. Please try again later.');
  if (!scanner) {
    if (env.CLAMAV_REQUIRED) throw unavailable();
    return;
  }
  let result: ScanResult;
  try {
    result = await scanner(data);
  } catch (err) {
    logger.warn({ err: String(err), kind }, 'virus scan failed');
    if (env.CLAMAV_REQUIRED) throw unavailable();
    return;
  }
  if (result.status === 'infected') {
    logger.warn({ ownerId, kind, signature: result.signature }, 'upload blocked: malware detected');
    await audit(null, ownerId, 'file.malware_blocked', 'File', undefined, { kind, signature: result.signature });
    throw new AppError(422, 'MALWARE_DETECTED', 'This file was blocked because it may contain a virus. Scan your device and upload a clean copy.');
  }
}
