import { createWorker, PSM } from 'tesseract.js';

export type Progress = (message: string, fraction?: number) => void;

/** All OCR assets are served by this app (see scripts/copy-ocr-assets.mjs): no calls to outside servers. */
function assetUrl(path: string) {
  return new URL(`ocr/${path}`, document.baseURI).href;
}

/** OCR a list of page images (canvases or image files) and return the text in reading order. */
export async function ocrImages(images: (HTMLCanvasElement | Blob)[], onProgress?: Progress): Promise<string> {
  onProgress?.('Loading text recognition…');
  let label = '';
  const worker = await createWorker('eng', 1, {
    workerPath: assetUrl('worker.min.js'),
    corePath: assetUrl('core/'),
    langPath: assetUrl('lang'),
    gzip: true,
    cacheMethod: 'none',
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.(`Reading text${label}…`, m.progress);
    },
  });
  try {
    // Statements are tables: keep each printed row on one line instead of splitting columns into blocks.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
    const pages: string[] = [];
    for (let i = 0; i < images.length; i++) {
      label = images.length > 1 ? ` (page ${i + 1} of ${images.length})` : '';
      const { data } = await worker.recognize(images[i]);
      pages.push(data.text);
    }
    return pages.join('\n');
  } finally {
    await worker.terminate();
  }
}
