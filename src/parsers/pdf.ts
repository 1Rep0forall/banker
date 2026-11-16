import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Render each PDF page to a canvas (for OCR of scanned statements). */
export async function pdfToImages(data: ArrayBuffer, scale = 2.5): Promise<HTMLCanvasElement[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const out: HTMLCanvasElement[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 30); p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push(canvas);
  }
  await doc.destroy();
  return out;
}

/** True when a PDF has (almost) no text layer, i.e. it's a scan or photo. */
export function looksScanned(text: string, pages = 1): boolean {
  const letters = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  return letters < 80 * Math.max(1, pages);
}

interface Item { str: string; x: number; y: number; w: number }

/** Extract text from a PDF, rebuilding visual lines from positioned text items. */
export async function pdfToText(data: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width });
    }
    // group by y (top to bottom), tolerance of ~3 units
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Item[][] = [];
    for (const it of items) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(line[0].y - it.y) < 3) line.push(it);
      else lines.push([it]);
    }
    pages.push(
      lines
        .map((l) =>
          l
            .sort((a, b) => a.x - b.x)
            .reduce((acc, it, i) => {
              if (i === 0) return it.str;
              const prev = l[i - 1];
              const gap = it.x - (prev.x + prev.w);
              return acc + (gap > 1 ? '  ' : '') + it.str;
            }, ''),
        )
        .join('\n'),
    );
  }
  const numPages = doc.numPages;
  await doc.destroy();
  return { text: pages.join('\n'), pages: numPages };
}
