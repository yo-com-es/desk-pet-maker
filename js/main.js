import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GaitEngine, ROLE_GROUPS, ROLE_LABELS, ALL_ROLES } from "./gait.js";
import { preparePaintableModel, PaintTool } from "./paint.js";
import {
  buildPaintedHair, refreshPaintedHairTexture, computeHairAnchor,
  computeHairAnchorFromPick, quaternionFromAnchorNormal,
} from "./hair.js";
import { HairCanvas } from "./hairpaint.js";
import { autoMapBones } from "./autorig.js";
import { ColorWheel } from "./colorwheel.js";
import { setupBrushGallery } from "./brushgallery.js";

// ---------- Escena base ----------
const canvas = document.getElementById("glcanvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const DESKPET = new URLSearchParams(location.search).get("deskpet") === "1";
if (DESKPET) document.documentElement.classList.add("deskpet");

const scene = new THREE.Scene();
scene.background = DESKPET ? null : new THREE.Color(0x14161a);
scene.fog = DESKPET ? null : new THREE.Fog(0x14161a, 8, 40);

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
camera.position.set(3.2, 2.2, 4.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
if (DESKPET) controls.enabled = false;

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x2a1f14, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 6, 3);
scene.add(key);
const rim = new THREE.DirectionalLight(0x5bc9ff, 0.6);
rim.position.set(-4, 3, -3);
scene.add(rim);

const grid = new THREE.GridHelper(20, 40, 0x3a3f4b, 0x22252c);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 1 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(20, 48), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.001;
if (!DESKPET) {
  scene.add(grid);
  scene.add(ground);
}

function fitCameraToGroup(group) {
  const box = new THREE.Box3().setFromObject(group);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const dist = (sphere.radius * 2.1) / Math.tan((camera.fov * Math.PI) / 360);
  camera.position.set(sphere.center.x, sphere.center.y + sphere.radius * 0.15, sphere.center.z + dist);
  camera.lookAt(sphere.center);
  controls.target.copy(sphere.center);
  camera.updateProjectionMatrix();
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

// ---------- Estado de personajes ----------
// Reloj para animar (huesos, cámara, etc.) — animate() lo necesita en cada cuadro.
const clock = new THREE.Clock();
// Si el .glb que cargues (propio, no viene ninguno incluido) está
// comprimido con Draco, el loader necesita este decodificador para poder
// abrirlo — se deja siempre listo por si acaso.
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("js/libs/draco/");
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

const slots = {
  A: emptySlot(),
  B: emptySlot(),
};

function emptySlot() {
  return {
    group: null,
    bones: [],
    mapping: {},
    gait: null,
    animState: "walk",
    speed: 1,
    paintables: [],
    mounted: false,
    mountParentSlot: null,
    mountSeat: null,
    baseHeight: 1,
    hair: null, // { group, preset, color, offset:{x,y,z,rotY,rotX,scale} }
  };
}

const MAPPING_STORE_KEY = "criadero_bone_mappings_v1";
function loadMappingStore() {
  try { return JSON.parse(localStorage.getItem(MAPPING_STORE_KEY)) || {}; } catch { return {}; }
}
function saveMappingStore(store) {
  localStorage.setItem(MAPPING_STORE_KEY, JSON.stringify(store));
}

function boneKeyForModel(url, bones) {
  // A light fingerprint: url + bone count + first few bone names
  return url + "::" + bones.length + "::" + bones.slice(0, 5).map((b) => b.name).join(",");
}

async function loadModelIntoSlot(slotName, url) {
  setStatus("cargando " + url.split("/").pop() + "…");
  const slot = slots[slotName];
  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } catch (err) {
    console.error("Fallo al cargar el modelo:", err);
    setStatus("❌ no se pudo cargar el archivo: " + (err && err.message ? err.message : "formato no soportado o archivo dañado"));
    throw err;
  }
  const root = gltf.scene;
  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
  });

  // Remove previous
  if (slot.group) scene.remove(slot.group);
  slot.hair = null; // el pelo estaba pegado al modelo anterior, ya no existe

  // Si este slot era el jinete montado, o si este slot es la base A que traía
  // el hueso de montura, el "asiento" de montura anterior queda huérfano —
  // hay que soltarlo para no dejar basura ni referencias rotas.
  if (slotName === "B" && slot.mountSeat) {
    if (slot.mountSeat.parent) slot.mountSeat.parent.remove(slot.mountSeat);
    slot.mountSeat = null;
    slot.mounted = false;
  }
  if (slotName === "A" && slots.B.mounted) {
    if (slots.B.mountSeat && slots.B.mountSeat.parent) slots.B.mountSeat.parent.remove(slots.B.mountSeat);
    slots.B.mountSeat = null;
    slots.B.mounted = false;
    if (slots.B.group) scene.add(slots.B.group);
    if (slots.B.gait) { slots.B.gait.setSeated(false); slots.B.gait.setPositionLocked(false); }
  }

  const wrapper = new THREE.Group();
  wrapper.add(root);
  scene.add(wrapper);

  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });

  // normalize footing: put base of bounding box at y=0
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y;
  const size = new THREE.Vector3();
  box.getSize(size);

  slot.group = wrapper;
  slot.root = root;
  slot.bones = bones;
  slot.url = url;
  slot.baseHeight = Math.max(size.y, 0.001);
  slot.mapping = {};
  slot.gait = null;
  slot.mounted = false;
  slot.paintables = preparePaintableModel(root, renderer);

  applyScale(slotName, parseFloat(document.getElementById("scale" + slotName).value));
  positionSideBySide();
  if (DESKPET && slotName === "A") fitCameraToGroup(wrapper);

  // try restoring a saved mapping; si no hay ninguno, mapear automático
  const store = loadMappingStore();
  const key = boneKeyForModel(url, bones);
  if (store[key]) {
    applyMappingFromStored(slotName, store[key]);
    document.getElementById("mappingSavedHint").textContent = "Se cargó un mapeo guardado para este modelo.";
  } else {
    const { mapping, kind, report } = autoMapBones(bones, root);
    slot.mapping = mapping;
    slot.kind = kind;
    slot.gait = new GaitEngine(slot.mapping, slot.group);
    slot.gait.setState(slot.animState);
    slot.gait.setSpeedMultiplier(slot.speed);
    document.getElementById("mappingSavedHint").textContent =
      "Huesos mapeados automáticamente — ya puedes darle a Caminar/Correr. " + report.join(" ");
  }

  refreshDependentUI();
  setStatus("listo");
}

function positionSideBySide() {
  if (slots.A.group) slots.A.group.position.x = slots.B.group && !slots.B.mounted ? -0.9 : 0;
  if (slots.B.group && !slots.B.mounted) slots.B.group.position.x = slots.A.group ? 0.9 : 0;
}

function applyScale(slotName, value) {
  const slot = slots[slotName];
  if (!slot.group) return;
  slot.group.scale.setScalar(value);
  document.getElementById("scale" + slotName + "Val").textContent = value.toFixed(2);
  updateMountSliderRanges();
}

