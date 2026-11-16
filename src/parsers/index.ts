import type { ParsedStatement } from '../types';
import type { DateOrder } from '../lib/dates';
import { parseCsv } from './csv';
import { parseOfx } from './ofx';
import { parseStatementText } from './text';
import { metaFromFileName } from './meta';

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function parseFile(
  file: File,
  dateOrder: 'auto' | DateOrder = 'auto',
): Promise<{ parsed: ParsedStatement; hash: string }> {
  const buf = await file.arrayBuffer();
  const hash = await sha256(buf);
  const name = file.name.toLowerCase();
  const forced = dateOrder === 'auto' ? undefined : dateOrder;
  let parsed: ParsedStatement;

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const { pdfToText } = await import('./pdf');
    const text = await pdfToText(buf);
    parsed = parseStatementText(text, forced ?? 'MDY', 'pdf');
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
  return { parsed, hash };
}

function looksLikeCsv(text: string): boolean {
  const lines = text.split(/\r?\n/).slice(0, 10).filter(Boolean);
  return lines.length > 1 && lines.every((l) => l.split(',').length >= 3);
}
