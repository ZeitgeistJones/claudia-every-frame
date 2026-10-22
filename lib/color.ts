// Minimal sRGB → CIELAB helpers for Studio target sampling in the browser.

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  return [
    R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    R * 0.2126729 + G * 0.7151522 + B * 0.072175,
    R * 0.0193339 + G * 0.119192 + B * 0.9503041,
  ];
}

function fLab(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = rgbToXyz(r, g, b);
  // D65 white
  const fx = fLab(x / 0.95047);
  const fy = fLab(y / 1.0);
  const fz = fLab(z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Sample mean Lab per mosaic cell from an ImageBitmap / canvas-drawn image. */
export function sampleCellLabs(
  ctx: CanvasRenderingContext2D,
  cols: number,
  rows: number,
): Array<[number, number, number]> {
  const { width, height } = ctx.canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const cellW = width / cols;
  const cellH = height / rows;
  const out: Array<[number, number, number]> = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let L = 0;
      let a = 0;
      let b = 0;
      let n = 0;
      const x0 = Math.floor(col * cellW);
      const y0 = Math.floor(row * cellH);
      const x1 = Math.floor((col + 1) * cellW);
      const y1 = Math.floor((row + 1) * cellH);
      // Subsample for speed
      const stepX = Math.max(1, Math.floor((x1 - x0) / 4));
      const stepY = Math.max(1, Math.floor((y1 - y0) / 4));
      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const i = (y * width + x) * 4;
          const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
          L += lab[0];
          a += lab[1];
          b += lab[2];
          n++;
        }
      }
      out.push([L / n, a / n, b / n]);
    }
  }
  return out;
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

/** Cover-crop draw into canvas. */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  vAnchor = 0.4,
): void {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = Math.max(0, Math.min(img.naturalHeight - sh, (img.naturalHeight - sh) * vAnchor));
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}