// ---------- UI: carga de modelos ----------
function wireSlotUI(slotName) {
  const select = document.getElementById("modelSelect" + slotName);
  const fileInput = document.getElementById("fileInput" + slotName);
  select.addEventListener("change", () => {
    if (select.value === "__custom__") {
      fileInput.click();
      select.value = "";
    } else if (select.value) {
      loadModelIntoSlot(slotName, select.value).catch(() => {});
    }
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) handleCustomFile(slotName, file);
    fileInput.value = "";
  });
  const scaleSlider = document.getElementById("scale" + slotName);
  scaleSlider.addEventListener("input", () => applyScale(slotName, parseFloat(scaleSlider.value)));

  // Arrastrar y soltar el .glb directamente
  const zone = document.getElementById("dropZone" + slotName);
  zone.addEventListener("click", () => fileInput.click());
  ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.add("drag-over");
  }));
  ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.remove("drag-over");
  }));
  zone.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleCustomFile(slotName, file);
  });
}

function handleCustomFile(slotName, file) {
  if (!/\.(glb|gltf)$/i.test(file.name)) {
    setStatus("❌ ese archivo no es .glb ni .gltf");
    return;
  }
  if (/\.gltf$/i.test(file.name)) {
    setStatus("⚠️ los .gltf con texturas/bin sueltos no cargan bien desde aquí — exporta como .glb (archivo único) e inténtalo de nuevo");
  }
  const mb = file.size / (1024 * 1024);
  if (mb > 60) {
    setStatus(`⏳ "${file.name}" pesa ${mb.toFixed(0)}MB — puede tardar bastante en cargar y puede que tu navegador se sienta trabado un rato mientras procesa. No lo cierres, dale tiempo.`);
  }
  const url = URL.createObjectURL(file);
  loadModelIntoSlot(slotName, url)
    .then(() => {
      slots[slotName].displayName = file.name;
      setStatus("✅ \"" + file.name + "\" cargado en " + slotName);
    })
    .catch(() => {
      // el mensaje de error ya quedó puesto por loadModelIntoSlot
    });
}
wireSlotUI("A");
wireSlotUI("B");

// Los sliders de montura (X/Y/Z/Hundido) traían un rango fijo adivinado
// (p.ej. Y entre -1.5 y 1). Si el hueso de montura queda bien arriba de la
// superficie real de contacto — que depende del tamaño real de TUS
// modelos, no de un número inventado — la corrección necesaria puede
// superar ese rango angosto. Un <input type=range> de HTML recorta solo
// cualquier valor fuera de su min/max, así que el slider se quedaba
// pegado en el tope sin importar qué tanto hiciera falta moverlo — mismo
// resultado siempre, como si el botón "no hiciera nada". Esta función
// recalcula el rango cada vez que cambia algo que afecta el tamaño real
// en escena (cargar modelo, cambiar escala, montar).
function updateMountSliderRanges() {
  const heightA = (slots.A.baseHeight || 0) * (slots.A.group ? slots.A.group.scale.x : 1);
  const heightB = (slots.B.baseHeight || 0) * (slots.B.group ? slots.B.group.scale.x : 1);
  const scaleRef = Math.max(heightA, heightB, 0.1);

  const setRange = (id, span) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.min = -span;
    el.max = span;
  };
  setRange("mountX", scaleRef * 1.5);
  setRange("mountY", scaleRef * 2.5);
  setRange("mountZ", scaleRef * 1.5);

  const sinkEl = document.getElementById("sinkDepth");
  if (sinkEl) sinkEl.max = Math.max(scaleRef * 0.5, 0.05);
}


const ratioSlider = document.getElementById("ratioSlider");
const ratioVal = document.getElementById("ratioVal");
ratioSlider.addEventListener("input", () => (ratioVal.textContent = ratioSlider.value + "%"));

document.getElementById("autoScaleBtn").addEventListener("click", () => {
  if (!slots.A.group || !slots.B.group) {
    setStatus("carga ambas bases primero");
    return;
  }
  const ratio = parseFloat(ratioSlider.value) / 100;
  const targetHeight = slots.A.baseHeight * (slots.A.group.scale.x) * ratio;
  const newScaleB = targetHeight / slots.B.baseHeight;
  document.getElementById("scaleB").value = newScaleB;
  applyScale("B", newScaleB);
});

// ---------- Montar B sobre A ----------
const mountBoneSelect = document.getElementById("mountBoneSelect");
function refreshMountBoneOptions() {
  mountBoneSelect.innerHTML = "";
  if (!slots.A.bones.length) {
    mountBoneSelect.innerHTML = '<option value="">— elige base A primero —</option>';
    return;
  }
  mountBoneSelect.innerHTML = '<option value="">elige un hueso…</option>' +
    slots.A.bones.map((b, i) => `<option value="${i}">${b.name}</option>`).join("");
}

// Qué tan arriba de sus propios pies (en el espacio local, sin escalar, de
// su wrapper) están las caderas/hombros de B — el hueso donde nacen sus
// patas/piernas delanteras. Antes, "sentado" clavaba los PIES de B en el
// hueso de montura, así que el cuerpo entero (incluida la cadera) quedaba
// flotando a la altura de pie sobre el lomo/silla — de ahí que se viera
// "demasiado alto". Bajando el asiento por esta distancia, quien queda
// clavado en el punto de montura es la cadera, no los pies, como al
// sentarse de verdad.
function computeHipLocalHeight(slot) {
  if (!slot.group || !slot.mapping) return 0;
  // En un biped, leg_fl/leg_fr son los BRAZOS (por convención) y leg_bl/leg_br
  // las piernas de verdad — si se revisa leg_fl primero, se agarra la altura
  // del hombro en vez de la cadera, y el jinete queda "flotando" muy alto al
  // sentarlo. En cuadrúpedo cualquiera de las 4 sirve, pero las traseras
  // (más cerca de donde se "sienta" alguien) son la mejor referencia.
  const roles = slot.kind === "quad"
    ? ["leg_bl", "leg_br", "leg_fl", "leg_fr"]
    : ["leg_bl", "leg_br"];
  let bone = null;
  for (const r of roles) {
    if (slot.mapping[r] && slot.mapping[r].bone) { bone = slot.mapping[r].bone; break; }
  }
  if (!bone) {
    // Sin huesos de pierna mapeados no hay forma de calcularlo exacto — pero
    // devolver 0 aquí es peor: deja al jinete con los PIES clavados en el
    // punto de montura y el resto del cuerpo flotando en el aire por encima.
    // Mejor una estimación (más o menos la mitad de su altura, como una
    // cadera típica) que ningún ajuste.
    return slot.baseHeight ? slot.baseHeight * 0.45 : 0;
  }
  slot.group.updateWorldMatrix(true, false);
  const worldPos = new THREE.Vector3();
  bone.getWorldPosition(worldPos);
  const local = slot.group.worldToLocal(worldPos.clone());
  return Math.max(local.y, 0);
}

