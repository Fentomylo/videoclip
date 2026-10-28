import * as THREE from 'three/webgpu';
import {
  Fn, color, float, hash, instanceIndex, instancedArray, max, mix, sin, cos,
  uint, uv, vec2, vec3, vec4, smoothstep, step
} from 'three/tsl';

// =====================================================================
//  CORAZÓN DE FONDO
//  Cada agente tiene un "puesto" (home) en la silueta del corazón.
//  Percibe: su puesto (escalado por el latido), el flow field y el bisturí.
//  Acción: steering ARRIVE hacia el puesto + temblor de flow field.
//  El latido (params.beat) lo dispara el intérprete: empuja a los agentes
//  hacia afuera (flee) y el arrive los devuelve.
// =====================================================================
const S = 0.3;        // escala del corazón (ocupa casi todo el alto de la pantalla)
const CY = 0.75;      // centro vertical
const K = S / 0.2;    // factor para los vasos, dibujados en unidades de S=0.2
const ZC = -0.4;      // profundidad (detrás de todo)
const BEAT_SOFT = 0.3; // qué tanto reacciona el corazón al latido (1 = como antes, 0 = no late). Sutil: lo importante es lo de adelante

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const heartPt = (t) => {
  const s = Math.sin(t);
  return [16 * s * s * s, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)];
};

const bezier = (p0, p1, p2, p3, u) => {
  const a = 1 - u;
  return [
    a * a * a * p0[0] + 3 * a * a * u * p1[0] + 3 * a * u * u * p2[0] + u * u * u * p3[0],
    a * a * a * p0[1] + 3 * a * a * u * p1[1] + 3 * a * u * u * p2[1] + u * u * u * p3[1]
  ];
};

function buildHeart(count) {
  const rnd = mulberry32(3);
  const data = new Float32Array(count * 4);
  let k = 0;
  const put = (x, y, w) => {
    if (k >= count) return;
    data[k * 4] = x; data[k * 4 + 1] = y; data[k * 4 + 2] = ZC; data[k * 4 + 3] = w;
    k++;
  };

  const nOutline = Math.floor(count * 0.28);
  const nSeptum = Math.floor(count * 0.04);
  const nAorta = Math.floor(count * 0.07);
  const nVessel = Math.floor(count * 0.05);

  // contorno
  for (let i = 0; i < nOutline; i++) {
    const [x, y] = heartPt(rnd() * Math.PI * 2);
    put(x * S + (rnd() - 0.5) * 0.03, y * S + CY + (rnd() - 0.5) * 0.03, 1.0);
  }
  // tabique (línea entre ventrículos)
  for (let i = 0; i < nSeptum; i++) {
    const u = rnd();
    const x = (0.5 + 1.2 * u) * S + Math.sin(u * 3) * 0.1;
    const y = (3.5 - 17.0 * u) * S + CY;
    put(x + (rnd() - 0.5) * 0.04, y, 0.55);
  }
  // aorta
  for (let i = 0; i < nAorta; i++) {
    const [x, y] = bezier([0.1, 1.6], [0.0, 3.4], [1.6, 3.2], [1.8, 2.3], rnd());
    put(x * K + (rnd() - 0.5) * 0.25, (y - 0.55) * K + CY + (rnd() - 0.5) * 0.25, 0.85);
  }
  // vena
  for (let i = 0; i < nVessel; i++) {
    const [x, y] = bezier([-0.7, 2.2], [-0.9, 3.0], [-1.2, 3.3], [-1.9, 3.3], rnd());
    put(x * K + (rnd() - 0.5) * 0.2, (y - 0.55) * K + CY + (rnd() - 0.5) * 0.2, 0.85);
  }
  // relleno
  while (k < count) {
    const [x, y] = heartPt(rnd() * Math.PI * 2);
    const r = Math.sqrt(rnd());
    put(x * r * S, y * r * S + CY, 0.0);
  }
  return data;
}

