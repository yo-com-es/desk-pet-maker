import * as THREE from "three";

const CANVAS_SIZE = 1024;

// ---------------------------------------------------------------------
// "Horneado" de la textura original a un canvas 2D usando la propia GPU,
// en vez de ctx.drawImage(mat.map.image, ...).
//
// Por qué: drawImage() solo funciona si `.image` es algo que el canvas 2D
// sabe dibujar (HTMLImageElement/ImageBitmap/canvas). Muchos modelos traen
// texturas comprimidas (KTX2/Basis) o variantes donde `.image` no es
// dibujable — ahí drawImage tiraba una excepción, el catch rellenaba TODO
// de un color piel plano, y esa era la causa de que ciertos modelos (como
// el león) se vieran con la textura "desmadrada"/borrada en vez de con su
// piel real. Renderizando la textura ya subida a la GPU a través de un
// shader que solo pasa la UV a través, three.js decodifica cualquier
// formato por nosotros — funciona igual sin importar cómo esté empaquetada.
function bakeTextureToCanvas(renderer, texture, size = CANVAS_SIZE) {
  // Si la textura viene marcada como sRGB (lo normal en el color base de un
  // glTF), muestrearla con texture2D() la decodificaría a lineal — y
  // guardaríamos esos valores lineales como si fueran los bytes originales,
  // lo que se ve apagado/incorrecto. La desmarcamos mientras horneamos para
  // copiar los bytes tal cual, igual que hacía el drawImage() de antes.
  const prevColorSpace = texture.colorSpace;
  const prevNeedsUpdate = texture.needsUpdate;
  if (prevColorSpace !== THREE.NoColorSpace) {
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
  }

  const rt = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0, 1, -1, 0, 1, 1, 0,
    -1, -1, 0, 1, 1, 0, -1, 1, 0,
  ]), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
  ]), 2));

  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: texture } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D map; void main(){ gl_FragColor = texture2D(map, vUv); }`,
    depthTest: false,
    depthWrite: false,
  });

  const quadScene = new THREE.Scene();
  quadScene.add(new THREE.Mesh(geo, mat));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(quadScene, cam);

  const buf = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
  renderer.setRenderTarget(prevTarget);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(size, size);
  // El cuadro se armó a propósito para que la fila 0 del buffer (la de más
  // abajo, como siempre entrega WebGL) ya corresponda a v=0 — que en una
  // textura de glTF (flipY=false) es la fila DE ARRIBA de la imagen
  // original. O sea que fila 0 del buffer = fila 0 (arriba) de la imagen:
  // se copia derecho, sin voltear, para que quede igual que un drawImage().
  imgData.data.set(buf);
  ctx.putImageData(imgData, 0, 0);

  rt.dispose();
  geo.dispose();
  mat.dispose();

  if (prevColorSpace !== THREE.NoColorSpace) {
    texture.colorSpace = prevColorSpace;
    texture.needsUpdate = prevNeedsUpdate;
  }

  return canvas;
}

// Prepara cada malla del modelo con un canvas pintable, partiendo de su textura
// original (si tiene) o de un lienzo en blanco color piel.
export function preparePaintableModel(root, renderer, baseSkinColor = "#e7cba9") {
  const paintables = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((mat, idx) => {
      if (!mat || mat.userData.__paintCanvas) {
        // already prepared and shared, just register mesh
      }
      if (!mat.userData.__paintCanvas) {
        let canvas;
        if (mat.map) {
          try {
            canvas = bakeTextureToCanvas(renderer, mat.map, CANVAS_SIZE);
          } catch (e) {
            console.warn("No se pudo hornear la textura original, se usa piel en blanco:", e);
          }
        }
        if (!canvas) {
          canvas = document.createElement("canvas");
          canvas.width = CANVAS_SIZE;
          canvas.height = CANVAS_SIZE;
          const c2 = canvas.getContext("2d");
          c2.fillStyle = baseSkinColor;
          c2.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        }
        const ctx = canvas.getContext("2d");
        const tex = new THREE.CanvasTexture(canvas);
        tex.flipY = false; // el canvas horneado por bakeTextureToCanvas ya respeta la convención glTF (v=0 arriba); voltearlo aquí duplicaba el flip y hacía que partes en polos opuestos del atlas (cara/cuerpo) intercambiaran textura
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.needsUpdate = true;
        mat.userData.__paintCanvas = canvas;
        mat.userData.__paintCtx = ctx;
        mat.userData.__paintTex = tex;
        mat.userData.__paintBase = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        mat.userData.__undoStack = [];
      }
      paintables.push({ mesh: obj, material: mat });
    });
  });
  return paintables;
}

export class PaintTool {
  constructor(renderer, camera, scene) {
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.active = false;
    this.painting = false;
    this.color = "#e0554f";
    this.size = 16;
    this.erase = false;
    this.stampImage = null;
    this._tintCache = null;
    this._tintCacheColor = null;
    this.targetMeshes = [];
    this.onStrokeStateChange = null; // callback(bool painting) to disable orbit controls

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
  }

  setTargetRoot(root) {
    this.targetMeshes = [];
    if (!root) return;
    root.traverse((o) => {
      if (o.isMesh) this.targetMeshes.push(o);
    });
  }

  enable(dom) {
    if (this.active) return;
    this.active = true;
    this.dom = dom;
    dom.addEventListener("pointerdown", this._onDown);
    window.addEventListener("pointermove", this._onMove);
    window.addEventListener("pointerup", this._onUp);
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    this.dom.removeEventListener("pointerdown", this._onDown);
    window.removeEventListener("pointermove", this._onMove);
    window.removeEventListener("pointerup", this._onUp);
  }

  _hit(event) {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.targetMeshes, false);
    return hits.length ? hits[0] : null;
  }

  _onDown(e) {
    const hit = this._hit(e);
    if (!hit || !hit.uv) return;
    this.painting = true;
    if (this.onStrokeStateChange) this.onStrokeStateChange(true);
    this._pushUndo(hit.object);
    this._paintAt(hit);
  }

  _onMove(e) {
    if (!this.painting) return;
    const hit = this._hit(e);
    if (hit && hit.uv) this._paintAt(hit);
  }

  _onUp() {
    if (!this.painting) return;
    this.painting = false;
    if (this.onStrokeStateChange) this.onStrokeStateChange(false);
  }

  _pushUndo(mesh) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      if (!mat.userData.__paintCtx) return;
      const stack = mat.userData.__undoStack;
      stack.push(mat.userData.__paintCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE));
      if (stack.length > 15) stack.shift();
    });
  }

  undo(mesh) {
    if (!mesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      const stack = mat.userData.__undoStack;
      if (!stack || !stack.length) return;
      const prev = stack.pop();
      mat.userData.__paintCtx.putImageData(prev, 0, 0);
      mat.userData.__paintTex.needsUpdate = true;
    });
  }

  resetSkin(mesh) {
    if (!mesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      if (!mat.userData.__paintBase) return;
      mat.userData.__paintCtx.putImageData(mat.userData.__paintBase, 0, 0);
      mat.userData.__paintTex.needsUpdate = true;
    });
  }

  setStampImage(img) {
    this.stampImage = img;
    this._tintCache = null;
  }

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

  _paintAt(hit) {
    const mesh = hit.object;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // find material index for this face if multi-material
    let mat = mats[0];
    if (mats.length > 1 && hit.face && typeof hit.face.materialIndex === "number") {
      mat = mats[hit.face.materialIndex] || mats[0];
    }
    if (!mat || !mat.userData.__paintCtx) return;
    const ctx = mat.userData.__paintCtx;
    const u = hit.uv.x;
    const v = 1 - hit.uv.y;
    const x = u * CANVAS_SIZE;
    const y = v * CANVAS_SIZE;
    ctx.save();
    if (this.erase && mat.userData.__paintBase) {
      // "erase" = repaint from the original base texture in that spot
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.arc(x, y, this.size, 0, Math.PI * 2);
      ctx.clip();
      const tmp = document.createElement("canvas");
      tmp.width = CANVAS_SIZE;
      tmp.height = CANVAS_SIZE;
      tmp.getContext("2d").putImageData(mat.userData.__paintBase, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    } else if (this.stampImage) {
      this._drawStamp(ctx, x, y);
    } else {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(x, y, this.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    mat.userData.__paintTex.needsUpdate = true;
  }
}