function applyMountPositionFromSliders() {
  if (!slots.B.mounted) return;
  const riderScale = slots.B.group.scale.x;
  const seated = document.getElementById("seatedCheck").checked;
  const hipDrop = seated ? computeHipLocalHeight(slots.B) * riderScale : 0;
  slots.B.group.position.set(
    parseFloat(document.getElementById("mountX").value),
    parseFloat(document.getElementById("mountY").value) - hipDrop,
    parseFloat(document.getElementById("mountZ").value)
  );
  slots.B.group.rotation.y = THREE.MathUtils.degToRad(document.getElementById("mountRotY").value);
}

document.getElementById("mountBtn").addEventListener("click", () => {
  if (!slots.A.group || !slots.B.group) { setStatus("carga ambas bases primero"); return; }
  const idx = mountBoneSelect.value;
  if (idx === "") { setStatus("elige un hueso de montura"); return; }
  const bone = slots.A.bones[parseInt(idx)];

  if (slots.B.mountSeat && slots.B.mountSeat.parent) {
    slots.B.mountSeat.parent.remove(slots.B.mountSeat);
  }

  const riderScale = slots.B.group.scale.x;

  // "Asiento" que neutraliza la rotación y escala propias del hueso de A
  // (que pueden venir raras según cómo esté armado ese rig) — así B queda
  // parado derecho y a su tamaño real, pero sigue la posición del hueso
  // mientras A camina/anima, en vez de aplastarse o quedar de lado.
  bone.updateWorldMatrix(true, false);
  const seat = new THREE.Object3D();
  bone.add(seat);
  const boneWorldQuat = new THREE.Quaternion();
  bone.getWorldQuaternion(boneWorldQuat);
  const boneWorldScale = new THREE.Vector3();
  bone.getWorldScale(boneWorldScale);
  seat.quaternion.copy(boneWorldQuat.invert());
  seat.scale.set(1 / boneWorldScale.x, 1 / boneWorldScale.y, 1 / boneWorldScale.z);

  seat.add(slots.B.group);
  slots.B.group.scale.setScalar(riderScale);
  slots.B.mounted = true;
  slots.B.mountSeat = seat;

  // Al montar, los sliders mountX/Y/Z siguen en su valor anterior (o en 0),
  // lo que casi siempre deja a B flotando sobre el hueso en vez de pegado
  // a A. Por eso, en cuanto se monta, se ajusta automáticamente mountY con
  // el mismo cálculo de "pegar a superficie" — así nunca queda flotando de
  // entrada. mountX/mountZ y el slider de mountY siguen disponibles después
  // por si quieres bajarlo/subirlo o correrlo tú a mano.
  const snapped = snapMountToSurface(true);
  if (!snapped) applyMountPositionFromSliders();

  if (slots.B.gait) {
    slots.B.gait.setSeated(document.getElementById("seatedCheck").checked);
    slots.B.gait.setPositionLocked(true);
  }
  setStatus(
    "B montado sobre A" +
    (document.getElementById("seatedCheck").checked ? ", sentado" : "") +
    (snapped ? " — pegado a la superficie" : " — no se encontró superficie, ajusta mountY a mano")
  );
});

document.getElementById("seatedCheck").addEventListener("change", (e) => {
  if (slots.B.mounted && slots.B.gait) slots.B.gait.setSeated(e.target.checked);
  applyMountPositionFromSliders();
  // El bloqueo de posición depende de si B está montado, no del checkbox
  // "sentado" — se reafirma aquí solo para cubrir el caso raro en que el
  // gait engine se haya recreado (recarga de modelo) entre montar y este cambio.
  if (slots.B.gait) slots.B.gait.setPositionLocked(slots.B.mounted);
});

document.getElementById("unmountBtn").addEventListener("click", () => {
  if (!slots.B.group || !slots.B.mounted) return;
  scene.attach(slots.B.group); // conserva la transformación de mundo actual
  if (slots.B.mountSeat && slots.B.mountSeat.parent) {
    slots.B.mountSeat.parent.remove(slots.B.mountSeat);
  }
  slots.B.mountSeat = null;
  slots.B.mounted = false;
  if (slots.B.gait) { slots.B.gait.setSeated(false); slots.B.gait.setPositionLocked(false); }
  positionSideBySide();
  setStatus("B desmontado");
});

// El hueso de montura suele estar adentro del volumen de la malla (p.ej. el
// centro de la palma), no en su superficie visible — por eso ajustar mountY
// a ojo deja hueco o entierra a B. Esta función tira un rayo hacia abajo desde
// arriba del hueso contra la malla REAL de A y calcula el mountY exacto que
// pone los pies de B tocando esa superficie, sin tantear el slider a mano.
// Devuelve true si encontró superficie y ajustó, false si no.
function snapMountToSurface(silent) {
  if (!slots.B.mounted || !slots.B.mountSeat || !slots.B.mountSeat.parent) {
    if (!silent) setStatus("monta B en A primero");
    return false;
  }
  const bone = slots.B.mountSeat.parent;
  bone.updateWorldMatrix(true, false);
  const seatWorldPos = new THREE.Vector3();
  bone.getWorldPosition(seatWorldPos);

  const rayOrigin = seatWorldPos.clone();
  rayOrigin.y += Math.max((slots.A.baseHeight || 1) * (slots.A.group.scale.x || 1), 0.5);
  const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0));
  const targets = meshesOfRootExcluding(slots.A.root, slots.B.group);
  // three.js cachea el radio/caja delimitadora de una malla con esqueleto la
  // PRIMERA vez que se raycastea contra ella, y ya no la vuelve a recalcular
  // sola — si A sigue animándose (caminando, etc.) esa caché queda vieja y
  // puede rechazar de entrada un rayo que sí debería chocar con la pose
  // actual. Se fuerza a recalcular justo antes de tirar el rayo para que
  // siempre compare contra la pose de A tal como se ve ahora mismo.
  targets.forEach((m) => {
    if (m.isSkinnedMesh) { m.boundingSphere = null; m.boundingBox = null; }
  });
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) {
    if (!silent) setStatus("no se encontró superficie de A justo debajo del hueso de montura — prueba otro hueso");
    return false;
  }
  const surfaceY = hits[0].point.y;

  // Al armar el "asiento" (seat) se neutraliza la rotación y escala propias
  // del hueso y se compensa exactamente, así que su escala de mundo queda en
  // 1 — por eso mover mountY en 1 unidad mueve a B 1 unidad real en mundo,
  // sin factores de escala de por medio.
  const seated = document.getElementById("seatedCheck").checked;
  const riderScale = slots.B.group.scale.x;
  const hipDrop = seated ? computeHipLocalHeight(slots.B) * riderScale : 0;
  // El punto del rayo solo comprueba la superficie de A justo debajo del
  // hueso — si el cuerpo de B se curva hacia afuera cerca de ahí (como pasa
  // casi siempre con dos mallas independientes que no calzan exactas), tocar
  // apenas ese punto sigue dejando un valle/hueco visible a los lados. Por
  // eso se hunde B una cantidad real (no solo una fracción mínima) — el
  // slider "Hundido" controla cuánto, para que se pueda ajustar sin tocar
  // código si con el valor por defecto no alcanza a tapar el hueco.
  const sinkDepthEl = document.getElementById("sinkDepth");
  const sinkDepth = (sinkDepthEl ? parseFloat(sinkDepthEl.value) : 0.03) * riderScale;

  const slider = document.getElementById("mountY");
  let newMountY = (surfaceY - seatWorldPos.y) + hipDrop - sinkDepth;
  updateMountSliderRanges(); // por si acaso, antes de asignar — nunca debe recortar en silencio
  if (Math.abs(newMountY) > parseFloat(slider.max)) {
    // último recurso, solo si algo salió realmente fuera de escala (ej. NaN
    // por un hueso raro) — igual avisa en vez de recortar mudo
    newMountY = THREE.MathUtils.clamp(newMountY, parseFloat(slider.min), parseFloat(slider.max));
    if (!silent) setStatus("⚠️ el ajuste calculado se salía de rango y se recortó — revisa las proporciones/escala de B");
  }
  slider.value = newMountY;
  document.getElementById("mountYVal") && (document.getElementById("mountYVal").textContent = newMountY.toFixed(2));
  applyMountPositionFromSliders();
  return true;
}

