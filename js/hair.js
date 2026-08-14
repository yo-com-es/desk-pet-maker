// hair.js — Peinados low-poly estilo Mii/Tomodachi Life, construidos con
// geometría básica de three.js (nada de archivos externos que descargar).
// Cada preset es una función (radius, color) => THREE.Group centrado
// aproximadamente en el centro de la cabeza.

import * as THREE from "three";

function mat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
}

export const HAIR_PRESETS = {
  ninguno: {
    label: "— Sin pelo —",
    build: () => new THREE.Group(),
  },

  flequillo: {
    label: "Flequillo corto",
    build: (r, color) => {
      const g = new THREE.Group();
      const m = mat(color);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), m);
      g.add(cap);
      const fringe = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, r * 0.55, 20, 1, true, 0, Math.PI * 0.9), m);
      fringe.rotation.z = Math.PI / 2;
      fringe.rotation.y = Math.PI / 2 + Math.PI * 0.45 / 2;
      fringe.position.set(0, -r * 0.15, r * 0.55);
      g.add(fringe);
      return g;
    },
  },

  puntas: {
    label: "Puntas paradas",
    build: (r, color) => {
      const g = new THREE.Group();
      const m = mat(color);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.95, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), m);
      g.add(cap);
      const spikes = 7;
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(r * 0.22, r * 0.85, 6), m);
        const dist = r * 0.55;
        spike.position.set(Math.cos(a) * dist, r * 0.55, Math.sin(a) * dist * 0.7);
        spike.rotation.z = Math.cos(a) * 0.5;
        spike.rotation.x = -Math.sin(a) * 0.5 - 0.15;
        g.add(spike);
      }
      return g;
    },
  },

  casco: {
    label: "Casco (bowl cut)",
    build: (r, color) => {
      const g = new THREE.Group();
      const m = mat(color);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.08, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.72), m);
      g.add(cap);
      return g;
    },
  },

  coleta: {
    label: "Coleta",
    build: (r, color) => {
      const g = new THREE.Group();
      const m = mat(color);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), m);
      g.add(cap);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(r * 0.22, r * 0.06, 8, 16), mat(0x222222));
      tie.position.set(0, r * 0.15, -r * 0.9);
      tie.rotation.x = Math.PI / 2;
      g.add(tie);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(r * 0.24, r * 1.5, 10), m);
      tail.position.set(0, -r * 0.4, -r * 1.15);
      tail.rotation.x = Math.PI * 0.62;
      g.add(tail);
      return g;
    },
  },

  largo_lacio: {
    label: "Largo lacio",
    build: (r, color) => {
      const g = new THREE.Group();
      const m = mat(color);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), m);
      g.add(cap);
      const back = new THREE.Mesh(new THREE.BoxGeometry(r * 1.9, r * 2.3, r * 0.35), m);
      back.position.set(0, -r * 1.1, -r * 0.85);
      g.add(back);
      const sideL = new THREE.Mesh(new THREE.BoxGeometry(r * 0.45, r * 1.9, r * 0.35), m);
      sideL.position.set(r * 1.0, -r * 0.9, -r * 0.3);
      g.add(sideL);
      const sideR = sideL.clone();
      sideR.position.x = -r * 1.0;
      g.add(sideR);
      return g;
    },
  },

  moño: {
    label: "Chongo/Moño",
    build: (r, color) => {
      const g = new THREE.Group();
      const m = mat(color);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.0, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), m);
      g.add(cap);
      const bun = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 16, 12), m);
      bun.position.set(0, r * 1.0, -r * 0.55);
      g.add(bun);
      return g;
    },
  },
};

export function buildHair(presetKey, radius, colorHex) {
  const preset = HAIR_PRESETS[presetKey] || HAIR_PRESETS.ninguno;
  const group = preset.build(radius, colorHex);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return group;
}

