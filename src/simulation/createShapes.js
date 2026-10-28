import * as THREE from 'three/webgpu';
import {
  Fn, If, color, float, hash, instanceIndex, instancedArray, max, mix, sin, cos, round,
  uint, uv, vec2, vec3, vec4, smoothstep, exp, step, uniform
} from 'three/tsl';

// =====================================================================
//  HUESOS (tecla 1) y NERVIOS (tecla 2)
//  Cada agente tiene un puesto en una silueta (hueso / árbol nervioso).
//  Percibe: su puesto (que puede moverse), el flow field y el bisturí.
//  Acción: steering ARRIVE (+ feed-forward si el puesto se mueve).
//  HUESOS: cada hueso tiene un LÍDER (agente) que sigue un FLOW FIELD con
//  steering (seek a la velocidad del campo + volver a su carril). Los
//  agentes del hueso lo SIGUEN (leader following: arrive + alineación con
//  la velocidad del líder). El mundo es toroidal: salen por un lado y
//  entran por el otro, como en flocking. La inclinación sale del campo.
// =====================================================================

const W = 12.8;   // medio ancho del recorrido (más que la pantalla: el hueso sale y entra fuera de vista)

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------
//  Piezas para dibujar huesos. Cada una devuelve [u, v, shade]
//  (shade: 1 = centro, 0 = borde) para dar volumen.
// ---------------------------------------------------------------------
function buildBones(count) {
  const rnd = mulberry32(9);
  const TAU = Math.PI * 2;

  const circle = (u, v, r) => ({
    area: Math.PI * r * r,
    inside: (x, y, m) => Math.hypot(x - u, y - v) <= r - m,
    sample: (edge) => {
      const a = rnd() * TAU, f = edge ? 1 : Math.sqrt(rnd());
      return [u + Math.cos(a) * r * f, v + Math.sin(a) * r * f, 1 - f];
    }
  });
  const rect = (cu, cv, hu, hv) => ({
    area: 4 * hu * hv,
    inside: (x, y, m) => Math.abs(x - cu) <= hu - m && Math.abs(y - cv) <= hv - m,
    sample: (edge) => {
      let x, y;
      if (edge) {
        if (rnd() < hu / (hu + hv)) { x = cu + (rnd() * 2 - 1) * hu; y = cv + (rnd() < 0.5 ? -hv : hv); }
        else { x = cu + (rnd() < 0.5 ? -hu : hu); y = cv + (rnd() * 2 - 1) * hv; }
      } else { x = cu + (rnd() * 2 - 1) * hu; y = cv + (rnd() * 2 - 1) * hv; }
      return [x, y, Math.max(0, 1 - Math.max(Math.abs(x - cu) / hu, Math.abs(y - cv) / hv))];
    }
  });
  const shaft = (u0, u1, hwf) => {
    let area = 0;
    for (let k = 0; k < 20; k++) area += 2 * hwf(u0 + (u1 - u0) * (k + 0.5) / 20) * (u1 - u0) / 20;
    return {
      area,
      inside: (x, y, m) => x >= u0 && x <= u1 && Math.abs(y) <= hwf(x) - m,
      sample: (edge) => {
        const x = u0 + rnd() * (u1 - u0), h = hwf(x);
        const y = edge ? (rnd() < 0.5 ? -h : h) : (rnd() * 2 - 1) * h;
        return [x, y, 1 - Math.abs(y) / h];
      }
    };
  };
  const arc = (R, a0, a1, hw) => ({
    area: (a1 - a0) * R * 2 * hw,
    inside: (x, y, m) => {
      let da = Math.atan2(y, x) - a0;
      da = ((da % TAU) + TAU) % TAU;
      return da <= a1 - a0 && Math.abs(Math.hypot(x, y) - R) <= hw - m;
    },
    sample: (edge) => {
      const a = a0 + rnd() * (a1 - a0);
      const rr = R + (edge ? (rnd() < 0.5 ? -hw : hw) : (rnd() * 2 - 1) * hw);
      return [Math.cos(a) * rr, Math.sin(a) * rr, 1 - Math.abs(rr - R) / hw];
    }
  });

  const TYPES = {
    femur: {
      scale: 0.85,
      solids: [
        shaft(-2.8, 2.8, (u) => 0.40 + 0.22 * Math.pow(Math.min(Math.abs(u) / 2.8, 1), 3)),
        circle(-3.2, -0.55, 0.85), circle(-3.0, 0.7, 0.6),
        circle(3.3, -0.6, 0.72), circle(3.3, 0.6, 0.72)
      ],
      holes: []
    },
    humerus: {
      scale: 0.95,
      solids: [
        shaft(-3.2, 3.2, (u) => 0.26 + 0.14 * Math.pow(Math.min(Math.abs(u) / 3.2, 1), 3)),
        circle(-3.55, 0, 0.55), circle(3.5, -0.24, 0.42), circle(3.5, 0.28, 0.42)
      ],
      holes: []
    },
    rib: {
      scale: 1.0,
      solids: [arc(3.2, 0.1, 2.9, 0.24), circle(3.2 * Math.cos(0.1), 3.2 * Math.sin(0.1), 0.4)],
      holes: []
    },
    vertebra: {
      scale: 1.3,
      solids: [
        circle(0, -0.45, 0.75),
        rect(0, 0.25, 1.9, 0.2), circle(-1.9, 0.25, 0.3), circle(1.9, 0.25, 0.3),
        rect(0, 0.95, 0.17, 0.8)
      ],
      holes: [{ u: 0, v: 0.12, r: 0.26 }]
    },
    skull: {
      scale: 1.05,
      solids: [circle(0, 0.2, 1.4), rect(0, -1.25, 0.8, 0.5)],
      holes: [{ u: -0.55, v: 0.15, r: 0.36 }, { u: 0.55, v: 0.15, r: 0.36 }, { u: 0, v: -0.45, r: 0.16 }]
    }
  };

  function samplePoints(type, n) {
    const { solids, holes } = type;
    const parts = [
      ...solids.map((s) => ({ s, w: s.area })),
      ...holes.map((h) => ({ h, w: 2 * Math.PI * h.r * 0.12 }))
    ];
    const total = parts.reduce((a, p) => a + p.w, 0);
    const out = [];
    let guard = 0;
    while (out.length < n && guard++ < n * 300) {
      let pick = rnd() * total, pi = 0;
      while (pi < parts.length - 1 && pick > parts[pi].w) { pick -= parts[pi].w; pi++; }
      const p = parts[pi];
      if (p.h) {                       // aro brillante alrededor de un hueco
        const a = rnd() * TAU;
        const x = p.h.u + Math.cos(a) * p.h.r, y = p.h.v + Math.sin(a) * p.h.r;
        if (solids.some((s) => s.inside(x, y, 0))) out.push([x, y, 1, 0]);
        continue;
      }
      const edge = rnd() < 0.18;
      const [x, y, sh] = p.s.sample(edge);
      if (holes.some((h) => Math.hypot(x - h.u, y - h.v) < h.r * 0.97)) continue;
      if (edge && solids.some((o) => o !== p.s && o.inside(x, y, 0.06))) continue;
      out.push([x, y, edge ? 1 : 0, sh]);
    }
    return out;
  }

  // ---- plan del desfile: 3 carriles, cada uno con su dirección y velocidad ----
  const LANES = [
    { y: 2.9, speed: 0.8, types: ['femur', 'skull', 'rib'] },
    { y: 0.0, speed: -0.55, types: ['vertebra', 'humerus', 'skull'] },
    { y: -2.9, speed: 1.0, types: ['rib', 'femur', 'vertebra'] }
  ];
  const bones = [];
  LANES.forEach((lane, li) => {
    lane.types.forEach((name, k) => {
      const type = TYPES[name];
      const area = type.solids.reduce((a, s) => a + s.area, 0) * type.scale * type.scale;
      bones.push({
        type, area, lane: lane.y, speed: lane.speed,
        phase: -W + k * (2 * W / 3) + li * 3.1,
        rot0: name === 'skull' ? 0 : (rnd() - 0.5) * 0.6,
        swing: (0.5 + rnd() * 0.3) * (rnd() < 0.5 ? -1 : 1)
      });
    });
  });
  const totalArea = bones.reduce((a, b) => a + b.area, 0);

  const home = new Float32Array(count * 4);
  const motion = new Float32Array(count * 4);
  let k = 0;
  bones.forEach((b, bi) => {
    const n = bi === bones.length - 1 ? count - k : Math.round(count * b.area / totalArea);
    const pts = samplePoints(b.type, n);
    let mx = 0, my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    mx /= pts.length; my /= pts.length;
    const ca = Math.cos(b.rot0), sa = Math.sin(b.rot0), sc = b.type.scale;
    for (const p of pts) {
      if (k >= count) break;
      const x = (p[0] - mx) * sc, y = (p[1] - my) * sc;
      home.set([x * ca - y * sa, x * sa + y * ca, p[2], p[3]], k * 4);
      motion.set([bi, 0, 0, 0], k * 4);
      k++;
    }
  });
  while (k < count) { home.copyWithin(k * 4, 0, 4); motion.copyWithin(k * 4, 0, 4); k++; }
  const nb = bones.length;
  const lState = new Float32Array(nb * 4), lPrm = new Float32Array(nb * 4);
  bones.forEach((b, bi) => {
    lState.set([b.phase, b.lane, b.speed, 0], bi * 4);   // x, y, vx, vy
    lPrm.set([b.lane, b.speed, b.phase, 0], bi * 4);     // carril, velocidad, fase del campo
  });
  return { home, motion, leaders: { state: lState, params: lPrm, nb } };
}

