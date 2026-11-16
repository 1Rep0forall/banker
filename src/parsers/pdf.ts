import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Item { str: string; x: number; y: number; w: number }

/** Extract text from a PDF, rebuilding visual lines from positioned text items. */
export async function pdfToText(data: ArrayBuffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
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
  await doc.destroy();
  return pages.join('\n');
}
