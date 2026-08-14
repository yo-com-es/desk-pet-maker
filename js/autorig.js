// autorig.js — Mapea huesos automáticamente analizando la posición del
// esqueleto en su pose de reposo (bind pose). No depende de nombres de
// hueso: usa geometría (quién está abajo/arriba, quién es hoja, quién se
// ramifica) para adivinar patas, columna, cola y cabeza — el mismo tipo de
// heurística que usaría alguien mapeando a mano, pero automática.
//
// Devuelve un mapping con la misma forma que usa gait.js:
//   { role: { bone: THREE.Bone, axis: 'x'|'y'|'z', invert: bool } }

import * as THREE from "three";

function boneChildren(b) {
  return b.children.filter((c) => c.isBone);
}

function worldPos(bone) {
  const v = new THREE.Vector3();
  bone.getWorldPosition(v);
  return v;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Construye cadenas: de cada hueso hoja hacia arriba, hasta el punto donde
// el padre se ramifica (tiene más de un hijo-hueso) o se acaba el esqueleto.
function buildChains(bones) {
  const leaves = bones.filter((b) => boneChildren(b).length === 0);
  const chains = [];
  for (const leaf of leaves) {
    const chainBones = [leaf];
    let cur = leaf;
    while (true) {
      const p = cur.parent && cur.parent.isBone ? cur.parent : null;
      if (!p) break;
      if (boneChildren(p).length > 1) break;
      chainBones.unshift(p);
      cur = p;
    }
    chains.push({ bones: chainBones });
  }
  return chains;
}

function assignSide(group, leftRole, rightRole, mapping, poseFn) {
  if (!group.length) return;
  group.sort((a, b) => b.attachPos.x - a.attachPos.x); // +X primero
  if (group.length >= 1) poseFn(group[0], leftRole, mapping);
  if (group.length >= 2) poseFn(group[group.length - 1], rightRole, mapping);
}

// Elige, para un hueso dado, cuál de sus 3 ejes locales (en su pose de
// reposo) apunta más parecido a una dirección deseada en el mundo (por
// ejemplo el eje izquierda-derecha para que las patas columpien
// adelante/atrás, o el eje vertical para que la cola/columna se menee de
// lado a lado). Devuelve { axis, invert }.
function pickAxis(bone, targetWorldDir) {
  const q = new THREE.Quaternion();
  bone.getWorldQuaternion(q);
  const candidates = [
    { axis: "x", v: new THREE.Vector3(1, 0, 0) },
    { axis: "y", v: new THREE.Vector3(0, 1, 0) },
    { axis: "z", v: new THREE.Vector3(0, 0, 1) },
  ];
  let best = null;
  for (const c of candidates) {
    const world = c.v.clone().applyQuaternion(q);
    const dot = world.dot(targetWorldDir);
    if (!best || Math.abs(dot) > Math.abs(best.dot)) best = { axis: c.axis, dot };
  }
  return { axis: best.axis, invert: best.dot < 0 };
}

const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);

function setRole(mapping, role, bone, targetWorldDir) {
  const { axis, invert } = pickAxis(bone, targetWorldDir);
  mapping[role] = { bone, axis, invert };
}

/**
 * @param {THREE.Bone[]} bones - todos los huesos del modelo
 * @param {THREE.Object3D} root - raíz del modelo ya agregada a la escena (para tener matrixWorld actualizado)
 * @returns {{mapping: object, kind: 'quad'|'biped'|'other', report: string[]}}
 */