// ---------------------------------------------------------------------
//  Geometría de los nervios: troncos que se ramifican recursivamente
//  w = progreso desde la raíz (0) hasta las puntas (1): por ahí viaja el impulso
// ---------------------------------------------------------------------
function buildNerves(count) {
  const rnd = mulberry32(42);
  const samples = [];
  let maxD = 0.001;
  let sideFlip = 1;

  function grow(x, y, ang, len, w, depth, dist) {
    const stepLen = 0.1;
    const n = Math.max(3, Math.round(len / stepLen));
    let px = x, py = y, a = ang;
    const bias = (rnd() - 0.5) * 0.05;
    for (let k = 1; k <= n; k++) {
      a += (rnd() - 0.5) * 0.12 + bias;
      px += Math.cos(a) * stepLen;
      py += Math.sin(a) * stepLen;
      dist += stepLen;
      if (Math.abs(px) > 8.3 || Math.abs(py) > 4.6) return;

      const taper = w * (1 - 0.35 * k / n);
      const reps = Math.max(1, Math.round(taper * 30));
      for (let r = 0; r < reps; r++) samples.push([px, py, taper, dist, a]);
      maxD = Math.max(maxD, dist);

      if (depth < 3) {
        const fork = depth === 0 ? (k % 9 === 0 && k > 12 && k < n - 4) : k === Math.round(n * 0.55);
        if (fork) {
          sideFlip = -sideFlip;
          grow(px, py, a + sideFlip * (0.6 + rnd() * 0.5), len * (depth === 0 ? 0.28 : 0.6), w * 0.6, depth + 1, dist);
        }
        if (depth > 0 && k === n) {
          grow(px, py, a + 0.5, len * 0.6, w * 0.6, depth + 1, dist);
          grow(px, py, a - 0.5, len * 0.6, w * 0.6, depth + 1, dist);
        }
      }
    }
  }

  // tres troncos para ocupar toda la pantalla
  grow(-0.3, 4.6, -Math.PI / 2, 9.2, 0.3, 0, 0);
  grow(-6.2, 4.6, -Math.PI / 2 + 0.18, 9.0, 0.26, 0, 0);
  grow(6.0, 4.6, -Math.PI / 2 - 0.18, 9.0, 0.26, 0, 0);

  for (let i = samples.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [samples[i], samples[j]] = [samples[j], samples[i]];
  }
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const [x, y, wd, dist, a] = samples[i % samples.length];
    const off = (rnd() - 0.5) * wd;
    data[i * 4] = x - Math.sin(a) * off;
    data[i * 4 + 1] = y + Math.cos(a) * off;
    data[i * 4 + 2] = 0.0;
    data[i * 4 + 3] = dist / maxD;
  }
  return data;
}

