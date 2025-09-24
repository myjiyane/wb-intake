export interface ImageAnalysis {
  brightness: number;
  contrast: number;
  sharpness: number;
  centerContrast: number;
  edgeContrast: number;
  framingScore: number;
  cropApplied: boolean;
  cropBounds: { x: number; y: number; width: number; height: number };
  originalDimensions: { width: number; height: number };
  processedDimensions: { width: number; height: number };
  shouldRetake: boolean;
  issues: string[];
}

export interface AnalyzeOptions {
  target: 'vin' | 'odometer';
  marginRatio?: number;
  preferredMimeType?: 'image/jpeg' | 'image/png';
}

export interface AnalyzeResult {
  processedFile: File;
  originalFile: File;
  analysis: ImageAnalysis;
  marginRatio: number;
}

const DEFAULT_MARGIN: Record<AnalyzeOptions['target'], number> = {
  vin: 0.12,
  odometer: 0.1,
};

const JPEG_MIME = 'image/jpeg';

const TARGET_THRESHOLDS = {
  vin: {
    brightnessMin: 45,
    brightnessMax: 215,
    contrastMin: 22,
    sharpnessMin: 13,
    framingScoreMin: 6,
  },
  odometer: {
    brightnessMin: 55,
    brightnessMax: 205,
    contrastMin: 26,
    sharpnessMin: 15,
    framingScoreMin: 5,
  },
} as const;

async function loadImage(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

function computeMetrics(imageData: ImageData) {
  const { width, height, data } = imageData;
  const maxSamples = 120000;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / maxSamples)));
  let sum = 0;
  let sumSq = 0;
  let gradientSum = 0;
  let gradientSamples = 0;
  let samples = 0;

  const at = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const lum = at(x, y);
      sum += lum;
      sumSq += lum * lum;
      samples++;

      if (x + step < width) {
        gradientSum += Math.abs(lum - at(x + step, y));
        gradientSamples++;
      }
      if (y + step < height) {
        gradientSum += Math.abs(lum - at(x, y + step));
        gradientSamples++;
      }
    }
  }

  const brightness = samples ? sum / samples : 0;
  const variance = samples ? sumSq / samples - brightness * brightness : 0;
  const contrast = variance > 0 ? Math.sqrt(variance) : 0;
  const sharpness = gradientSamples ? gradientSum / gradientSamples : 0;

  return { brightness, contrast, sharpness };
}

function computeRegionStats(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0Ratio: number,
  x1Ratio: number,
  y0Ratio: number,
  y1Ratio: number,
) {
  const x0 = Math.max(0, Math.floor(width * x0Ratio));
  const x1 = Math.min(width, Math.ceil(width * x1Ratio));
  const y0 = Math.max(0, Math.floor(height * y0Ratio));
  const y1 = Math.min(height, Math.ceil(height * y1Ratio));

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum;
      sumSq += lum * lum;
      count++;
    }
  }

  if (!count) {
    return { brightness: 0, contrast: 0 };
  }

  const brightness = sum / count;
  const variance = sumSq / count - brightness * brightness;
  return {
    brightness,
    contrast: variance > 0 ? Math.sqrt(variance) : 0,
  };
}

function computeEdgeStats(data: Uint8ClampedArray, width: number, height: number) {
  const band = 0.18;
  const top = computeRegionStats(data, width, height, 0, 1, 0, band);
  const bottom = computeRegionStats(data, width, height, 0, 1, 1 - band, 1);
  const left = computeRegionStats(data, width, height, 0, band, band, 1 - band);
  const right = computeRegionStats(data, width, height, 1 - band, 1, band, 1 - band);

  const brightness = (top.brightness + bottom.brightness + left.brightness + right.brightness) / 4;
  const contrast = (top.contrast + bottom.contrast + left.contrast + right.contrast) / 4;

  return { brightness, contrast };
}

function canvasToFile(canvas: HTMLCanvasElement, original: File, mime: string, quality = 0.95): Promise<File> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(original);
        return;
      }
      const nameParts = original.name.split('.');
      if (nameParts.length > 1) nameParts.pop();
      const extension = mime === JPEG_MIME ? 'jpg' : original.name.split('.').pop() ?? 'png';
      const newName = `${nameParts.join('.') || 'capture'}-crop.${extension}`;
      resolve(new File([blob], newName, { type: mime, lastModified: Date.now() }));
    }, mime, mime === JPEG_MIME ? quality : undefined);
  });
}

