// brushgallery.js — Galería de "pinceles" personalizados: el usuario sube
// cualquier imagen (PNG con transparencia funciona mejor) y queda disponible
// como estampa. No lee archivos nativos de SAI (.sut) — eso es un formato
// propietario de Celsys sin especificación pública — pero si exportas o
// capturas tu pincel de SAI como imagen (captura de pantalla recortada,
// exportado desde SAI como PNG, etc.) funciona igual aquí.

const PRESET_STAMPS = [
  { id: "soft", label: "Redondo suave", build: makeSoftRound },
  { id: "hard", label: "Redondo duro", build: makeHardRound },
  { id: "scatter", label: "Mechones (disperso)", build: makeScatter },
  { id: "hatch", label: "Rayitas", build: makeHatch },
];

function makeSoftRound() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.7, "rgba(0,0,0,0.9)"); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return c;
}
function makeHardRound() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
  return c;
}
function makeScatter() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const ctx = c.getContext("2d");
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 28;
    const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r;
    ctx.beginPath(); ctx.arc(x, y, 2 + Math.random() * 3, 0, Math.PI * 2);
    ctx.fillStyle = "#000"; ctx.fill();
  }
  return c;
}
function makeHatch() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.strokeStyle = "#000"; ctx.lineWidth = 3; ctx.lineCap = "round";
  for (let i = -1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * 20 - 6, 64); ctx.lineTo(i * 20 + 22, 0); ctx.stroke();
  }
  return c;
}

/**
 * @param {HTMLElement} rowEl - contenedor donde se listan las estampas
 * @param {HTMLInputElement} fileInputEl - <input type=file accept=image/*>
 * @param {(img: HTMLCanvasElement|HTMLImageElement|null)=>void} onSelect - null = volver al pincel redondo normal
 */
export function setupBrushGallery(rowEl, fileInputEl, onSelect) {
  const items = PRESET_STAMPS.map((p) => ({ id: p.id, label: p.label, img: p.build(), removable: false }));
  let activeId = null;

  function render() {
    rowEl.innerHTML = "";
    items.forEach((it) => {
      const el = document.createElement("div");
      el.className = "brush-stamp" + (it.id === activeId ? " active" : "");
      el.title = it.label;
      el.style.backgroundImage = `url(${it.img.toDataURL ? it.img.toDataURL() : it.img.src})`;
      el.addEventListener("click", () => {
        activeId = it.id;
        render();
        onSelect(it.img);
      });
      if (it.removable) {
        const rm = document.createElement("button");
        rm.className = "rm"; rm.textContent = "×"; rm.title = "Quitar";
        rm.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = items.indexOf(it);
          if (idx >= 0) items.splice(idx, 1);
          if (activeId === it.id) { activeId = null; onSelect(null); }
          render();
        });
        el.appendChild(rm);
      }
      rowEl.appendChild(el);
    });
    const uploadBtn = document.createElement("button");
    uploadBtn.className = "brush-upload-btn";
    uploadBtn.textContent = "+";
    uploadBtn.title = "Subir mi propio pincel (imagen PNG, idealmente con transparencia)";
    uploadBtn.addEventListener("click", () => fileInputEl.click());
    rowEl.appendChild(uploadBtn);

    // botón para volver al pincel normal (círculo sólido, sin estampa)
    const noneBtn = document.createElement("div");
    noneBtn.className = "brush-stamp" + (activeId === null ? " active" : "");
    noneBtn.title = "Pincel normal (círculo)";
    noneBtn.style.cssText += "display:flex;align-items:center;justify-content:center;font-size:16px;color:#aaa;";
    noneBtn.textContent = "●";
    noneBtn.addEventListener("click", () => { activeId = null; render(); onSelect(null); });
    rowEl.insertBefore(noneBtn, rowEl.firstChild);
  }

  fileInputEl.addEventListener("change", () => {
    const file = fileInputEl.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const id = "custom-" + Date.now();
      items.push({ id, label: file.name, img, removable: true });
      activeId = id;
      render();
      onSelect(img);
    };
    img.src = URL.createObjectURL(file);
    fileInputEl.value = "";
  });

  render();
}
