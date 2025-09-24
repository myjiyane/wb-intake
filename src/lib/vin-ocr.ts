import Tesseract from 'tesseract.js';
import { normalizeVin } from './vin';

// ---------- VIN helpers ----------
export { normalizeVin } from './vin';

type RecognizeConfig = Partial<Tesseract.WorkerOptions> & Partial<Tesseract.WorkerParams> & { tessedit_pageseg_mode?: Tesseract.PSM };

function findVinCandidates(text: string): string[] {
  const U = text.toUpperCase();

  // allow spaces / dashes between characters (OCR noise)
  const CHUNKY = /(?:[A-Z0-9][ -]?){11,25}/g;

  // also search lines that mention VIN explicitly
  const lines = U.split(/\r?\n/);
  const near = lines.filter(l => /\bVIN\b/.test(l));

  const rawHits = [
    ...(U.match(CHUNKY) || []),
    ...near.flatMap(l => l.match(CHUNKY) || []),
  ];

  const uniq = new Set<string>();
  for (const h of rawHits) {
    const norm = normalizeVin(h);
    if (norm.length >= 11) uniq.add(norm);
  }

  const all = [...uniq];
  // prefer exact 17, then longer
  all.sort((a, b) => {
    const a17 = a.length === 17 ? 1 : 0;
    const b17 = b.length === 17 ? 1 : 0;
    if (b17 !== a17) return b17 - a17;
    if (b.length !== a.length) return b.length - a.length;
    return 0;
  });
  return all;
}

// ---------- image utils ----------
async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await new Promise<void>((r, j) => {
    img.onload = () => r();
    img.onerror = (e) => j(e);
  });
  return img;
}

function drawToCanvas(img: HTMLImageElement, maxW = 1200): HTMLCanvasElement {
  const s = img.width > maxW ? maxW / img.width : 1;
  const w = Math.max(1, Math.round(img.width * s));
  const h = Math.max(1, Math.round(img.height * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return c;
}

function thresholdCanvas(src: HTMLCanvasElement, th = 170, invert = false): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const source = src.getContext('2d');
  const destination = out.getContext('2d');
  if (!source || !destination) return out;

  const img = source.getImageData(0, 0, src.width, src.height);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const bin = lum > th ? 255 : 0;
    const val = invert ? 255 - bin : bin;
    data[i] = data[i + 1] = data[i + 2] = val;
  }
  destination.putImageData(img, 0, 0);
  return out;
}



function gammaCanvas(src: HTMLCanvasElement, gamma = 1.25): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const source = src.getContext('2d');
  const destination = out.getContext('2d');
  if (!source || !destination) return out;

  const img = source.getImageData(0, 0, src.width, src.height);
  const data = img.data;
  const exponent = 1 / Math.max(0.01, gamma);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 * Math.pow(data[i] / 255, exponent);
    data[i + 1] = 255 * Math.pow(data[i + 1] / 255, exponent);
    data[i + 2] = 255 * Math.pow(data[i + 2] / 255, exponent);
  }
  destination.putImageData(img, 0, 0);
  return out;
}

// tiny unsharp mask (light)
function sharpenCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const destination = out.getContext('2d');
  if (!destination) return out;

  destination.drawImage(src, 0, 0);
  const w = src.width;
  const h = src.height;
  const img = destination.getImageData(0, 0, w, h);
  const data = img.data;
  const copy = new Uint8ClampedArray(data);
  const idx = (x: number, y: number) => (y * w + x) * 4;
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        let kIndex = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            acc += copy[idx(x + kx, y + ky) + c] * kernel[kIndex++];
          }
        }
        data[idx(x, y) + c] = Math.max(0, Math.min(255, acc));
      }
    }
  }

  destination.putImageData(img, 0, 0);
  return out;
}

// ---------- OCR ----------
async function ocrCanvas(canvas: HTMLCanvasElement, psm: number, timeoutMs = 4500): Promise<string | null> {
  const run = async () => {
    const options: RecognizeConfig = {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      tessedit_char_blacklist: ':/.,;_()[]{}!@#$%^&*+=?~`\'"',
      tessedit_pageseg_mode: String(psm) as Tesseract.PSM,
    };
    const { data } = await Tesseract.recognize(canvas, 'eng', options);
    const cands = findVinCandidates(String(data.text || ''));
    return cands.length ? cands[0] : null;
  };
  return Promise.race([ run(), new Promise<null>(r => setTimeout(() => r(null), timeoutMs)) ]);
}

/** Robust public API */
export async function extractVinFromImage(file: File): Promise<string | null> {
  const img = await loadImage(file);
  const base = drawToCanvas(img, 1200);

  // Build candidate canvases (fast to slow)
  const variants: HTMLCanvasElement[] = [
    base,
    thresholdCanvas(base, 170, false),
    thresholdCanvas(base, 185, false),
    thresholdCanvas(base, 200, false),
    thresholdCanvas(base, 170, true),   // inverted
    gammaCanvas(base, 1.35),
    sharpenCanvas(thresholdCanvas(base, 185, false)),
  ];

  const psms = [7, 6, 11, 13]; // try single-line first (often best for your sample)

  for (const cv of variants) {
    for (const p of psms) {
      const vin = await ocrCanvas(cv, p, 4500);
      if (vin) return vin;
    }
  }
  return null;
}