// ---------------------------------------------------------------------
//  Sistema genérico de agentes con puesto
// ---------------------------------------------------------------------
function createShapeSystem({ renderer, scene, params, homes, motion, leaders, count, size, shade, onStep }) {
  const homeBuffer = instancedArray(homes, 'vec4');
  const motionBuffer = motion ? instancedArray(motion, 'vec4') : null;
  const positionBuffer = instancedArray(count, 'vec3');
  const velocityBuffer = instancedArray(count, 'vec3');
  const leaderState = leaders ? instancedArray(leaders.state, 'vec4') : null;   // x, y, vx, vy
  const leaderParams = leaders ? instancedArray(leaders.params, 'vec4') : null;

  // puesto del agente: fijo (nervios) o relativo a su líder (huesos)
  const targetOf = (i) => {
    const local = homeBuffer.element(i);
    if (!leaders) return { target: local.xyz, lead: vec3(0.0) };
    const L = leaderState.element(uint(motionBuffer.element(i).x));
    const tilt = L.w.div(max(L.z.abs(), 0.3)).clamp(-1.0, 1.0).mul(0.7);   // inclinación = rumbo del líder
    const c = cos(tilt), s = sin(tilt);
    return {
      target: vec3(
        L.x.add(local.x.mul(c)).sub(local.y.mul(s)),
        L.y.add(local.x.mul(s)).add(local.y.mul(c)),
        0.0
      ),
      lead: vec3(L.z, L.w, 0.0)
    };
  };

  const initParticles = Fn(() => {
    const i = instanceIndex;
    const r1 = hash(i.add(uint(11)));
    const r2 = hash(i.add(uint(23)));
    const base = targetOf(i).target;
    const sc = leaders ? 0.0 : 1.0;
    positionBuffer.element(i).assign(vec3(
      base.x.add(r1.sub(0.5).mul(10.0).mul(sc)), base.y.add(r2.sub(0.5).mul(6.0).mul(sc)), base.z
    ));
    velocityBuffer.element(i).assign(vec3(0.0));
  })().compute(count).setName('Initialize Shape');

  // ---------- LÍDERES: flow field + steering seek + volver al carril ----------
  const updateLeaders = leaders ? Fn(() => {
    const i = instanceIndex;
    const sBuf = leaderState.element(i);
    const st = sBuf.toVar();
    const prm = leaderParams.element(i);
    const dt = params.dt.mul(params.timeScale);
    const t = params.time;

    const pos = vec2(st.x, st.y).toVar();
    const vel = vec2(st.z, st.w).toVar();

    // flow field: corriente horizontal del carril + ondulación vertical que depende de x y t
    const wave = sin(pos.x.mul(0.45).add(t.mul(0.4)).add(prm.z)).mul(0.9);
    const lane = prm.x.sub(pos.y).mul(0.8);                  // volver al carril
    const desired = vec2(prm.y, wave.add(lane));
    vel.addAssign(desired.sub(vel).mul(dt.mul(3.0)));        // steering de Reynolds
    pos.addAssign(vel.mul(dt));

    If(pos.x.greaterThan(W), () => { pos.x.assign(pos.x.sub(2 * W)); });
    If(pos.x.lessThan(-W), () => { pos.x.assign(pos.x.add(2 * W)); });

    sBuf.assign(vec4(pos.x, pos.y, vel.x, vel.y));
  })().compute(leaders.nb).setName('Update Leaders') : null;

  const updateParticles = Fn(() => {
    const i = instanceIndex;
    const pBuf = positionBuffer.element(i);
    const vBuf = velocityBuffer.element(i);
    const pos = pBuf.toVar();
    const vel = vBuf.toVar();
    const dt = params.dt.mul(params.timeScale);
    const t = params.time;

    const { target: base, lead } = targetOf(i);

    // bisturí: abre la forma y la retuerce con la intensidad de corte
    const toAh = params.attractor.xy.sub(base.xy);
    const dAh = max(toAh.length(), 0.05);
    const dir = toAh.div(dAh);
    const infl = float(1.0).sub(smoothstep(0.0, params.cutRadius.mul(1.8), dAh));
    const tangent = vec2(dir.y.mul(-1.0), dir.x);
    const off = dir.mul(params.radialStrength).mul(-0.9).add(tangent.mul(params.vortexStrength).mul(0.5)).mul(infl);
    const target = base.add(vec3(off, 0.0));

    // steering ARRIVE (+ alineación con el líder). Con mundo toroidal si hay líderes.
    const toT = target.sub(pos).toVar();
    if (leaders) toT.x.assign(toT.x.sub(round(toT.x.div(2 * W)).mul(2 * W)));
    const d = toT.length();
    const desired = toT.div(max(d, 1e-4)).mul(5.0).mul(d.div(1.2).clamp(0.0, 1.0)).add(lead);
    const steer = desired.sub(vel);

    // flow field (temblor)
    const a = sin(pos.x.mul(0.9).add(t.mul(0.6))).mul(cos(pos.y.mul(0.9).sub(t.mul(0.5)))).mul(6.2832);
    const flow = vec3(cos(a), sin(a), 0.0);

    vel.addAssign(steer.mul(dt.mul(12.0)));
    vel.addAssign(flow.mul(dt.mul(params.flowStrength).mul(4.0)));
    pos.addAssign(vel.mul(dt));

    if (leaders) {   // borde toroidal
      If(pos.x.greaterThan(W), () => { pos.x.assign(pos.x.sub(2 * W)); });
      If(pos.x.lessThan(-W), () => { pos.x.assign(pos.x.add(2 * W)); });
    }

    pBuf.assign(pos);
    vBuf.assign(vel);
  })().compute(count).setName('Update Shape');

  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });
  material.positionNode = positionBuffer.toAttribute();
  material.scaleNode = float(size);
  const { col, alpha } = shade(homeBuffer.toAttribute());
  material.colorNode = vec4(col, 1.0);
  material.opacityNode = step(uv().xy.sub(0.5).length(), 0.5).mul(alpha);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const bladeGeo = new THREE.PlaneGeometry(0.05, 0.9);
  const bladeMat = new THREE.MeshBasicNodeMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.85 });
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.rotation.z = -0.45;
  blade.position.z = 0.1;
  scene.add(blade);

  function reset() { renderer.compute(initParticles); }
  function stepSimulation() {
    blade.position.x = params.attractor.value.x + 0.2;
    blade.position.y = params.attractor.value.y + 0.35;
    onStep?.();
    if (updateLeaders) renderer.compute(updateLeaders);
    renderer.compute(updateParticles);
  }
  function dispose() {
    geometry.dispose(); material.dispose(); bladeGeo.dispose(); bladeMat.dispose();
    scene.remove(mesh); scene.remove(blade);
  }
  function setActive(v) { mesh.visible = v; blade.visible = v; }
  setActive(false);

  return { count, reset, stepSimulation, dispose, setActive };
}

