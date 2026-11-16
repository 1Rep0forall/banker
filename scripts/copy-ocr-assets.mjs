// Copies the OCR engine and English language data into public/ocr so the app
// can read scanned statements fully offline (nothing is fetched from a CDN).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const out = 'public/ocr';
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

copyFileSync(join(pkgDir('tesseract.js'), 'dist/worker.min.js'), join(out, 'worker.min.js'));
const core = pkgDir('tesseract.js-core');
for (const f of readdirSync(core)) if (/^tesseract-core.*lstm\.wasm\.js$/.test(f)) copyFileSync(join(core, f), join(out, 'core', f));
const lang = join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz');
if (!existsSync(lang)) throw new Error('English OCR language data not found: ' + lang);
copyFileSync(lang, join(out, 'lang/eng.traineddata.gz'));
console.log('OCR assets copied to', out);