export async function analyzeAndCropImage(file: File, options: AnalyzeOptions): Promise<AnalyzeResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File must be an image');
  }

  const marginRatio = typeof options.marginRatio === 'number'
    ? Math.min(Math.max(options.marginRatio, 0), 0.25)
    : DEFAULT_MARGIN[options.target];
  const preferredMime = options.preferredMimeType ?? (file.type === JPEG_MIME ? JPEG_MIME : file.type);

  const baseCanvas = await loadImage(file);
  const baseCtx = baseCanvas.getContext('2d');
  if (!baseCtx) throw new Error('Canvas 2D context unavailable');

  const baseImageData = baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);

  const { canvas: croppedCanvas, bounds, applied } = await cropCanvas(baseCanvas, marginRatio);
  const croppedCtx = croppedCanvas.getContext('2d');
  if (!croppedCtx) throw new Error('Canvas 2D context unavailable');
  const croppedMetrics = computeMetrics(croppedCtx.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height));

  const centerStats = computeRegionStats(
    baseImageData.data,
    baseCanvas.width,
    baseCanvas.height,
    0.25,
    0.75,
    0.25,
    0.75,
  );
  const edgeStats = computeEdgeStats(baseImageData.data, baseCanvas.width, baseCanvas.height);
  const framingScore = centerStats.contrast - edgeStats.contrast;

  const issues: string[] = [];
  const thresholds = TARGET_THRESHOLDS[options.target];

  if (croppedMetrics.brightness < thresholds.brightnessMin) {
    issues.push('Image too dark');
  } else if (croppedMetrics.brightness > thresholds.brightnessMax) {
    issues.push('Image overexposed');
  }

  if (croppedMetrics.contrast < thresholds.contrastMin) {
    issues.push('Low contrast');
  }

  if (croppedMetrics.sharpness < thresholds.sharpnessMin) {
    issues.push('Image appears blurry');
  }

  if (framingScore < thresholds.framingScoreMin) {
    issues.push(options.target === 'vin' ? 'VIN not centered in framing guide' : 'Odometer cluster not centered');
  }

  const processedFile = applied
    ? await canvasToFile(croppedCanvas, file, preferredMime)
    : file;

  const analysis: ImageAnalysis = {
    brightness: croppedMetrics.brightness,
    contrast: croppedMetrics.contrast,
    sharpness: croppedMetrics.sharpness,
    centerContrast: centerStats.contrast,
    edgeContrast: edgeStats.contrast,
    framingScore,
    cropApplied: applied,
    cropBounds: bounds,
    originalDimensions: { width: baseCanvas.width, height: baseCanvas.height },
    processedDimensions: { width: croppedCanvas.width, height: croppedCanvas.height },
    shouldRetake: issues.length > 0,
    issues,
  };

  return {
    processedFile,
    originalFile: file,
    analysis,
    marginRatio,
  };
}

async function cropCanvas(source: HTMLCanvasElement, marginRatio: number) {
  if (marginRatio <= 0) {
    return {
      canvas: source,
      bounds: { x: 0, y: 0, width: source.width, height: source.height },
      applied: false,
    };
  }

  const marginX = Math.round(source.width * marginRatio);
  const marginY = Math.round(source.height * marginRatio);
  const cropWidth = source.width - marginX * 2;
  const cropHeight = source.height - marginY * 2;

  if (cropWidth <= 0 || cropHeight <= 0) {
    return {
      canvas: source,
      bounds: { x: 0, y: 0, width: source.width, height: source.height },
      applied: false,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const ctx = canvas.getContext('2d');
  const srcCtx = source.getContext('2d');
  if (!ctx || !srcCtx) throw new Error('Canvas 2D context unavailable');
  const imageData = srcCtx.getImageData(marginX, marginY, cropWidth, cropHeight);
  ctx.putImageData(imageData, 0, 0);

  return {
    canvas,
    bounds: { x: marginX, y: marginY, width: cropWidth, height: cropHeight },
    applied: marginX > 0 || marginY > 0,
  };
}