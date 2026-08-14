// colorwheel.js — Selector de color "rueda completa": círculo de
// matiz+saturación (ángulo = matiz, distancia del centro = saturación) más
// una barra aparte para el brillo/valor. Sin dependencias, un <canvas> nada
// más — se puede meter en cualquier panel.

const WHEEL_SIZE = 176; // px, cuadrado

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export class ColorWheel {
  /**
   * @param {HTMLElement} container - elemento vacío donde se monta el widget
   * @param {(hex:string)=>void} onChange
   */
  constructor(container, onChange) {
    this.onChange = onChange;
    this.h = 0; this.s = 0; this.v = 1;

    container.classList.add("colorwheel");
    container.innerHTML = `
      <canvas class="cw-wheel" width="${WHEEL_SIZE}" height="${WHEEL_SIZE}"></canvas>
      <div class="cw-value-row">
        <canvas class="cw-value" width="176" height="16"></canvas>
      </div>
      <div class="cw-preview-row">
        <div class="cw-preview"></div>
        <input class="cw-hex" type="text" maxlength="7" spellcheck="false">
      </div>
    `;
    this.wheelCanvas = container.querySelector(".cw-wheel");
    this.valueCanvas = container.querySelector(".cw-value");
    this.preview = container.querySelector(".cw-preview");
    this.hexInput = container.querySelector(".cw-hex");
    this.wheelCtx = this.wheelCanvas.getContext("2d");
    this.valueCtx = this.valueCanvas.getContext("2d");

    this._drawWheel();
    this._drawValueBar();
    this._drawCursor();
    this._updatePreview();

    this._bindWheel();
    this._bindValueBar();
    this._bindHexInput();
  }

  _drawWheel() {
    const size = WHEEL_SIZE, r = size / 2;
    const img = this.wheelCtx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - r, dy = y - r;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * size + x) * 4;
        if (dist > r) { img.data[idx + 3] = 0; continue; }
        let ang = Math.atan2(dy, dx) * (180 / Math.PI);
        if (ang < 0) ang += 360;
        const sat = Math.min(1, dist / r);
        const [rr, gg, bb] = hsvToRgb(ang, sat, this.v);
        img.data[idx] = rr; img.data[idx + 1] = gg; img.data[idx + 2] = bb; img.data[idx + 3] = 255;
      }
    }
    this.wheelCtx.putImageData(img, 0, 0);
  }

  _drawValueBar() {
    const w = 176, h = 16;
    const grad = this.valueCtx.createLinearGradient(0, 0, w, 0);
    const [r, g, b] = hsvToRgb(this.h, this.s, 1);
    grad.addColorStop(0, "#000000");
    grad.addColorStop(1, `rgb(${r},${g},${b})`);
    this.valueCtx.fillStyle = grad;
    this.valueCtx.fillRect(0, 0, w, h);
  }

  _drawCursor() {
    // redibuja la rueda entera (para borrar el cursor anterior) + el puntito
    this._drawWheel();
    const size = WHEEL_SIZE, r = size / 2;
    const ang = (this.h * Math.PI) / 180;
    const dist = this.s * r;
    const cx = r + Math.cos(ang) * dist;
    const cy = r + Math.sin(ang) * dist;
    const ctx = this.wheelCtx;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.strokeStyle = this.v > 0.6 ? "#111" : "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // marcador en la barra de valor
    this._drawValueBar();
    const vctx = this.valueCtx;
    const vx = this.v * 176;
    vctx.beginPath();
    vctx.moveTo(vx, 0); vctx.lineTo(vx, 16);
    vctx.strokeStyle = "#fff";
    vctx.lineWidth = 2;
    vctx.stroke();
  }

  _updatePreview() {
    const hex = rgbToHex(hsvToRgb(this.h, this.s, this.v));
    this.preview.style.background = hex;
    this.hexInput.value = hex;
  }

  _emit() {
    this._drawCursor();
    this._updatePreview();
    if (this.onChange) this.onChange(this.hexInput.value);
  }

  _bindWheel() {
    let dragging = false;
    const pick = (e) => {
      const rect = this.wheelCanvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * WHEEL_SIZE;
      const y = ((e.clientY - rect.top) / rect.height) * WHEEL_SIZE;
      const r = WHEEL_SIZE / 2;
      const dx = x - r, dy = y - r;
      let ang = Math.atan2(dy, dx) * (180 / Math.PI);
      if (ang < 0) ang += 360;
      const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy) / r);
      this.h = ang; this.s = dist;
      this._emit();
    };
    this.wheelCanvas.addEventListener("pointerdown", (e) => { dragging = true; pick(e); });
    window.addEventListener("pointermove", (e) => { if (dragging) pick(e); });
    window.addEventListener("pointerup", () => { dragging = false; });
  }

  _bindValueBar() {
    let dragging = false;
    const pick = (e) => {
      const rect = this.valueCanvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 176;
      this.v = Math.max(0, Math.min(1, x / 176));
      this._emit();
    };
    this.valueCanvas.addEventListener("pointerdown", (e) => { dragging = true; pick(e); });
    window.addEventListener("pointermove", (e) => { if (dragging) pick(e); });
    window.addEventListener("pointerup", () => { dragging = false; });
  }

  _bindHexInput() {
    this.hexInput.addEventListener("change", () => {
      let hex = this.hexInput.value.trim();
      if (!hex.startsWith("#")) hex = "#" + hex;
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { this._updatePreview(); return; }
      this.setColor(hex, true);
    });
  }

  setColor(hex, silent) {
    const [r, g, b] = hexToRgb(hex);
    const [h, s, v] = rgbToHsv(r, g, b);
    this.h = h; this.s = s; this.v = v;
    this._drawCursor();
    this._updatePreview();
    if (!silent && this.onChange) this.onChange(hex);
  }

  get hex() { return this.hexInput.value; }
}