document.getElementById("snapToSurfaceBtn").addEventListener("click", () => {
  if (snapMountToSurface(false)) setStatus("B pegado a la superficie de A");
});

["mountX", "mountY", "mountZ", "mountRotY"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    if (id === "mountY") {
      const v = document.getElementById("mountYVal");
      if (v) v.textContent = parseFloat(document.getElementById("mountY").value).toFixed(2);
    }
    applyMountPositionFromSliders();
  });
});

// El slider de hundido solo cambia cuánto se mete B la PRÓXIMA vez que le
// des a "Pegar a la superficie" (o vuelvas a montar) — no re-hunde solo
// mientras lo arrastras, porque necesita recalcular contra la malla de A.
const sinkDepthSlider = document.getElementById("sinkDepth");
const sinkDepthVal = document.getElementById("sinkDepthVal");
sinkDepthSlider.addEventListener("input", () => {
  sinkDepthVal.textContent = parseFloat(sinkDepthSlider.value).toFixed(3);
  if (slots.B.mounted) snapMountToSurface(true);
});


// ---------- Mapeo de huesos (tab "Huesos") ----------
const riggingTargetSelect = document.getElementById("riggingTargetSelect");
const boneMapList = document.getElementById("boneMapList");

function slotLabel(slotName) {
  const slot = slots[slotName];
  if (!slot.group) return null;
  return `Base ${slotName} — ${(slot.displayName || slot.url.split("/").pop())}`;
}

function refreshTargetSelectors() {
  [riggingTargetSelect, document.getElementById("paintTargetSelect"), document.getElementById("animTargetSelect"),
   document.getElementById("petActorSelect"), document.getElementById("petTargetSelect"),
   document.getElementById("hairTargetSelect")].forEach((sel) => {
    const prev = sel.value;
    sel.innerHTML = '<option value="">—</option>';
    ["A", "B"].forEach((s) => {
      const label = slotLabel(s);
      if (label) sel.innerHTML += `<option value="${s}">${label}</option>`;
    });
    if (["A", "B"].includes(prev)) sel.value = prev;
  });
}

function buildRoleOptionsHTML(selected) {
  let html = '<option value="">— ninguno —</option>';
  ROLE_GROUPS.forEach((g) => {
    html += `<optgroup label="${g.group}">`;
    g.roles.forEach((r) => {
      html += `<option value="${r}" ${r === selected ? "selected" : ""}>${ROLE_LABELS[r]}</option>`;
    });
    html += "</optgroup>";
  });
  return html;
}

function renderBoneMapper(slotName) {
  const slot = slots[slotName];
  boneMapList.innerHTML = "";
  if (!slot || !slot.bones.length) {
    boneMapList.innerHTML = '<p class="hint">Este modelo no tiene huesos.</p>';
    return;
  }
  slot.bones.forEach((bone, i) => {
    const current = Object.entries(slot.mapping).find(([, v]) => v.bone === bone);
    const currentRole = current ? current[0] : "";
    const axis = current ? current[1].axis : "z";
    const invert = current ? current[1].invert : false;

    const row = document.createElement("div");
    row.className = "bone-row";
    row.innerHTML = `
      <div style="grid-column:1/-1;font-size:11px;color:#c9cdd6;">${bone.name}</div>
      <select data-i="${i}" class="roleSelect">${buildRoleOptionsHTML(currentRole)}</select>
      <div class="role-extra">
        <select class="axisSelect">
          <option value="x" ${axis === "x" ? "selected" : ""}>eje X</option>
          <option value="y" ${axis === "y" ? "selected" : ""}>eje Y</option>
          <option value="z" ${axis === "z" ? "selected" : ""}>eje Z</option>
        </select>
        <label style="display:flex;align-items:center;gap:4px;"><input type="checkbox" class="invertCheck" ${invert ? "checked" : ""}> invertir</label>
      </div>
    `;
    boneMapList.appendChild(row);

    const roleSelect = row.querySelector(".roleSelect");
    const axisSelect = row.querySelector(".axisSelect");
    const invertCheck = row.querySelector(".invertCheck");

    function sync() {
      // clear this bone from any previous role
      for (const r of Object.keys(slot.mapping)) {
        if (slot.mapping[r].bone === bone) delete slot.mapping[r];
      }
      const role = roleSelect.value;
      if (role) {
        slot.mapping[role] = { bone, axis: axisSelect.value, invert: invertCheck.checked };
      }
      slot.kind = inferKindFromMapping(slot.mapping);
    }
    roleSelect.addEventListener("change", sync);
    axisSelect.addEventListener("change", sync);
    invertCheck.addEventListener("change", sync);
  });
}

riggingTargetSelect.addEventListener("change", () => {
  if (riggingTargetSelect.value) renderBoneMapper(riggingTargetSelect.value);
  else boneMapList.innerHTML = "";
});

document.getElementById("autoMapBtn").addEventListener("click", () => {
  const s = riggingTargetSelect.value;
  if (!s || !slots[s].root) { setStatus("elige un personaje con modelo cargado"); return; }
  const slot = slots[s];
  const { mapping, kind, report } = autoMapBones(slot.bones, slot.root);
  slot.mapping = mapping;
  slot.kind = kind;
  slot.gait = new GaitEngine(slot.mapping, slot.group);
  slot.gait.setState(slot.animState);
  slot.gait.setSpeedMultiplier(slot.speed);
  if (s === "B" && slot.mounted) slot.gait.setSeated(document.getElementById("seatedCheck").checked);
  slot.gait.setPositionLocked(s === "B" && slot.mounted);
  renderBoneMapper(s);
  document.getElementById("mappingSavedHint").textContent = "Re-mapeado automático. " + report.join(" ");
  setStatus("huesos auto-mapeados para " + s);
});

