// Motor de animación procedural genérico.
// No depende de nombres de huesos: usa el mapeo que el usuario asigna en la UI.

export const ROLE_GROUPS = [
  { group: "Patas / brazos (arriba)", roles: ["leg_fl", "leg_fr", "leg_bl", "leg_br"] },
  { group: "Patas / brazos (rodilla, opcional)", roles: ["leg_fl_lower", "leg_fr_lower", "leg_bl_lower", "leg_br_lower"] },
  { group: "Columna (ordenar de cola a cuello)", roles: ["spine_1", "spine_2", "spine_3", "spine_4"] },
  { group: "Cola (ordenar de base a punta)", roles: ["tail_1", "tail_2", "tail_3", "tail_4"] },
  { group: "Cabeza / cuello", roles: ["neck", "head", "jaw"] },
];

export const ALL_ROLES = ROLE_GROUPS.flatMap((g) => g.roles);

export const ROLE_LABELS = {
  leg_fl: "Pata delantera izq.",
  leg_fr: "Pata delantera der.",
  leg_bl: "Pata trasera izq.",
  leg_br: "Pata trasera der.",
  leg_fl_lower: "Rodilla del. izq.",
  leg_fr_lower: "Rodilla del. der.",
  leg_bl_lower: "Rodilla tras. izq.",
  leg_br_lower: "Rodilla tras. der.",
  spine_1: "Columna 1 (cerca cola)",
  spine_2: "Columna 2",
  spine_3: "Columna 3",
  spine_4: "Columna 4 (cerca cuello)",
  tail_1: "Cola 1 (base)",
  tail_2: "Cola 2",
  tail_3: "Cola 3",
  tail_4: "Cola 4 (punta)",
  neck: "Cuello",
  head: "Cabeza",
  jaw: "Mandíbula",
};

const LEG_PAIRS = {
  leg_fl: { phase: 0, kind: "leg" },
  leg_br: { phase: 0, kind: "leg" },
  leg_fr: { phase: Math.PI, kind: "leg" },
  leg_bl: { phase: Math.PI, kind: "leg" },
  leg_fl_lower: { phase: 0, kind: "knee" },
  leg_br_lower: { phase: 0, kind: "knee" },
  leg_fr_lower: { phase: Math.PI, kind: "knee" },
  leg_bl_lower: { phase: Math.PI, kind: "knee" },
};

const STATE_PRESETS = {
  idle: { cycleSpeed: 0.6, legAmpDeg: 3, spineAmpDeg: 2, tailAmpDeg: 6, headAmpDeg: 2, bodyBobAmp: 0.01 },
  walk: { cycleSpeed: 2.4, legAmpDeg: 26, spineAmpDeg: 7, tailAmpDeg: 14, headAmpDeg: 4, bodyBobAmp: 0.03 },
  run: { cycleSpeed: 4.6, legAmpDeg: 42, spineAmpDeg: 14, tailAmpDeg: 24, headAmpDeg: 8, bodyBobAmp: 0.07 },
  pet_act: { cycleSpeed: 0.5, legAmpDeg: 0, spineAmpDeg: 2, tailAmpDeg: 4, headAmpDeg: 2, bodyBobAmp: 0.005 },
  pet_react: { cycleSpeed: 0.6, legAmpDeg: 2, spineAmpDeg: 3, tailAmpDeg: 6, headAmpDeg: 3, bodyBobAmp: 0.008 },
  dance: { cycleSpeed: 3.2, legAmpDeg: 30, spineAmpDeg: 20, tailAmpDeg: 30, headAmpDeg: 14, bodyBobAmp: 0.06 },
};

const deg2rad = (d) => (d * Math.PI) / 180;

// mapping: { role: { bone: THREE.Bone, axis: 'x'|'y'|'z', invert: bool } }
export class GaitEngine {
  constructor(mapping, rootGroup) {
    this.mapping = mapping;
    this.root = rootGroup;
    this.state = "walk";
    this.speedMul = 1;
    this._restEuler = new Map();
    for (const role of ALL_ROLES) {
      const entry = mapping[role];
      if (entry && entry.bone) {
        this._restEuler.set(role, entry.bone.rotation.clone());
      }
    }
    this._baseY = rootGroup ? rootGroup.position.y : 0;
    this.seated = false;
    this.positionLocked = false;
  }

