import Tesseract from 'tesseract.js';

// ---------- VIN helpers ----------
export function normalizeVin(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[IOQ]/g, '')
    .slice(0, 17);
}

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
  out.width = src.width; out.height = src.height;
  const s = src.getContext('2d')!;
  const d = out.getContext('2d')!;
  const img = s.getImageData(0, 0, src.width, src.height);
  const a = img.data;
  for (let i = 0; i < a.length; i += 4) {
    const lum = a[i]*0.299 + a[i+1]*0.587 + a[i+2]*0.114;
    const bin = lum > th ? 255 : 0;
    const val = invert ? (255 - bin) : bin;
    a[i] = a[i+1] = a[i+2] = val;
  }
  d.putImageData(img, 0, 0);
  return out;
}

function gammaCanvas(src: HTMLCanvasElement, gamma = 1.25): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width; out.height = src.height;
  const s = src.getContext('2d')!;
  const d = out.getContext('2d')!;
  const img = s.getImageData(0, 0, src.width, src.height);
  const a = img.data;
  const g = 1 / Math.max(0.01, gamma);
  for (let i = 0; i < a.length; i += 4) {
    a[i]   = 255 * Math.pow(a[i]  /255, g);
    a[i+1] = 255 * Math.pow(a[i+1]/255, g);
    a[i+2] = 255 * Math.pow(a[i+2]/255, g);
  }
  d.putImageData(img, 0, 0);
  return out;
}

// tiny unsharp mask (light)
function sharpenCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width; out.height = src.height;
  const s = src.getContext('2d')!;
  const d = out.getContext('2d')!;
  d.drawImage(src, 0, 0);
  // 3x3 sharpen kernel
  const w = src.width, h = src.height;
  const img = d.getImageData(0,0,w,h);
  const a = img.data;
  const copy = new Uint8ClampedArray(a); // simple conv without separable pass
  const idx = (x:number,y:number) => (y*w + x)*4;
  const k = [ 0,-1, 0, -1, 5,-1, 0,-1, 0 ];

  for (let y=1; y<h-1; y++) {
    for (let x=1; x<w-1; x++) {
      for (let c=0;c<3;c++) {
        let acc=0, p=0;
        for (let ky=-1; ky<=1; ky++) for (let kx=-1; kx<=1; kx++) {
          p = copy[idx(x+kx,y+ky)+c];
          acc += p * k[(ky+1)*3 + (kx+1)];
        }
        a[idx(x,y)+c] = Math.max(0, Math.min(255, acc));
      }
    }
  }
  d.putImageData(img,0,0);
  return out;
}

// ---------- OCR ----------
async function ocrCanvas(canvas: HTMLCanvasElement, psm: number, timeoutMs = 4500): Promise<string | null> {
  const run = async () => {
    const { data } = await Tesseract.recognize(canvas, 'eng', {
      // Make Tesseract VIN-biased
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      tessedit_char_blacklist: ':/.,;_()[]{}!@#$%^&*+=?~`\'"',
      // Page segmentation modes:
      // 6: block of text; 7: single line; 11: sparse text; 13: raw line
      psm,
      // oem: 1 // (optional) LSTM only
    } as any);
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