document.getElementById("saveMappingBtn").addEventListener("click", () => {
  const s = riggingTargetSelect.value;
  if (!s) return;
  const slot = slots[s];
  slot.gait = new GaitEngine(slot.mapping, slot.group);
  slot.gait.setState(slot.animState);
  slot.gait.setSpeedMultiplier(slot.speed);
  if (s === "B" && slot.mounted) slot.gait.setSeated(document.getElementById("seatedCheck").checked);
  slot.gait.setPositionLocked(s === "B" && slot.mounted);

  const store = loadMappingStore();
  const key = boneKeyForModel(slot.url, slot.bones);
  const serializable = { __kind: slot.kind || inferKindFromMapping(slot.mapping) };
  for (const role of Object.keys(slot.mapping)) {
    const m = slot.mapping[role];
    serializable[role] = { boneName: m.bone.name, axis: m.axis, invert: m.invert };
  }
  store[key] = serializable;
  saveMappingStore(store);
  document.getElementById("mappingSavedHint").textContent = "Mapeo guardado. La animación ya está activa.";
});

function inferKindFromMapping(mapping) {
  const legCount = ["leg_fl", "leg_fr", "leg_bl", "leg_br"].filter((r) => mapping[r]).length;
  return legCount >= 3 ? "quad" : legCount > 0 ? "biped" : "other";
}

function applyMappingFromStored(slotName, stored) {
  const slot = slots[slotName];
  const mapping = {};
  for (const role of Object.keys(stored)) {
    if (role === "__kind") continue;
    const entry = stored[role];
    const bone = slot.bones.find((b) => b.name === entry.boneName);
    if (bone) mapping[role] = { bone, axis: entry.axis, invert: entry.invert };
  }
  slot.mapping = mapping;
  slot.kind = stored.__kind || inferKindFromMapping(mapping);
  slot.gait = new GaitEngine(mapping, slot.group);
  slot.gait.setState(slot.animState);
  slot.gait.setSpeedMultiplier(slot.speed);
  if (slotName === "B" && slot.mounted) slot.gait.setSeated(document.getElementById("seatedCheck").checked);
  slot.gait.setPositionLocked(slotName === "B" && slot.mounted);
}

// ---------- Estados de animación (barra inferior) ----------
const animTargetSelect = document.getElementById("animTargetSelect");
document.querySelectorAll(".animbtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".animbtn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const state = btn.dataset.state;
    const s = animTargetSelect.value;
    if (s && slots[s].gait) {
      slots[s].animState = state;
      slots[s].gait.setState(state);
    } else if (s) {
      slots[s].animState = state;
    } else {
      ["A", "B"].forEach((sn) => {
        slots[sn].animState = state;
        if (slots[sn].gait) slots[sn].gait.setState(state);
      });
    }
  });
});
document.getElementById("speedSlider").addEventListener("input", (e) => {
  const v = parseFloat(e.target.value);
  const s = animTargetSelect.value;
  const apply = (sn) => { slots[sn].speed = v; if (slots[sn].gait) slots[sn].gait.setSpeedMultiplier(v); };
  if (s) apply(s); else { apply("A"); apply("B"); }
});

document.getElementById("petSwapBtn").addEventListener("click", () => {
  const actorSel = document.getElementById("petActorSelect"), targetSel = document.getElementById("petTargetSelect");
  const a = actorSel.value, b = targetSel.value;
  actorSel.value = b; targetSel.value = a;
});

document.getElementById("petBtn").addEventListener("click", () => {
  const actorS = document.getElementById("petActorSelect").value;
  const targetS = document.getElementById("petTargetSelect").value;
  if (!actorS || !targetS || actorS === targetS) { setStatus("elige dos personajes distintos"); return; }
  const actor = slots[actorS], target = slots[targetS];
  if (!actor.gait || !target.gait) { setStatus("mapea los huesos de ambos primero (pestaña Huesos)"); return; }
  const prevActorState = actor.animState, prevTargetState = target.animState;
  actor.gait.setState("pet_act");
  target.gait.setState("pet_react");
  setStatus(`${actorS} acaricia a ${targetS}…`);
  setTimeout(() => {
    actor.gait.setState(prevActorState);
    target.gait.setState(prevTargetState);
    setStatus("listo");
  }, 3200);
});

// ---------- Pintura (tab "Pintar") ----------
const paintTargetSelect = document.getElementById("paintTargetSelect");
const paintTool = new PaintTool(renderer, camera, scene);
paintTool.onStrokeStateChange = (painting) => { controls.enabled = !painting; };

const paintColorWheel = new ColorWheel(document.getElementById("paintColorWheel"), (hex) => (paintTool.color = hex));
paintTool.color = paintColorWheel.hex;
setupBrushGallery(document.getElementById("paintBrushRow"), document.getElementById("paintBrushFile"), (img) => paintTool.setStampImage(img));
const brushSize = document.getElementById("brushSize");
brushSize.addEventListener("input", () => {
  paintTool.size = parseInt(brushSize.value);
  document.getElementById("brushSizeVal").textContent = brushSize.value;
});
paintTool.size = parseInt(brushSize.value);

const QUICK_COLORS = ["#ffffff", "#1b1b1b", "#e0554f", "#ff8a5b", "#f4d35e", "#5bc9ff", "#3a7ca5", "#6bd48f", "#8e5bd4", "#e7cba9", "#5b3a29", "#c04ea0"];
const paletteEl = document.getElementById("quickPalette");
QUICK_COLORS.forEach((c) => {
  const sw = document.createElement("div");
  sw.className = "swatch";
  sw.style.background = c;
  sw.addEventListener("click", () => {
    paintColorWheel.setColor(c);
    paintTool.color = c;
    paintTool.erase = false;
    document.getElementById("eraseBtn").classList.remove("btn-primary");
  });
  paletteEl.appendChild(sw);
});

document.getElementById("eraseBtn").addEventListener("click", (e) => {
  paintTool.erase = !paintTool.erase;
  e.target.classList.toggle("btn-primary", paintTool.erase);
});
document.getElementById("undoPaintBtn").addEventListener("click", () => {
  const s = paintTargetSelect.value;
  if (!s || !slots[s].root) return;
  slots[s].root.traverse((o) => { if (o.isMesh) paintTool.undo(o); });
});
document.getElementById("resetPaintBtn").addEventListener("click", () => {
  const s = paintTargetSelect.value;
  if (!s || !slots[s].root) return;
  slots[s].root.traverse((o) => { if (o.isMesh) paintTool.resetSkin(o); });
});

const togglePaintBtn = document.getElementById("togglePaintBtn");
const paintHint = document.getElementById("paintCursorHint");
let paintModeOn = false;
togglePaintBtn.addEventListener("click", () => {
  paintModeOn = !paintModeOn;
  if (paintModeOn) {
    const s = paintTargetSelect.value;
    if (!s || !slots[s].root) { paintModeOn = false; setStatus("elige un personaje para pintar"); return; }
    paintTool.setTargetRoot(slots[s].root);
    paintTool.enable(renderer.domElement);
    paintHint.classList.remove("hidden");
    togglePaintBtn.textContent = "Desactivar modo pintura";
    togglePaintBtn.classList.add("btn-primary");
  } else {
    paintTool.disable();
    paintHint.classList.add("hidden");
    togglePaintBtn.textContent = "Activar modo pintura";
    togglePaintBtn.classList.remove("btn-primary");
  }
});

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".tabpage").forEach((p) => p.classList.add("hidden"));
    document.getElementById("tab-" + tab.dataset.tab).classList.remove("hidden");
  });
});