  setSeated(on) {
    this.seated = !!on;
  }

  // Cuando B está montado, su position.y la controla el slider mountY
  // (vía applyMountPositionFromSliders), no el bob de esta clase. Sin este
  // flag, update() pisa position.y en cada cuadro con _baseY + bob y el
  // slider queda sin efecto real después del primer frame de animación.
  setPositionLocked(on) {
    this.positionLocked = !!on;
  }

  setState(state) {
    if (STATE_PRESETS[state]) this.state = state;
  }

  setSpeedMultiplier(m) {
    this.speedMul = m;
  }

  // Vuelve cada hueso mapeado a la rotación que tenía cuando se creó este
  // GaitEngine (la pose de reposo original del modelo), y el grupo raíz a
  // su posición/rotación base. La usa el modo pintura: mientras pintas, el
  // raycast siempre revisa la malla en su pose de reposo (así construye el
  // árbol de aceleración three-mesh-bvh, y así funciona el raycast normal
  // de three.js contra un SkinnedMesh — nunca contra la pose ya animada).
  // Si el personaje seguía caminando/respirando mientras pintabas, lo que
  // veías en pantalla no coincidía con contra qué se probaba el clic, y el
  // pincel terminaba pintando círculos en lugares que parecían al azar.
  resetToRest() {
    for (const role of ALL_ROLES) {
      const entry = this.mapping[role];
      const rest = this._restEuler.get(role);
      if (entry && entry.bone && rest) entry.bone.rotation.copy(rest);
    }
    if (this.root) {
      if (!this.positionLocked) this.root.position.y = this._baseY;
      this.root.rotation.z = 0;
    }
  }

  // Duración de un ciclo completo para el estado actual — la usa el
  // exportador para hornear la animación en un .glb que se repita bien.
  getLoopDuration() {
    const preset = STATE_PRESETS[this.state];
    return (4 * Math.PI) / (preset.cycleSpeed * this.speedMul);
  }

