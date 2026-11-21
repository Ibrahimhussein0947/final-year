import { spawn } from 'node:child_process';
import { AppError } from '../../lib/errors';

/**
 * Decode untrusted pictures in a throwaway child process.
 *
 * The native decoder in @napi-rs/canvas crashes the WHOLE Node process (a segmentation fault, no exception to catch) on
 * some corrupt files, for example a PNG with a valid header and a damaged body. Decoding in-process would let one bad upload
 * take the server down for everyone. In a child process the worst case is that the child dies and the upload is refused.
 */
const SCRIPT = `
const { createCanvas, loadImage } = require(process.env.CANVAS_LIB);
const maxSide = Number(process.env.MAX_SIDE), quality = Number(process.env.QUALITY), maxPixels = Number(process.env.MAX_PIXELS), reencode = process.env.REENCODE === '1';
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  try {
    const img = await loadImage(Buffer.concat(chunks));
    if (img.width < 1 || img.height < 1 || img.width * img.height > maxPixels) { process.stdout.write('TOOBIG'); return; }
    if (!reencode) { process.stdout.write('OK'); return; }
    const s = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
    const canvas = createCanvas(w, h); const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    process.stdout.write(canvas.toBuffer('image/jpeg', quality));
  } catch { process.stdout.write('BAD'); }
});
`;

const TIMEOUT_MS = 20_000;
export const MAX_PIXELS = 40_000_000;

function run(input: Buffer, env: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', SCRIPT], { env: { PATH: process.env.PATH ?? '', CANVAS_LIB: require.resolve('@napi-rs/canvas'), MAX_PIXELS: String(MAX_PIXELS), ...env }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const out: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stdout.on('data', (c) => out.push(c));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`decoder exited with ${code}`)); });
    child.stdin.on('error', () => undefined); // the child may die before reading everything
    child.stdin.end(input);
  });
}

const unreadable = () => new AppError(415, 'UNSUPPORTED_FILE', 'This file could not be read as a picture. Use a JPG or PNG photo.');
const tooBig = () => new AppError(413, 'FILE_TOO_LARGE', 'This picture is too large. Use a smaller photo.');

/** Decode, scale down to `maxSide` and write a fresh JPEG: strips hidden metadata and rejects anything that is not a real picture. */
export async function reencodeImage(buf: Buffer, opts: { maxSide?: number; quality?: number } = {}): Promise<Buffer> {
  let out: Buffer;
  try {
    out = await run(buf, { REENCODE: '1', MAX_SIDE: String(opts.maxSide ?? 1600), QUALITY: String(opts.quality ?? 85) });
  } catch {
    throw unreadable(); // the decoder crashed or timed out
  }
  if (out.length < 4 || out.subarray(0, 3).toString('latin1') === 'BAD') throw unreadable();
  if (out.toString('latin1') === 'TOOBIG') throw tooBig();
  if (!(out[0] === 0xff && out[1] === 0xd8)) throw unreadable();
  return out;
}

/** True when the picture can be decoded and is not absurdly large. Use before decoding it in this process. */
export async function assertDecodable(buf: Buffer): Promise<void> {
  let out: Buffer;
  try {
    out = await run(buf, { REENCODE: '0', MAX_SIDE: '1', QUALITY: '1' });
  } catch {
    throw unreadable();
  }
  const text = out.toString('latin1');
  if (text === 'TOOBIG') throw tooBig();
  if (text !== 'OK') throw unreadable();
}