function refreshDependentUI() {
  refreshMountBoneOptions();
  refreshTargetSelectors();
  if (riggingTargetSelect.value) renderBoneMapper(riggingTargetSelect.value);
  updateMountSliderRanges();
}

function setStatus(msg) {
  document.getElementById("statusText").textContent = msg;
}

// ---------- Arrastrar personajes en el visor (para acercarlos y que se toquen) ----------
// Solo mueve al que agarras, con el mouse apretado (pointerdown → pointermove
// → pointerup); pasar el mouse por encima sin apretar NUNCA mueve nada ni
// activa la caricia — eso sigue siendo solo el botón "🤚 Acariciar". Así
// puedes acercar a los dos personajes para que, al acariciar, la pata/mano
// del que acaricia sí llegue a tocar al otro.
const dragHintEl = document.getElementById("dragHint");
const dragRaycaster = new THREE.Raycaster();
const dragNDC = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragHitPoint = new THREE.Vector3();
const dragOffset = new THREE.Vector3();
let draggingSlot = null;

function pointerNDC(e) {
  const rect = canvas.getBoundingClientRect();
  dragNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  dragNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  return dragNDC;
}

function meshesOfRoot(root) {
  const list = [];
  if (root) root.traverse((o) => { if (o.isMesh) list.push(o); });
  return list;
}

// Como "montar" cuelga a B de un hueso de A (bone.add(seat); seat.add(B.group)),
// B.group queda técnicamente colgando DENTRO del árbol de slots.A.root. Un
// meshesOfRoot(slots.A.root) normal, entonces, también recoge las mallas de
// B — así que al buscar "la superficie de A" el rayo podía chocar contra el
// propio B (que ya está ahí, flotando) en vez de A, calculando un ajuste que
// prácticamente reproducía la posición en la que ya estaba: por eso el botón
// de pegar a la superficie no parecía hacer nada. Esta versión recorre el
// árbol de A pero NO baja al subárbol de excludeNode (el grupo de B), así
// que sus mallas quedan fuera de la lista y el rayo solo puede chocar con A.
function meshesOfRootExcluding(root, excludeNode) {
  const list = [];
  if (!root) return list;
  (function walk(o) {
    if (excludeNode && o === excludeNode) return;
    if (o.isMesh) list.push(o);
    for (const child of o.children) walk(child);
  })(root);
  return list;
}

function pickDraggableSlotAt(e) {
  dragRaycaster.setFromCamera(pointerNDC(e), camera);
  for (const sn of ["A", "B"]) {
    const slot = slots[sn];
    if (!slot.group || slot.mounted) continue; // el que va montado se mueve solo con su base
    const hits = dragRaycaster.intersectObjects(meshesOfRoot(slot.root), false);
    if (hits.length) return sn;
  }
  return null;
}

canvas.addEventListener("pointerdown", (e) => {
  if (DESKPET) return;
  if (paintModeOn || hairPickModeOn) return; // esos modos mandan mientras estén activos
  if (e.button !== 0) return;
  const sn = pickDraggableSlotAt(e);
  if (!sn) return;
  const group = slots[sn].group;
  draggingSlot = sn;
  dragPlane.constant = -group.position.y;
  dragRaycaster.ray.intersectPlane(dragPlane, dragHitPoint);
  dragOffset.copy(group.position).sub(dragHitPoint);
  controls.enabled = false;
  if (dragHintEl) dragHintEl.classList.add("hidden");
});

window.addEventListener("pointermove", (e) => {
  if (!draggingSlot) return;
  dragRaycaster.setFromCamera(pointerNDC(e), camera);
  if (dragRaycaster.ray.intersectPlane(dragPlane, dragHitPoint)) {
    const group = slots[draggingSlot].group;
    if (group) {
      group.position.x = dragHitPoint.x + dragOffset.x;
      group.position.z = dragHitPoint.z + dragOffset.z;
    }
  }
});

window.addEventListener("pointerup", () => {
  if (!draggingSlot) return;
  draggingSlot = null;
  controls.enabled = !DESKPET;
});

// ---------- Pelo pintado a mano (estilo Picrew, ver video de referencia) ----------
const hairTargetSelect = document.getElementById("hairTargetSelect");
const hairSliders = {
  x: document.getElementById("hairX"), y: document.getElementById("hairY"), z: document.getElementById("hairZ"),
  rotY: document.getElementById("hairRotY"), rotX: document.getElementById("hairRotX"), scale: document.getElementById("hairScale"),
};

const hairCanvas = new HairCanvas(document.getElementById("hairPaintCanvas"));

const HAIR_QUICK_COLORS = ["#1b1b1b", "#ffffff", "#5b3a29", "#e7cba9", "#e0554f", "#ff8a5b", "#f4d35e", "#6bd48f", "#5bc9ff", "#3a7ca5", "#8e5bd4", "#c04ea0"];
const hairPaletteEl = document.getElementById("hairPalette");
HAIR_QUICK_COLORS.forEach((c) => {
  const sw = document.createElement("div");
  sw.className = "swatch";
  sw.style.background = c;
  sw.addEventListener("click", () => {
    hairColorWheel.setColor(c);
    hairCanvas.color = c;
  });
  hairPaletteEl.appendChild(sw);
});

const hairColorWheel = new ColorWheel(document.getElementById("hairColorWheel"), (hex) => (hairCanvas.color = hex));
hairCanvas.color = hairColorWheel.hex;
setupBrushGallery(document.getElementById("hairBrushRow"), document.getElementById("hairBrushFile"), (img) => {
  hairCanvas.setStampImage(img);
  if (img) setHairTool("stamp"); else setHairTool("brush");
});

const hairBrushSize = document.getElementById("hairBrushSize");
hairBrushSize.addEventListener("input", () => {
  hairCanvas.size = parseInt(hairBrushSize.value);
  document.getElementById("hairBrushSizeVal").textContent = hairBrushSize.value;
});
hairCanvas.size = parseInt(hairBrushSize.value);

function setHairTool(tool) {
  hairCanvas.tool = tool;
  ["hairBrushBtn", "hairBucketBtn", "hairEraserBtn"].forEach((id) => {
    document.getElementById(id).classList.toggle("btn-primary", document.getElementById(id).dataset.tool === tool);
  });
}
document.getElementById("hairBrushBtn").addEventListener("click", () => setHairTool("brush"));
document.getElementById("hairBucketBtn").addEventListener("click", () => setHairTool("bucket"));
document.getElementById("hairEraserBtn").addEventListener("click", () => setHairTool("eraser"));
setHairTool("brush");