  update(t) {
    const preset = STATE_PRESETS[this.state];
    const cyc = t * preset.cycleSpeed * this.speedMul;

    // Legs
    for (const role of Object.keys(LEG_PAIRS)) {
      const entry = this.mapping[role];
      if (!entry || !entry.bone) continue;
      const { phase, kind } = LEG_PAIRS[role];
      const rest = this._restEuler.get(role);
      const sign = entry.invert ? -1 : 1;
      let val;
      if (this.seated) {
        // Static straddle pose (sitting astride, like on a horse), plus a tiny idle sway.
        const sway = deg2rad(2) * Math.sin(cyc * 0.4 + phase);
        if (kind === "leg") {
          val = sign * (deg2rad(72) + sway); // thigh splayed out/forward
        } else {
          val = sign * (deg2rad(78)); // knee bent down around the mount's flanks
        }
      } else if (kind === "leg") {
        val = sign * deg2rad(preset.legAmpDeg) * Math.sin(cyc + phase);
      } else {
        // knee: bends forward only during the forward-swing half of the cycle
        const raw = Math.sin(cyc + phase - Math.PI / 2);
        val = sign * deg2rad(preset.legAmpDeg * 0.6) * Math.max(0, raw);
      }
      entry.bone.rotation[entry.axis] = rest[entry.axis] + val;
    }

    // Spine wave (traveling wave from tail-end to neck-end)
    ["spine_1", "spine_2", "spine_3", "spine_4"].forEach((role, i) => {
      const entry = this.mapping[role];
      if (!entry || !entry.bone) return;
      const rest = this._restEuler.get(role);
      const sign = entry.invert ? -1 : 1;
      const val = sign * deg2rad(preset.spineAmpDeg) * Math.sin(cyc * 0.5 + i * 0.9);
      entry.bone.rotation[entry.axis] = rest[entry.axis] + val;
    });

    // Tail wave (bigger amplitude toward the tip)
    ["tail_1", "tail_2", "tail_3", "tail_4"].forEach((role, i) => {
      const entry = this.mapping[role];
      if (!entry || !entry.bone) return;
      const rest = this._restEuler.get(role);
      const sign = entry.invert ? -1 : 1;
      const grow = 1 + i * 0.35;
      const val = sign * deg2rad(preset.tailAmpDeg) * grow * Math.sin(cyc * 0.5 + 0.6 + i * 0.7);
      entry.bone.rotation[entry.axis] = rest[entry.axis] + val;
    });

    // Neck / head counter motion for a bit of life
    ["neck", "head"].forEach((role, i) => {
      const entry = this.mapping[role];
      if (!entry || !entry.bone) return;
      const rest = this._restEuler.get(role);
      const sign = entry.invert ? -1 : 1;
      const val = sign * deg2rad(preset.headAmpDeg) * Math.sin(cyc * 0.5 + Math.PI + i * 0.3);
      entry.bone.rotation[entry.axis] = rest[entry.axis] + val;
    });

    // Interacción: quien acaricia baja cabeza/pata hacia el otro; quien es acariciado
    // menea la cola más rápido y ladea la cabeza (reacción contenta).
    if (this.state === "pet_act") {
      const reachRole = this.mapping.leg_fl ? "leg_fl" : (this.mapping.leg_fr ? "leg_fr" : null);
      if (reachRole) {
        const sway = deg2rad(4) * Math.sin(cyc * 1.4);
        const reach = this.mapping[reachRole];
        const rest = this._restEuler.get(reachRole);
        const sign = reach.invert ? -1 : 1;
        // Segmento de arriba (hombro/muslo): levanta y extiende todo el brazo hacia el otro dragón.
        reach.bone.rotation[reach.axis] = rest[reach.axis] + sign * deg2rad(55) + sign * sway;

        const lowerRole = reachRole + "_lower";
        const lower = this.mapping[lowerRole];
        if (lower && lower.bone) {
          const lowerRest = this._restEuler.get(lowerRole);
          const lowerSign = lower.invert ? -1 : 1;
          // Segmento de abajo (codo/rodilla): se dobla para que la pata caiga
          // y roce al dragoncito, con el mismo vaivén suave que el hombro.
          lower.bone.rotation[lower.axis] = lowerRest[lower.axis] + lowerSign * deg2rad(48) + lowerSign * sway * 0.7;
        }
      }
      const headRole = this.mapping.head ? "head" : (this.mapping.neck ? "neck" : null);
      if (headRole) {
        const headEntry = this.mapping[headRole];
        const rest = this._restEuler.get(headRole);
        const sign = headEntry.invert ? -1 : 1;
        headEntry.bone.rotation[headEntry.axis] = rest[headEntry.axis] + sign * deg2rad(22) + sign * deg2rad(3) * Math.sin(cyc * 1.4);
      }
    } else if (this.state === "pet_react") {
      ["tail_1", "tail_2", "tail_3", "tail_4"].forEach((role, i) => {
        const entry = this.mapping[role];
        if (!entry || !entry.bone) return;
        const rest = this._restEuler.get(role);
        const sign = entry.invert ? -1 : 1;
        const grow = 1 + i * 0.35;
        const val = sign * deg2rad(20) * grow * Math.sin(cyc * 3.2 + i * 0.7);
        entry.bone.rotation[entry.axis] = rest[entry.axis] + val;
      });
      const headEntry = this.mapping.head;
      if (headEntry && headEntry.bone) {
        const rest = this._restEuler.get("head");
        const sign = headEntry.invert ? -1 : 1;
        headEntry.bone.rotation[headEntry.axis] = rest[headEntry.axis] + sign * deg2rad(10) * Math.sin(cyc * 1.1);
      }
    }

    // Whole-body bob. position.y es traslación en espacio del padre: NO se
    // escala con este.root.scale, así que hay que multiplicarlo a mano por
    // el scale actual (el deskpet suele vivir escalado chiquito) o el bob
    // queda con tamaño fijo en unidades de mundo y el bicho parece salir
    // volando en vez de dar un saltito proporcional a su tamaño.
    if (this.root) {
      if (!this.positionLocked) {
        const s = this.root.scale.y || 1;
        this.root.position.y = this._baseY + Math.abs(Math.sin(cyc)) * preset.bodyBobAmp * s;
      }
      this.root.rotation.z = this.state === "dance" ? deg2rad(7) * Math.sin(cyc * 0.9) : 0;
    }
  }
}