export function createHeart({ renderer, scene, params, count = 14000 }) {
  const homeBuffer = instancedArray(buildHeart(count), 'vec4');   // xyz = puesto, w = tipo
  const positionBuffer = instancedArray(count, 'vec3');
  const velocityBuffer = instancedArray(count, 'vec3');

  const initParticles = Fn(() => {
    const i = instanceIndex;
    const r1 = hash(i.add(uint(11)));
    const r2 = hash(i.add(uint(23)));
    const home = homeBuffer.element(i).xyz;
    positionBuffer.element(i).assign(vec3(
      home.x.add(r1.sub(0.5).mul(1.5)), home.y.add(r2.sub(0.5).mul(1.5)), home.z
    ));
    velocityBuffer.element(i).assign(vec3(0.0));
  })().compute(count).setName('Initialize Heart');

  const updateParticles = Fn(() => {
    const i = instanceIndex;
    const pBuf = positionBuffer.element(i);
    const vBuf = velocityBuffer.element(i);
    const pos = pBuf.toVar();
    const vel = vBuf.toVar();
    const home = homeBuffer.element(i).xyz;
    const dt = params.dt.mul(params.timeScale);
    const t = params.time;

    // 1) el puesto es fijo; el latido es una fuerza de HUIDA del centro (flee)
    //    que el intérprete dispara. El arrive hace que vuelvan: el rebote es emergente.
    const center = vec3(0.0, CY, ZC);
    const target = home.toVar();

    // 2) el bisturí empuja el puesto (el corazón se deja tocar)
    const toAh = params.attractor.xy.sub(home.xy);
    const dAh = max(toAh.length(), 0.05);
    const dir = toAh.div(dAh);
    const infl = float(1.0).sub(smoothstep(0.0, params.cutRadius.mul(1.8), dAh));
    const off = dir.mul(infl).mul(params.radialStrength).mul(-0.35);
    target.addAssign(vec3(off, 0.0));

    // 3) steering ARRIVE hacia el puesto
    const toT = target.sub(pos);
    const d = toT.length();
    const desired = toT.div(max(d, 1e-4)).mul(6.0).mul(d.clamp(0.0, 1.0));
    const steer = desired.sub(vel);

    // 4) flow field: temblor orgánico
    const a = sin(pos.x.mul(0.8).add(t.mul(0.5))).mul(cos(pos.y.mul(0.8).sub(t.mul(0.4)))).mul(6.2832);
    const flow = vec3(cos(a), sin(a), 0.0);

    const rel = pos.sub(center);
    vel.addAssign(rel.mul(params.beat.mul(params.beatStrength).mul(BEAT_SOFT)).mul(dt.mul(14.0)));   // flee del centro
    vel.addAssign(steer.mul(dt.mul(16.0)));
    vel.addAssign(flow.mul(dt.mul(params.flowStrength).mul(5.0)));
    pos.addAssign(vel.mul(dt));

    pBuf.assign(pos);
    vBuf.assign(vel);
  })().compute(count).setName('Update Heart');

  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });

  const w = homeBuffer.toAttribute().w;
  const b = params.beat.mul(params.beatStrength).mul(BEAT_SOFT).clamp(0.0, 1.5);

  material.positionNode = positionBuffer.toAttribute();
  material.scaleNode = float(0.085).mul(float(1.0).add(b.mul(0.35)));   // los puntos se hinchan con el latido
  material.colorNode = Fn(() => {
    const glowC = float(1.0).sub(positionBuffer.toAttribute().sub(vec3(0.0, CY, ZC)).length().div(5.0)).clamp(0.0, 1.0);
    const k = w.mul(0.5).add(0.22).add(glowC.mul(0.18)).add(b.mul(0.45)).clamp(0.0, 1.0);
    return vec4(mix(color('#4d0010'), color('#ff1a40'), k), 1.0);
  })();
  material.opacityNode = float(1.0).sub(smoothstep(0.1, 0.5, uv().xy.sub(0.5).length()))
    .mul(float(0.26).add(w.mul(0.34)).add(b.mul(0.3)));

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  scene.add(mesh);

  function reset() { renderer.compute(initParticles); }
  function stepSimulation() { renderer.compute(updateParticles); }
  function dispose() { geometry.dispose(); material.dispose(); scene.remove(mesh); }
  function setActive(v) { mesh.visible = v; }

  return { count, reset, stepSimulation, dispose, setActive };
}