document.getElementById("hairLockAlpha").addEventListener("change", (e) => { hairCanvas.lockAlpha = e.target.checked; });
document.getElementById("hairUndoBtn").addEventListener("click", () => {
  hairCanvas.undo();
  liveRefreshHair();
});
document.getElementById("hairClearBtn").addEventListener("click", () => {
  hairCanvas.clear();
  liveRefreshHair();
});

// mientras se pinta, si ya hay una placa puesta en escena, refrescarla en vivo
function liveRefreshHair() {
  const s = hairTargetSelect.value;
  if (s && slots[s] && slots[s].hair) refreshPaintedHairTexture(slots[s].hair.mesh);
}
["pointerup"].forEach((ev) => hairCanvas.canvas.addEventListener(ev, liveRefreshHair));

function defaultHairOffset() { return { x: 0, y: 0, z: 0, rotY: 0, rotX: 0, scale: 1 }; }

// Punto+normal elegidos con clic directo sobre el modelo, en espera de que
// se le dé a "Poner/actualizar pelo". Uno por personaje (A/B).
const pendingHairPick = { A: null, B: null };

function loadHairUIFromSlot(slotName) {
  const slot = slots[slotName];
  if (!slot) return;
  const off = (slot.hair && slot.hair.offset) || defaultHairOffset();
  hairSliders.x.value = off.x; hairSliders.y.value = off.y; hairSliders.z.value = off.z;
  hairSliders.rotY.value = off.rotY; hairSliders.rotX.value = off.rotX; hairSliders.scale.value = off.scale;
  document.getElementById("hairAnchorMode").value = (slot.hair && slot.hair.anchorMode) || "frente";
  document.getElementById("hairFlipFront").checked = !!(slot.hair && slot.hair.flipFront);
}

hairTargetSelect.addEventListener("change", () => loadHairUIFromSlot(hairTargetSelect.value));

// La placa queda orientada al ras de la superficie (normal del punto de
// anclaje) y los sliders rotX/rotY giran ENCIMA de esa orientación — así
// siempre queda pegada como calcomanía, nunca mirando para cualquier lado.
function applyHairTransform(slotName) {
  const slot = slots[slotName];
  if (!slot || !slot.hair) return;
  const m = slot.hair.mesh, off = slot.hair.offset, anchor = slot.hair.anchor, normal = slot.hair.normal;
  // Empujoncito fijo hacia afuera, a lo largo de la normal de la superficie,
  // solo para evitar que la placa se meta dentro de la piel (z-fighting) —
  // no para "flotar": es una fracción chiquita del tamaño de la propia placa.
  const epsilon = (slot.hair.plateSize || 0.1) * 0.03;
  const push = normal.clone().multiplyScalar(epsilon);
  m.position.set(anchor.x + off.x + push.x, anchor.y + off.y + push.y, anchor.z + off.z + push.z);
  const baseQuat = quaternionFromAnchorNormal(normal);
  const offQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler((off.rotX * Math.PI) / 180, (off.rotY * Math.PI) / 180, 0)
  );
  m.quaternion.copy(baseQuat).multiply(offQuat);
  m.scale.setScalar(off.scale);
}

Object.entries(hairSliders).forEach(([key, input]) => {
  input.addEventListener("input", () => {
    const s = hairTargetSelect.value;
    if (!s || !slots[s].hair) return;
    slots[s].hair.offset[key] = parseFloat(input.value);
    applyHairTransform(s);
  });
});

// ---------- Elegir con un clic dónde va el pelo ----------
const hairPickBtn = document.getElementById("hairPickBtn");
const hairPickCursorHint = document.getElementById("hairPickCursorHint");
let hairPickModeOn = false;
const hairPickRaycaster = new THREE.Raycaster();
const hairPickNDC = new THREE.Vector2();

function setHairPickMode(on) {
  hairPickModeOn = on;
  hairPickCursorHint.classList.toggle("hidden", !on);
  hairPickBtn.classList.toggle("btn-primary", on);
  hairPickBtn.textContent = on ? "🎯 Haz clic en el modelo…" : "🎯 Elegir el punto en el modelo";
}

hairPickBtn.addEventListener("click", () => {
  const s = hairTargetSelect.value;
  if (!s || !slots[s].root) { setStatus("elige un personaje con modelo cargado"); return; }
  document.getElementById("hairAnchorMode").value = "custom";
  setHairPickMode(!hairPickModeOn);
});

canvas.addEventListener("pointerdown", (e) => {
  if (!hairPickModeOn) return;
  const s = hairTargetSelect.value;
  if (!s || !slots[s].root) { setHairPickMode(false); return; }
  const rect = canvas.getBoundingClientRect();
  hairPickNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  hairPickNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  hairPickRaycaster.setFromCamera(hairPickNDC, camera);
  const meshes = [];
  slots[s].root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const hits = hairPickRaycaster.intersectObjects(meshes, false);
  if (!hits.length || !hits[0].face) { setStatus("no le diste al modelo, intenta de nuevo"); return; }
  const hit = hits[0];
  pendingHairPick[s] = computeHairAnchorFromPick(slots[s].root, hit.point, hit.object, hit.face.normal);
  setHairPickMode(false);
  setStatus(`punto elegido en ${s} — dale a "Poner/actualizar pelo" para pegarlo ahí`);
  // si ya había pelo puesto, lo reubica de inmediato ahí mismo
  if (slots[s].hair) {
    slots[s].hair.anchor = pendingHairPick[s].anchor;
    slots[s].hair.normal = pendingHairPick[s].normal;
    slots[s].hair.anchorMode = "custom";
    applyHairTransform(s);
  }
});

document.getElementById("applyHairBtn").addEventListener("click", () => {
  const s = hairTargetSelect.value;
  if (!s || !slots[s].root) { setStatus("elige un personaje con modelo cargado"); return; }
  if (hairCanvas.isEmpty()) { setStatus("pinta algo de pelo en el lienzo primero"); return; }
  const slot = slots[s];

  const anchorMode = document.getElementById("hairAnchorMode").value;
  const flipFront = document.getElementById("hairFlipFront").checked;
  const offset = (slot.hair && slot.hair.offset) || defaultHairOffset();
  if (slot.hair && slot.hair.mesh && slot.hair.mesh.parent) {
    slot.hair.mesh.parent.remove(slot.hair.mesh);
  }

  // Pegado directo al MODELO (slot.root), nunca a un hueso. Con "custom" se
  // usa el punto+normal exactos que el usuario eligió con clic; con los
  // presets de siempre se calcula con la caja del propio modelo — de
  // cualquier forma da igual cómo esté rotado el esqueleto interno del rig.
  let anchorData;
  if (anchorMode === "custom" && pendingHairPick[s]) {
    anchorData = pendingHairPick[s];
  } else if (anchorMode === "custom" && slot.hair && slot.hair.anchor) {
    anchorData = { anchor: slot.hair.anchor, normal: slot.hair.normal, size: computeHairAnchor(slot.root, "frente", flipFront).size };
  } else {
    anchorData = computeHairAnchor(slot.root, anchorMode, flipFront);
  }
  const { anchor, normal, size } = anchorData;

  // `size` viene en unidades de mundo (incluye la escala del wrapper); como la
  // placa se agrega como hija de slot.root (dentro del wrapper), hay que
  // deshacer esa escala para que el tamaño en pantalla salga correcto.
  const wrapperScale = (slot.group && slot.group.scale.x) || 1;
  const plateSize = Math.max((size.y / wrapperScale) * 0.3, 0.03);
  const mesh = buildPaintedHair(hairCanvas.canvas, plateSize, plateSize);
  slot.root.add(mesh);
  slot.hair = { mesh, offset, anchor, normal, anchorMode, flipFront, plateSize };
  applyHairTransform(s);
  const whereLabel = anchorMode === "custom" ? "el punto que elegiste" : (anchorMode === "cuernos" ? "arriba/atrás de la cabeza" : "frente de la cara");
  setStatus(`pelo pintado puesto en ${s} (${whereLabel}), pegado a la superficie`);
});