// ---------------------------------------------------------------------
// Pelo "pintado" estilo Picrew/avatar-maker (ver video de referencia):
// una placa plana con la textura del lienzo pintado a mano. Lo transparente
// del lienzo se recorta (alphaTest), lo pintado queda flotando pegado al
// frente de la cabeza como una calcomanía, en vez de ser geometría 3D real.
export function buildPaintedHair(canvas, widthWorld, heightWorld) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.12, // recorta el fondo no pintado en vez de dejarlo semi-transparente
    side: THREE.DoubleSide,
    depthWrite: true,
    polygonOffset: true, // ayuda a que quede pegada al ras sin pelearse (z-fighting) con la piel de abajo
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const geo = new THREE.PlaneGeometry(widthWorld, heightWorld);
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 5;
  mesh.userData.__hairTexture = tex;
  return mesh;
}

// Actualiza la textura de una placa de pelo ya creada (para refrescar tras
// pintar más sin tener que reconstruir la malla ni perder su transform).
export function refreshPaintedHairTexture(mesh) {
  const tex = mesh && mesh.userData.__hairTexture;
  if (tex) tex.needsUpdate = true;
}

// Punto de anclaje para el pelo calculado SOLO con la caja del modelo (nunca
// con un hueso) — así no importa cómo esté rotado el esqueleto interno de
// cada rig, el pelo siempre queda en el mismo lugar relativo al cuerpo.
// mode: "frente" (cara, para humanoides) | "cuernos" (arriba/atrás de la
// cabeza, para dragones u otros cuadrúpedos).
export function computeHairAnchor(root, mode = "frente", flipFront = false) {
  root.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  // -Z es "adelante" por convención de glTF; flipFront lo invierte si el
  // modelo quedó exportado al revés.
  const frontZ = flipFront ? box.max.z : box.min.z;
  const frontSign = flipFront ? 1 : -1;

  const worldPoint = new THREE.Vector3();
  let worldNormal;
  if (mode === "cuernos") {
    worldPoint.set(center.x, box.max.y - size.y * 0.03, center.z - frontSign * size.z * 0.06);
    worldNormal = new THREE.Vector3(0, 0.6, -frontSign * 0.8).normalize();
  } else {
    worldPoint.set(center.x, box.max.y - size.y * 0.17, frontZ + frontSign * size.z * 0.02);
    worldNormal = new THREE.Vector3(0, 0, frontSign).normalize();
  }

  const invMatrix = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(root.matrixWorld).invert();
  worldPoint.applyMatrix4(invMatrix);
  const localNormal = worldNormal.clone().applyMatrix3(normalMatrix).normalize();

  return { anchor: worldPoint, normal: localNormal, size, faceSign: frontSign };
}

// Ancla el pelo directo a un punto de la SUPERFICIE del modelo, elegido con
// un clic (raycast) en vez de adivinar con la caja del cuerpo entero. Da el
// punto exacto y la normal de esa cara, así la placa queda pegada como
// calcomanía sobre esa parte precisa (p.ej. la frente), en vez de flotar
// cerca de ahí.
export function computeHairAnchorFromPick(root, hitPoint, hitObject, hitFaceNormal) {
  root.updateWorldMatrix(true, false);
  hitObject.updateWorldMatrix(true, false);

  const worldNormal = hitFaceNormal.clone().transformDirection(hitObject.matrixWorld).normalize();

  const invMatrix = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const localPoint = hitPoint.clone().applyMatrix4(invMatrix);

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(root.matrixWorld).invert();
  const localNormal = worldNormal.clone().applyMatrix3(normalMatrix).normalize();

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);

  return { anchor: localPoint, normal: localNormal, size };
}

// Cuaternión que orienta la placa (cuya cara normal por defecto es +Z) para
// que quede al ras de la superficie en el punto de anclaje, viendo hacia
// afuera del modelo — como pegar una calcomanía en vez de dejarla flotando
// con una rotación fija que no sigue la curva del cuerpo.
export function quaternionFromAnchorNormal(localNormal) {
  const from = new THREE.Vector3(0, 0, 1);
  const to = localNormal.clone().normalize();
  if (to.lengthSq() < 1e-6) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(from, to);
}
