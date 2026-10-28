import * as THREE from 'three/webgpu';
import {
  Fn, float, instanceIndex, instancedArray, max, mix, sin, cos, fract,
  smoothstep, step, uniform, uv, vec2, vec3, vec4
} from 'three/tsl';

// =====================================================================
//  FLORES (tecla 6) — mismo patrón que el corazón:
//  la forma de cada flor se calcula en JS (puestos "home") y la GPU solo
//  mueve a los agentes con steering ARRIVE hacia su puesto.
//
//  Cada flor tiene un ciclo: brota el tallo -> salen las hojas -> el capullo
//  se abre girando -> se deshace y vuelve a nacer.
//
//  homeBuffer   (vec4): xy = desplazamiento desde su ancla, z = umbral de
//                       crecimiento, w = tipo*10 + tamaño (tipo 1 = cabeza)
//  flowerBuffer (vec4): xy = base de la flor, zw = punta del tallo
//  colorBuffer  (vec4): rgb = color, a = desfase del ciclo de la flor
//  positionBuffer(vec4): xyz = posición, w = escala visible
// =====================================================================
const FLOWERS = 9;
const BASE_Y = -4.5;
const TAU = Math.PI * 2;
const CYCLE_RATE = 0.018;   // ciclos por segundo: 0.018 ≈ 55 s por flor (baja para más lento)

