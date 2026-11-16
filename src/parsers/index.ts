import type { ParsedStatement } from '../types';
import type { DateOrder } from '../lib/dates';
import { parseCsv } from './csv';
import { parseOfx } from './ofx';
import { parseStatementText } from './text';
import { metaFromFileName } from './meta';
import type { Progress } from './ocr';

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const IMAGE = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;

export const ACCEPTED_FILES = '.pdf,.csv,.tsv,.ofx,.qfx,.qbo,.txt,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff';

export async function parseFile(
  file: File,
  dateOrder: 'auto' | DateOrder = 'auto',
  onProgress?: Progress,
): Promise<{ parsed: ParsedStatement; hash: string }> {
  const buf = await file.arrayBuffer();
  const hash = await sha256(buf);
  const name = file.name.toLowerCase();
  const forced = dateOrder === 'auto' ? undefined : dateOrder;
  let parsed: ParsedStatement;

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const { pdfToText, pdfToImages, looksScanned } = await import('./pdf');
    const { text, pages } = await pdfToText(buf);
    if (looksScanned(text, pages)) {
      // Scanned statement: render pages and read them with OCR, all on this device.
      onProgress?.('This looks like a scanned PDF. Preparing pages…');
      const images = await pdfToImages(buf);
      const { ocrImages } = await import('./ocr');
      parsed = parseStatementText(await ocrImages(images, onProgress), forced ?? 'MDY', 'pdf', true);
    } else {
      parsed = parseStatementText(text, forced ?? 'MDY', 'pdf');
    }
  } else if (IMAGE.test(name) || file.type.startsWith('image/')) {
    const { ocrImages } = await import('./ocr');
    parsed = parseStatementText(await ocrImages([file], onProgress), forced ?? 'MDY', 'image', true);
  } else {
    const text = new TextDecoder().decode(buf);
    if (name.endsWith('.ofx') || name.endsWith('.qfx') || name.endsWith('.qbo') || /<OFX>/i.test(text.slice(0, 2000))) {
      parsed = parseOfx(text);
    } else if (name.endsWith('.csv') || name.endsWith('.tsv') || looksLikeCsv(text)) {
      parsed = parseCsv(text, file.name, forced);
    } else {
      parsed = parseStatementText(text, forced ?? 'MDY', 'text');
    }
  }
  // Fill gaps from the file name (e.g. "Chase_1234.csv")
  const fromName = metaFromFileName(file.name);
  for (const [k, v] of Object.entries(fromName)) {
    if ((parsed as unknown as Record<string, unknown>)[k] === undefined) (parsed as unknown as Record<string, unknown>)[k] = v;
  }
  if (parsed.ocr && parsed.transactions.length) {
    parsed.warnings.unshift('Read with text recognition (OCR) because this is a scanned image. Please double-check the amounts and dates below before importing.');
  }
  return { parsed, hash };
}

function looksLikeCsv(text: string): boolean {
  const lines = text.split(/\r?\n/).slice(0, 10).filter(Boolean);
  return lines.length > 1 && lines.every((l) => l.split(',').length >= 3);
}