document.getElementById("removeHairBtn").addEventListener("click", () => {
  const s = hairTargetSelect.value;
  if (!s || !slots[s].hair) return;
  const m = slots[s].hair.mesh;
  if (m.parent) m.parent.remove(m);
  slots[s].hair = null;
  setStatus("pelo quitado de " + s);
});


// ---------- Exportar: hornear la animación en un .glb descargable ----------
// Corre gait.update(t) real en cada muestra y lee el resultado (rotation ya
// convertida a quaternion por three.js), así que la animación exportada es
// pixel-por-pixel la misma que ves aquí — no una reimplementación aparte
// que se pueda desincronizar si algún día se ajusta gait.js.
function bakeClipForSlot(slotName) {
  const slot = slots[slotName];
  if (!slot.root || !slot.gait || !slot.group) return null;
  const gait = slot.gait;
  const duration = gait.getLoopDuration();
  const samples = 48;
  const times = [];
  for (let i = 0; i <= samples; i++) times.push((i / samples) * duration);

  const bones = new Set();
  Object.values(slot.mapping).forEach((e) => { if (e && e.bone) bones.add(e.bone); });

  const quatValues = new Map();
  bones.forEach((b) => quatValues.set(b, []));
  const rootPos = [];
  const rootQuat = [];

  times.forEach((tt) => {
    gait.update(tt);
    bones.forEach((b) => {
      const q = b.quaternion;
      quatValues.get(b).push(q.x, q.y, q.z, q.w);
    });
    rootPos.push(slot.group.position.x, slot.group.position.y, slot.group.position.z);
    const gq = slot.group.quaternion;
    rootQuat.push(gq.x, gq.y, gq.z, gq.w);
  });

  const tracks = [];
  bones.forEach((b) => {
    tracks.push(new THREE.QuaternionKeyframeTrack(b.uuid + ".quaternion", times, quatValues.get(b)));
  });
  tracks.push(new THREE.VectorKeyframeTrack(slot.group.uuid + ".position", times, rootPos));
  tracks.push(new THREE.QuaternionKeyframeTrack(slot.group.uuid + ".quaternion", times, rootQuat));

  // deja todo como estaba (el bucle de animate() lo va a pisar de nuevo en el
  // siguiente frame con el tiempo real, pero por las dudas lo regresamos ya)
  gait.update(clock.getElapsedTime());

  return new THREE.AnimationClip(slot.animState || "clip", duration, tracks);
}

function downloadGLB(target, clips, filename) {
  const exporter = new GLTFExporter();
  document.getElementById("exportHint").textContent = "exportando…";
  exporter.parse(
    target,
    (result) => {
      const blob = new Blob([result], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      document.getElementById("exportHint").textContent = "✅ exportado: " + filename;
      setStatus("exportado: " + filename);
    },
    (err) => {
      console.error(err);
      document.getElementById("exportHint").textContent = "❌ error exportando: " + err.message;
    },
    { binary: true, animations: clips.filter(Boolean) }
  );
}

function exportSlot(slotName) {
  const slot = slots[slotName];
  if (!slot.root) { document.getElementById("exportHint").textContent = "no hay nada cargado en " + slotName; return; }
  const clip = bakeClipForSlot(slotName);
  const name = (slot.displayName || "modelo").replace(/\.[^.]+$/, "") + "_" + (slot.animState || "pose") + ".glb";
  downloadGLB(slot.group, [clip], name);
}

document.getElementById("exportABtn").addEventListener("click", () => exportSlot("A"));
document.getElementById("exportBBtn").addEventListener("click", () => exportSlot("B"));
document.getElementById("exportBothBtn").addEventListener("click", () => {
  if (!slots.A.root && !slots.B.root) { document.getElementById("exportHint").textContent = "no hay nada cargado"; return; }
  const clipA = bakeClipForSlot("A");
  const clipB = bakeClipForSlot("B");
  let target;
  if (slots.B.mounted && slots.A.group) {
    target = slots.A.group; // B ya vive adentro de la jerarquía de A (montado)
  } else {
    target = [slots.A.group, slots.B.group].filter(Boolean);
  }
  downloadGLB(target, [clipA, clipB], "criadero_escena.glb");
});


function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  if (slots.A.gait) slots.A.gait.update(t);
  if (slots.B.gait) slots.B.gait.update(t);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// Arranca vacío — carga tu propio .glb arrastrándolo o con el botón de cada Base.
setStatus("listo — arrastra tu .glb en Base A para empezar");

// ---------- Modo mascota de escritorio: clic-a-través pixel-perfecto + arrastre ----------
// Solo se activa si estamos dentro de Electron (window.deskpetAPI, expuesto por preload.js)
// y venimos con ?deskpet=1. En zonas transparentes el mouse "atraviesa" hacia el escritorio;
// sobre el personaje, lo agarras y lo arrastras.
if (DESKPET && window.deskpetAPI) {
  const gl = renderer.getContext();
  const pixelBuf = new Uint8Array(4);
  let dragging = false;

  function alphaAtClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const xw = Math.round((clientX - rect.left) * (canvas.width / rect.width));
    const yw = Math.round(canvas.height - (clientY - rect.top) * (canvas.height / rect.height));
    if (xw < 0 || yw < 0 || xw >= canvas.width || yw >= canvas.height) return 0;
    gl.readPixels(xw, yw, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf);
    return pixelBuf[3];
  }

  window.addEventListener("mousedown", (e) => {
    if (alphaAtClient(e.clientX, e.clientY) > 10) dragging = true;
  });
  window.addEventListener("mouseup", () => { dragging = false; });
  window.addEventListener("mouseleave", () => { dragging = false; });
  window.addEventListener("mousemove", (e) => {
    if (dragging) {
      window.deskpetAPI.dragMove(e.movementX, e.movementY);
    } else {
      const a = alphaAtClient(e.clientX, e.clientY);
      window.deskpetAPI.setIgnoreMouse(a <= 10);
    }
  });
}