// colores acordes al proyecto: rojo sangre / carmesí / rosa, con un tono hueso
const PALETTE = [
  [1.0, 0.10, 0.25],   // rojo sangre (el del bisturí y el corazón)
  [0.85, 0.05, 0.20],  // carmesí
  [1.0, 0.28, 0.45],   // rosa intenso
  [0.62, 0.05, 0.24],  // vino
  [1.0, 0.16, 0.34],   // rojo vivo
  [0.92, 0.72, 0.76],  // rosa hueso
  [0.78, 0.08, 0.32]   // frambuesa
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

function buildFlowers(count) {
  const rnd = mulberry32(21);
  const home = new Float32Array(count * 4);
  const flower = new Float32Array(count * 4);
  const color = new Float32Array(count * 4);
  let k = 0;

  const per = Math.floor(count / FLOWERS);
  const order = [...Array(PALETTE.length).keys()].sort(() => rnd() - 0.5);

  for (let f = 0; f < FLOWERS; f++) {
    const cx = -7.2 + f * 1.8 + (rnd() - 0.5) * 0.7;
    const H = 2.8 + rnd() * 2.8;
    const R = 0.85 + rnd() * 0.6;
    const np = 5 + Math.floor(rnd() * 5);
    const pal = PALETTE[order[f % PALETTE.length]];
    const phase = (f / FLOWERS) * 0.14 + rnd() * 0.02;   // todas empiezan de semilla, escalonadas
    const rot0 = rnd() * TAU;

    const stemX = (s) => cx + Math.sin(s * 2.4 + f * 1.7) * 0.35 * s;
    const tipX = stemX(1), tipY = BASE_Y + H;

    const nStem = Math.floor(per * 0.22);
    const nLeaf = Math.floor(per * 0.09);
    const nCenter = Math.floor(per * 0.07);
    const nPetal = per - nStem - nLeaf - nCenter;

    const put = (ox, oy, thr, head, size, r, g, b) => {
      if (k >= count) return;
      home.set([ox, oy, thr, head * 10 + size], k * 4);
      flower.set([cx, BASE_Y, tipX, tipY], k * 4);
      color.set([r, g, b, phase], k * 4);
      k++;
    };

    // tallo (verde)
    for (let n = 0; n < nStem; n++) {
      const s = rnd();
      const m = rnd();
      put(stemX(s) - cx + (rnd() - 0.5) * 0.05, s * H, s * 0.9, 0, 0.3,
        lerp(0.14, 0.38, s), lerp(0.34, 0.58, s), lerp(0.24, 0.28, s) * (0.92 + m * 0.08));
    }
    // hojas (una a cada lado)
    for (let n = 0; n < nLeaf; n++) {
      const left = rnd() < 0.5;
      const s0 = left ? 0.3 : 0.55;
      const dirn = left ? -1 : 1;
      const a = rnd(), b = rnd() * 2 - 1;
      const l = a * 1.1;
      const w = Math.sin(a * Math.PI) * 0.22 * b;
      const ax = dirn * Math.cos(0.55), ay = Math.sin(0.55);
      const x = stemX(s0) + ax * l - ay * w;
      const y = BASE_Y + s0 * H + ay * l + ax * w - l * l * 0.2;
      put(x - cx, y - BASE_Y, s0 * 0.9 + a * 0.1, 0, 0.32,
        lerp(0.12, 0.32, a), lerp(0.30, 0.50, a), lerp(0.20, 0.22, a));
    }
    // pétalos (dos capas), relativos a la punta del tallo
    for (let n = 0; n < nPetal; n++) {
      const layer = rnd() < 0.5 ? 0 : 1;
      const pIdx = Math.floor(rnd() * np);
      const phi = (pIdx / np + layer * 0.5 / np) * TAU + rot0;
      const Lp = R * (layer ? 0.6 : 1.0);
      const a = rnd();
      const l = a * Lp;
      const wd = Math.sin(Math.pow(a, 0.7) * Math.PI) * Lp * 0.32 * (rnd() * 2 - 1);
      const ox = Math.cos(phi) * l - Math.sin(phi) * wd;
      const oy = Math.sin(phi) * l + Math.cos(phi) * wd;
      // degradé hacia la punta + capa interior más clara
      const shade = 0.55 + 0.45 * a;
      const lit = layer * 0.08 + a * a * 0.18;
      put(ox, oy, a * 0.35, 1, 0.5,
        lerp(pal[0] * shade, 1.0, lit), lerp(pal[1] * shade, 0.7, lit), lerp(pal[2] * shade, 0.75, lit));
    }
    // centro (espiral de semillas doradas)
    for (let n = 0; n < nCenter; n++) {
      const ang = Math.floor(rnd() * 400) * 2.39996;
      const rad = Math.sqrt(rnd()) * 0.2 * R;
      const m = rnd();
      put(Math.cos(ang) * rad, Math.sin(ang) * rad, 0.0, 1, 0.35,
        lerp(0.2, 0.55, m), lerp(0.02, 0.05, m), lerp(0.05, 0.1, m));
    }
  }
  // por si sobran partículas por redondeo: se esconden en la base sin crecer
  while (k < count) {
    home.set([0, 0, 2.0, 0.3], k * 4);
    flower.set([0, BASE_Y, 0, BASE_Y], k * 4);
    color.set([0, 0, 0, 0], k * 4);
    k++;
  }
  return { home, flower, color };
}

export function createFlowers({ renderer, scene, params, count = 16000 }) {
  const data = buildFlowers(count);
  const homeBuffer = instancedArray(data.home, 'vec4');
  const flowerBuffer = instancedArray(data.flower, 'vec4');
  const colorBuffer = instancedArray(data.color, 'vec4');
  const positionBuffer = instancedArray(count, 'vec4');
  const velocityBuffer = instancedArray(count, 'vec3');

  const clockU = uniform(0.0);   // reloj de crecimiento (G lo acelera)

  const initParticles = Fn(() => {
    const i = instanceIndex;
    const B = flowerBuffer.element(i);
    positionBuffer.element(i).assign(vec4(B.x, B.y, 0.0, 0.0));
    velocityBuffer.element(i).assign(vec3(0.0));
  })().compute(count).setName('Initialize Flowers');

  const updateParticles = Fn(() => {
    const i = instanceIndex;
    const A = homeBuffer.element(i);
    const B = flowerBuffer.element(i);
    const C = colorBuffer.element(i);
    const pBuf = positionBuffer.element(i);
    const vBuf = velocityBuffer.element(i);

    const t = params.time;
    const dt = params.dt.mul(params.timeScale);

    // ciclo de vida de esta flor (0..1)
    const ph = fract(clockU.mul(CYCLE_RATE).add(C.w)).toVar();
    const gStem = smoothstep(0.02, 0.40, ph).toVar();
    const gHead = smoothstep(0.34, 0.72, ph).toVar();
    const vis = smoothstep(0.0, 0.06, ph).mul(float(1.0).sub(smoothstep(0.88, 1.0, ph))).toVar();

    const isHead = step(5.0, A.w).toVar();
    const size = A.w.sub(isHead.mul(10.0));
    const thr = A.z;

    // crecimiento de esta partícula: tallo/hojas siguen al tallo, la cabeza al capullo
    const gS = smoothstep(thr, thr.add(0.16), gStem);
    const gH = smoothstep(thr, thr.add(0.25), gHead);
    const g = mix(gS, gH, isHead).toVar();

    // ancla: la base de la flor (tallo/hojas) o la punta actual del tallo (cabeza)
    const base = vec2(B.x, B.y);
    const tipCur = base.add(vec2(B.z, B.w).sub(base).mul(gStem));
    const anchor = mix(base, tipCur, isHead);

    // el capullo se abre girando
    const ang = float(1.0).sub(g).mul(1.6).mul(isHead);
    const ca = cos(ang);
    const sa = sin(ang);
    const off = vec2(A.x.mul(ca).sub(A.y.mul(sa)), A.x.mul(sa).add(A.y.mul(ca)));

    // el latido hace "respirar" la cabeza
    const breath = float(1.0).add(params.beat.mul(params.beatStrength).mul(0.2).mul(isHead));
    const tgt = anchor.add(off.mul(g).mul(breath)).toVar();

    // viento: se mecen más cuanto más arriba
    const sway = sin(t.mul(0.9).add(tgt.y.mul(0.6)).add(C.w.mul(6.2832))).mul(0.02).mul(max(tgt.y.sub(B.y), 0.0));
    tgt.x.addAssign(sway);

    // el bisturí empuja y mece las flores
    const toA = params.attractor.xy.sub(tgt);
    const dA = max(toA.length(), 0.05);
    const infl = float(1.0).sub(smoothstep(0.0, params.cutRadius.mul(1.6), dA));
    tgt.addAssign(toA.div(dA).mul(infl).mul(params.radialStrength).mul(-0.5));

    // steering suave hacia el puesto + temblor de flow field
    const pos = pBuf.xyz.toVar();
    const vel = vBuf.toVar();
    const target3 = vec3(tgt, 0.0);
    vel.assign(mix(vel, target3.sub(pos).mul(6.0), dt.mul(7.0).clamp(0.0, 1.0)));
    const jit = vec3(
      sin(pos.y.mul(3.0).add(t.mul(2.0))),
      cos(pos.x.mul(3.0).add(t.mul(1.7))),
      0.0
    ).mul(params.flowStrength).mul(0.25);
    pos.addAssign(vel.add(jit).mul(dt));

    const scale = vis.mul(smoothstep(0.0, 0.08, g)).mul(size);
    pBuf.assign(vec4(pos, scale));
    vBuf.assign(vel);
  })().compute(count).setName('Update Flowers');

  // ---------- RENDER ----------
  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.NormalBlending,
    depthWrite: false,
    transparent: true
  });

  const pA = positionBuffer.toAttribute();
  material.positionNode = pA.xyz;
  material.scaleNode = params.particleSize.mul(1.1).mul(pA.w);
  material.colorNode = vec4(colorBuffer.toAttribute().xyz, 1.0);
  material.opacityNode = float(1.0).sub(smoothstep(0.1, 0.5, uv().xy.sub(0.5).length())).mul(0.95);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  scene.add(mesh);

  function reset() { renderer.compute(initParticles); }
  function stepSimulation() {
    // G (mantenida) acelera el crecimiento de todas las flores
    clockU.value += params.dt.value * params.timeScale.value * (1.0 + params.veinGrow.value * 3.0);
    renderer.compute(updateParticles);
  }
  function dispose() { geometry.dispose(); material.dispose(); scene.remove(mesh); }
  let wasActive = false;
  function setActive(v) {
    mesh.visible = v;
    if (v && !wasActive) { clockU.value = 0; renderer.compute(initParticles); }   // empieza de semilla
    wasActive = v;
  }
  setActive(false);

  return { count, positionBuffer, velocityBuffer, reset, stepSimulation, dispose, setActive };
}