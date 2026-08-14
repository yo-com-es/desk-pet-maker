// hairpaint.js — Lienzo 2D con fondo transparente para pintar el pelo a mano,
// tal como en el video de referencia: se dibuja el contorno, se rellena con
// cubeta, y se colorea encima con el "candado de transparencia" (solo pinta
// sobre lo que ya tiene algo dibujado, nunca sobre el fondo transparente).
// Lo que queda transparente al final se recorta; lo pintado se usa como
// textura de una placa plana pegada al frente de la cabeza.

export const HAIR_CANVAS_SIZE = 512;

export class HairCanvas {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.canvas.width = HAIR_CANVAS_SIZE;
    this.canvas.height = HAIR_CANVAS_SIZE;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.color = "#1b1b1b";
    this.size = 5;
    this.tool = "brush"; // brush | bucket | eraser
    this.lockAlpha = false; // "candado de transparencia" del video
    this.stampImage = null; // ImageBitmap|HTMLImageElement — pincel personalizado subido
    this._drawing = false;
    this._undoStack = [];
    this._bind();
  }

  clear() {
    this._pushUndo();
    this.ctx.clearRect(0, 0, HAIR_CANVAS_SIZE, HAIR_CANVAS_SIZE);
  }

  isEmpty() {
    const d = this.ctx.getImageData(0, 0, HAIR_CANVAS_SIZE, HAIR_CANVAS_SIZE).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
    return true;
  }

  _bind() {
    const c = this.canvas;
    const posFromEvent = (e) => {
      const r = c.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * HAIR_CANVAS_SIZE,
        y: ((e.clientY - r.top) / r.height) * HAIR_CANVAS_SIZE,
      };
    };
    c.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this._pushUndo();
      const p = posFromEvent(e);
      if (this.tool === "bucket") {
        this._bucket(Math.floor(p.x), Math.floor(p.y));
        return;
      }
      this._drawing = true;
      this._last = p;
      this._dot(p.x, p.y);
    });
    window.addEventListener("pointermove", (e) => {
      if (!this._drawing) return;
      const p = posFromEvent(e);
      this._lineTo(this._last, p);
      this._last = p;
    });
    window.addEventListener("pointerup", () => { this._drawing = false; });
  }

  _pushUndo() {
    this._undoStack.push(this.ctx.getImageData(0, 0, HAIR_CANVAS_SIZE, HAIR_CANVAS_SIZE));
    if (this._undoStack.length > 25) this._undoStack.shift();
  }

  undo() {
    const prev = this._undoStack.pop();
    if (prev) this.ctx.putImageData(prev, 0, 0);
  }

  _stampAt(x, y) {
    const ctx = this.ctx;
    ctx.save();
    if (this.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
    } else if (this.lockAlpha) {
      // Solo colorea donde ya hay algo pintado (no pinta sobre el fondo transparente)
      ctx.globalCompositeOperation = "source-atop";
    } else {
      ctx.globalCompositeOperation = "source-over";
    }

    if (this.tool === "stamp" && this.stampImage) {
      this._drawStamp(ctx, x, y);
      ctx.restore();
      return;
    }

    if (this.tool !== "eraser") ctx.fillStyle = this.color;
    else ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(x, y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Pincel personalizado: dibuja la imagen subida, teñida con el color actual
  // (usando su canal alfa como máscara — como una estampa de goma con tinta).
  // Si no quieres teñido, sube una imagen ya a color y usa el candado de
  // transparencia apagado para pintarla tal cual.
  _drawStamp(ctx, x, y) {
    const s = this.size * 2.4;
    if (this._tintCache && this._tintCacheColor === this.color) {
      ctx.drawImage(this._tintCache, x - s / 2, y - s / 2, s, s);
      return;
    }
    const off = document.createElement("canvas");
    off.width = this.stampImage.width; off.height = this.stampImage.height;
    const octx = off.getContext("2d");
    octx.drawImage(this.stampImage, 0, 0);
    octx.globalCompositeOperation = "source-in";
    octx.fillStyle = this.color;
    octx.fillRect(0, 0, off.width, off.height);
    this._tintCache = off;
    this._tintCacheColor = this.color;
    ctx.drawImage(off, x - s / 2, y - s / 2, s, s);
  }

  setStampImage(img) {
    this.stampImage = img;
    this._tintCache = null;
  }

  _dot(x, y) { this._stampAt(x, y); }

  _lineTo(a, b) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / (this.size * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this._stampAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
  }

  _hexToRgba(hex) {
    const v = parseInt(hex.replace("#", ""), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
  }

  _bucket(sx, sy) {
    if (sx < 0 || sy < 0 || sx >= HAIR_CANVAS_SIZE || sy >= HAIR_CANVAS_SIZE) return;
    const ctx = this.ctx;
    const img = ctx.getImageData(0, 0, HAIR_CANVAS_SIZE, HAIR_CANVAS_SIZE);
    const data = img.data;
    const W = HAIR_CANVAS_SIZE, H = HAIR_CANVAS_SIZE;
    const startIdx = (sy * W + sx) * 4;
    const target = [data[startIdx], data[startIdx + 1], data[startIdx + 2], data[startIdx + 3]];
    const fill = this._hexToRgba(this.color);
    const tol = 48;
    if (Math.abs(fill[0] - target[0]) <= tol && Math.abs(fill[1] - target[1]) <= tol &&
        Math.abs(fill[2] - target[2]) <= tol && Math.abs(fill[3] - target[3]) <= tol) return;
    const match = (i) =>
      Math.abs(data[i] - target[0]) <= tol && Math.abs(data[i + 1] - target[1]) <= tol &&
      Math.abs(data[i + 2] - target[2]) <= tol && Math.abs(data[i + 3] - target[3]) <= tol;
    const stack = [[sx, sy]];
    const seen = new Uint8Array(W * H);
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const si = cy * W + cx;
      if (seen[si]) continue;
      const di = si * 4;
      if (!match(di)) continue;
      seen[si] = 1;
      data[di] = fill[0]; data[di + 1] = fill[1]; data[di + 2] = fill[2]; data[di + 3] = fill[3];
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    ctx.putImageData(img, 0, 0);
  }

  toDataURL() { return this.canvas.toDataURL("image/png"); }

  loadFromImage(img) {
    this._pushUndo();
    this.ctx.clearRect(0, 0, HAIR_CANVAS_SIZE, HAIR_CANVAS_SIZE);
    this.ctx.drawImage(img, 0, 0, HAIR_CANVAS_SIZE, HAIR_CANVAS_SIZE);
  }
}