export function autoMapBones(bones, root) {
  const mapping = {};
  const report = [];
  if (!bones.length) return { mapping, kind: "other", report: ["Este modelo no tiene esqueleto."] };

  root.updateMatrixWorld(true);
  const chains = buildChains(bones);
  const allPos = bones.map(worldPos);
  const minY = Math.min(...allPos.map((p) => p.y));
  const heightRange = Math.max(Math.max(...allPos.map((p) => p.y)) - minY, 0.0001);
  // Umbral más ajustado: en un humanoide con los brazos colgando, las manos
  // quedan a ~30-35% de la altura — muy cerca de un 38% genérico, así que
  // con eso se confundían con patas. 16% deja pasar pies/patas reales
  // (que llegan casi al suelo) y excluye manos.
  const groundLine = minY + heightRange * 0.16;
  // Referencia de "torso": la altura de la(s) raíz(ces) del esqueleto. Sirve
  // para descartar candidatos a cabeza que estén claramente por debajo del
  // cuerpo, sin que ese cálculo se distorsione por patas que bajan mucho
  // (que es lo que pasaba usando el mínimo/máximo global de todo el rig).
  const rootBones = bones.filter((b) => !b.parent || !b.parent.isBone);
  const torsoY = rootBones.length ? rootBones.reduce((s, b) => s + worldPos(b).y, 0) / rootBones.length : minY;

  function attachBone(c) {
    return c.bones[0].parent && c.bones[0].parent.isBone ? c.bones[0].parent : c.bones[0];
  }

  chains.forEach((c) => {
    c.leafPos = worldPos(c.bones[c.bones.length - 1]);
    c.attachPos = worldPos(attachBone(c));
  });

  // Excluir dedos: varias cadenas cortas que comparten el mismo hueso padre
  // (una mano con 5 dedos) no son patas, son dígitos.
  const rawLegCandidates = chains.filter((c) => c.leafPos.y <= groundLine);
  const attachCounts = new Map();
  rawLegCandidates.forEach((c) => {
    const b = attachBone(c);
    attachCounts.set(b, (attachCounts.get(b) || 0) + 1);
  });
  const legCandidates = rawLegCandidates.filter((c) => attachCounts.get(attachBone(c)) < 3);
  const fingerLike = rawLegCandidates.filter((c) => attachCounts.get(attachBone(c)) >= 3);

  let kind = "other";

  function poseLeg(chain, role, mapping) {
    setRole(mapping, role, chain.bones[0], WORLD_X);
    if (chain.bones[1]) setRole(mapping, role + "_lower", chain.bones[1], WORLD_X);
  }

  if (legCandidates.length >= 3) {
    kind = "quad";
    const medZ = median(legCandidates.map((c) => c.attachPos.z));
    assignSide(legCandidates.filter((c) => c.attachPos.z >= medZ), "leg_fl", "leg_fr", mapping, poseLeg);
    assignSide(legCandidates.filter((c) => c.attachPos.z < medZ), "leg_bl", "leg_br", mapping, poseLeg);
    report.push(`Detectado como cuadrúpedo — ${legCandidates.length} patas encontradas.`);
  } else if (legCandidates.length > 0) {
    kind = "biped";
    assignSide(legCandidates, "leg_bl", "leg_br", mapping, poseLeg);
    report.push("Detectado como humanoide (2 piernas) — mapeadas como leg_bl/leg_br.");
  } else {
    report.push("No se encontraron patas/piernas claras (nada toca el suelo). Revisa el mapeo a mano.");
  }
  if (fingerLike.length) report.push(`Ignorados ${fingerLike.length} huesos tipo dedo (no se animan).`);

  const cx = (Math.min(...allPos.map((p) => p.x)) + Math.max(...allPos.map((p) => p.x))) / 2;
  const cz = (Math.min(...allPos.map((p) => p.z)) + Math.max(...allPos.map((p) => p.z))) / 2;
  const remaining = chains.filter((c) => !legCandidates.includes(c) && !fingerLike.includes(c));

  // Cabeza: la cadena restante más alta (por encima del torso). Si esa
  // cadena comparte su hueso padre con hermanas (pelo/orejas/ojos/cuernos
  // pareados a los lados de la cabeza real), ella misma no es la cabeza —
  // la cabeza real es su hueso padre, recuperado caminando la columna hacia
  // atrás desde ahí.
  let headChain = null;
  let headSource = null; // 'chain' | 'ancestor'
  const headCands = remaining.filter((c) => c.leafPos.y >= torsoY).sort((a, b) => b.leafPos.y - a.leafPos.y);
  if (headCands.length) {
    headChain = headCands[0];
    const parentB = attachBone(headChain);
    const siblings = remaining.filter((c) => attachBone(c) === parentB);
    headSource = siblings.length === 1 ? "chain" : "ancestor";
  } else {
    report.push("No se encontró una cabeza clara (nada sobresale por arriba). Revisa el mapeo a mano.");
  }

  const tailCands = remaining.filter((c) => c !== headChain);
  if (tailCands.length) {
    tailCands.sort((a, b) => {
      const da = Math.hypot(a.leafPos.x - cx, a.leafPos.z - cz);
      const db = Math.hypot(b.leafPos.x - cx, b.leafPos.z - cz);
      return db - da;
    });
    const tailChain = tailCands[0];
    const tb = tailChain.bones.slice(0, 4);
    tb.forEach((bone, i) => setRole(mapping, `tail_${i + 1}`, bone, WORLD_Y));
    report.push(`Cola: ${tb.length} segmento(s) mapeados.`);

    if (kind === "biped") {
      // En un biped, la cadena "más lejana del centro" que no es pierna ni
      // cabeza suele ser en realidad decoración (pelo/cola de caballo), no
      // cola de animal — no la usamos.
      delete mapping.tail_1; delete mapping.tail_2; delete mapping.tail_3; delete mapping.tail_4;

      // Los brazos casi nunca aparecen como "cadena restante" propia: la
      // mano se ramifica en 5 dedos, así que el brazo (hombro/húmero/
      // antebrazo) queda escondido como ancestro de los dedos — igual que
      // pasó con la columna. Lo recuperamos igual: encontramos las "manos"
      // (huesos con 3+ dedos colgando) y caminamos su propia rama hacia
      // atrás para sacar el húmero/antebrazo.
      const handAttachCounts = new Map();
      chains.forEach((c) => {
        const b = attachBone(c);
        if (c.bones.length <= 3) handAttachCounts.set(b, (handAttachCounts.get(b) || 0) + 1);
      });
      const handBones = [...handAttachCounts.entries()].filter(([, n]) => n >= 3).map(([b]) => b);
      if (handBones.length) {
        const armInfo = handBones.map((hand) => {
          const ancestors = [];
          let cur = hand;
          while (cur && cur.isBone) {
            ancestors.unshift(cur);
            cur = cur.parent;
          }
          return { hand, ancestors, x: worldPos(hand).x };
        });
        armInfo.sort((a, b) => b.x - a.x); // +X primero
        const armRoles = ["leg_fl", "leg_fr"];
        armInfo.slice(0, 2).forEach((info, i) => {
          const a = info.ancestors;
          if (a.length >= 3) setRole(mapping, armRoles[i], a[a.length - 3], WORLD_X); // brazo (húmero, cerca del hombro)
          if (a.length >= 2) setRole(mapping, armRoles[i] + "_lower", a[a.length - 2], WORLD_X); // antebrazo (cerca de la mano)
        });
        report.push("Brazos recuperados desde las manos y mapeados como leg_fl/leg_fr (convención para bípedos).");
      }
    }
  }

  // Columna + cabeza/cuello, a partir de los ancestros del hueso justo
  // antes de la cadena de cabeza elegida.
  if (headChain) {
    const ancestors = [];
    let cur = headChain.bones[0].parent;
    while (cur && cur.isBone) {
      ancestors.unshift(cur);
      cur = cur.parent;
    }
    if (headSource === "chain") {
      const hb = headChain.bones;
      const headRoles = hb.length >= 3 ? ["neck", "head", "jaw"] : hb.length === 2 ? ["neck", "head"] : ["head"];
      const startIdx = hb.length - headRoles.length;
      headRoles.forEach((role, i) => setRole(mapping, role, hb[startIdx + i], WORLD_Y));
      report.push(`Cabeza/cuello: ${headRoles.join(", ")}.`);
      const spineBones = ancestors;
      pickSpine(spineBones, mapping, report);
    } else {
      // La cabeza real es un hueso ancestro (rama con pelo/ojos/orejas
      // colgando), no la cadena que usamos para encontrarla.
      const headRoleCount = ancestors.length >= 5 ? 2 : ancestors.length >= 1 ? 1 : 0;
      const headRoles = headRoleCount === 2 ? ["neck", "head"] : headRoleCount === 1 ? ["head"] : [];
      const spineBones = ancestors.slice(0, ancestors.length - headRoleCount);
      headRoles.forEach((role, i) => setRole(mapping, role, ancestors[ancestors.length - headRoleCount + i], WORLD_Y));
      if (headRoles.length) report.push(`Cabeza/cuello (recuperada de la columna): ${headRoles.join(", ")}.`);
      pickSpine(spineBones, mapping, report);
    }
  }

  return { mapping, kind, report };
}

function pickSpine(ancestorBones, mapping, report) {
  if (!ancestorBones.length) return;
  const n = ancestorBones.length;
  const pickCount = Math.min(4, n);
  const picks = [];
  for (let i = 0; i < pickCount; i++) {
    const idx = pickCount === 1 ? n - 1 : Math.round((i * (n - 1)) / (pickCount - 1));
    picks.push(ancestorBones[idx]);
  }
  picks.forEach((bone, i) => setRole(mapping, `spine_${i + 1}`, bone, WORLD_Y));
  report.push(`Columna: ${picks.length} punto(s) mapeados.`);
}