// ---------------------------------------------------------------------
export function createBone({ renderer, scene, params, count = 18000 }) {
  const { home, motion, leaders } = buildBones(count);
  return createShapeSystem({
    renderer, scene, params, count, size: 0.06,
    homes: home, motion, leaders,
    shade: (a) => {
      const e = a.z.clamp(0.0, 1.0);          // borde
      const s = a.w.clamp(0.0, 1.0);          // volumen (1 = centro)
      const body = mix(color('#6f7f99'), color('#f2e9d2'), s);
      return {
        col: mix(body, color('#ffffff'), e),
        alpha: mix(float(0.28).add(s.mul(0.4)), float(0.95), e)
      };
    }
  });
}

export function createNerves({ renderer, scene, params, count = 14000 }) {
  const front = uniform(2.0);     // posición del impulso (0 = raíz, 1 = puntas). >1.4 = apagado

  const sys = createShapeSystem({
    renderer, scene, params, count, size: 0.05,
    homes: buildNerves(count),
    shade: (a) => {
      const w = a.w;
      const dd = w.sub(front);
      const glow = exp(dd.mul(dd).mul(-260.0));
      const tail = step(w, front).mul(exp(front.sub(w).mul(-5.0))).mul(0.35).mul(step(front, 1.4));
      const k = glow.add(tail).clamp(0.0, 1.0);
      return {
        col: mix(color('#d9a441'), color('#ffffff'), k),
        alpha: float(0.42).add(glow.mul(0.55)).add(tail.mul(0.3))
      };
    },
    onStep: () => { front.value += params.dt.value * params.timeScale.value * 0.9; }
  });

  // dispara un impulso nervioso desde la raíz
  sys.fire = () => { front.value = -0.1; };
  return sys;
}