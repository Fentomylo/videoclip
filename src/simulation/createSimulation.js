import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, color, float, hash, instanceIndex, instancedArray, max, mix, sin, cos, step, uint, uv,
  vec2, vec3, vec4, round, floor, mod, exp, smoothstep, abs, uniform
} from 'three/tsl';

export function createSimulation({ renderer, scene, params, count = 2048 }) {
  const positionBuffer = instancedArray(count, 'vec3');
  const velocityBuffer = instancedArray(count, 'vec3');

  const BOUNDS_W = 24.0;
  const BOUNDS_H = 13.5;

  const initParticles = Fn(() => {
    const i = instanceIndex;
    const p = positionBuffer.element(i);
    const v = velocityBuffer.element(i);

    const r1 = hash(i.add(uint(11)));
    const r2 = hash(i.add(uint(23)));
    const r3 = hash(i.add(uint(37)));
    const r4 = hash(i.add(uint(53)));
    const r5 = hash(i.add(uint(71)));
    const r6 = hash(i.add(uint(89)));

    p.assign(vec3(r1.sub(0.5).mul(BOUNDS_W), r2.sub(0.5).mul(BOUNDS_H), r3.sub(0.5).mul(2.0)));
    v.assign(vec3(r4, r5, r6).sub(0.5).mul(params.initialSpeed));
  })().compute(count).setName('Initialize Agents');

  const updateParticles = Fn(() => {
    const pBuf = positionBuffer.element(instanceIndex);
    const vBuf = velocityBuffer.element(instanceIndex);

    // Copias locales: lo que el agente "siente" este frame
    const pos = pBuf.toVar();
    const vel = vBuf.toVar();
    const dt = params.dt.mul(params.timeScale);

    const safeNorm = (x) => x.div(max(x.length(), 1e-4));
    // Steering de Reynolds: velocidad deseada - velocidad actual
    const seek = (dir) => safeNorm(dir).mul(params.maxSpeed).sub(vel);

    // ---------- PESOS POR MODO (1 Sutura, 2 Hemorragia, 3 Disección) ----------
    // bioMode es continuo (se interpola en main.js), así que los pesos se mezclan.
    const m = params.bioMode;
    const t12 = m.sub(1.0).clamp(0.0, 1.0);
    const t23 = m.sub(2.0).clamp(0.0, 1.0);
    const pick = (a, b, c) => mix(mix(float(a), float(b), t12), float(c), t23);

    //                       Sutura  Hemorr.  Disec.
    const wCoh    = pick(    1.6,     0.25,    0.15 ).mul(params.cohesionStrength);
    const wAli    = pick(    1.4,     0.40,    2.20 ).mul(params.alignmentStrength);
    const wSep    = pick(    0.8,     0.70,    2.40 );
    const wFlow   = pick(    0.6,     1.00,    2.00 ).mul(params.flowStrength);
    const wRadial = pick(    1.0,    -1.20,    0.40 ).mul(params.radialStrength).mul(params.radialEnabled);
    const wVortex = pick(    0.3,     1.60,    0.00 ).mul(params.vortexStrength).mul(params.vortexEnabled);
    const wDrag   = pick(    1.0,     0.30,    0.60 ).mul(params.dragCoefficient).mul(params.dragEnabled);
    const percep  = pick(    2.2,     1.6,     1.4  ).mul(params.perception);

    // ---------- PERCEPCIÓN: vecindad con wrap toroidal ----------
    const cohSum = vec3(0.0).toVar();
    const aliSum = vec3(0.0).toVar();
    const sepSum = vec3(0.0).toVar();
    const n = float(0.0).toVar();

    Loop(count, ({ i }) => {
      const q = positionBuffer.element(i);
      const d = q.sub(pos).toVar();
      d.x.assign(d.x.sub(round(d.x.div(BOUNDS_W)).mul(BOUNDS_W)));
      d.y.assign(d.y.sub(round(d.y.div(BOUNDS_H)).mul(BOUNDS_H)));
      const dist = d.length();

      If(dist.lessThan(percep).and(dist.greaterThan(0.0001)), () => {
        cohSum.addAssign(d);                           // offset relativo al vecino
        aliSum.addAssign(velocityBuffer.element(i));
        n.addAssign(1.0);
        If(dist.lessThan(params.separationRadius), () => {
          sepSum.subAssign(d.div(dist.mul(dist).add(0.02)));  // empuje inverso a la distancia²
        });
      });
    });

    const hasN = step(0.5, n);
    const invN = float(1.0).div(max(n, 1.0));
    const hasSep = step(0.0001, sepSum.length());

    const cohesion  = seek(cohSum.mul(invN)).mul(hasN);
    const alignment = seek(aliSum.mul(invN)).mul(hasN);
    const separation = seek(sepSum).mul(hasSep);

    // ---------- FLOW FIELD animado (heading, nunca vector cero) ----------
    const t = params.time;
    const a = sin(pos.x.mul(0.30).add(t.mul(0.25))).mul(cos(pos.y.mul(0.30).sub(t.mul(0.18)))).mul(6.2832);
    const flowDir = vec3(cos(a), sin(a), 0.0);
    const flow = seek(flowDir);

    // ---------- BISTURÍ (atractor controlado por el humano) ----------
    const toA = params.attractor.sub(pos);
    const dA = max(toA.length(), params.softening);
    const aDir = toA.div(dA);
    const radial = aDir.mul(wRadial);
    const tangent = vec3(0.0, 0.0, 1.0).cross(aDir);
    const vortex = tangent.mul(wVortex).div(dA.mul(0.25).add(1.0)); // pierde fuerza con la distancia

    // ---------- SUMA DE FUERZAS ----------
    const force = vec3(0.0).toVar();
    force.addAssign(cohesion.mul(wCoh));
    force.addAssign(alignment.mul(wAli));
    force.addAssign(separation.mul(wSep));
    force.addAssign(flow.mul(wFlow));
    force.addAssign(radial);
    force.addAssign(vortex);
    force.addAssign(vel.mul(wDrag).mul(-1.0));
    force.z.subAssign(pos.z.mul(0.8)); // mantiene el enjambre cerca del plano

    // límite de fuerza (steering acotado)
    const fLen = force.length();
    If(fLen.greaterThan(params.maxForce), () => {
      force.assign(force.div(fLen).mul(params.maxForce));
    });

    // ---------- INTEGRACIÓN ----------
    vel.addAssign(force.mul(dt));
    const speed = vel.length();
    If(speed.greaterThan(params.maxSpeed), () => {
      vel.assign(vel.div(speed).mul(params.maxSpeed));
    });
    pos.addAssign(vel.mul(dt));

    const halfW = BOUNDS_W * 0.5;
    const halfH = BOUNDS_H * 0.5;
    If(pos.x.greaterThan(halfW), () => { pos.x.assign(pos.x.sub(BOUNDS_W)); });
    If(pos.x.lessThan(-halfW), () => { pos.x.assign(pos.x.add(BOUNDS_W)); });
    If(pos.y.greaterThan(halfH), () => { pos.y.assign(pos.y.sub(BOUNDS_H)); });
    If(pos.y.lessThan(-halfH), () => { pos.y.assign(pos.y.add(BOUNDS_H)); });

    pBuf.assign(pos);
    vBuf.assign(vel);
  })().compute(count).setName('Update Agent Behaviors');

  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });

  material.positionNode = positionBuffer.toAttribute();
  material.scaleNode = params.particleSize;

  material.colorNode = Fn(() => {
    const speed = velocityBuffer.toAttribute().length();
    const t = speed.div(params.maxSpeed).clamp(0.0, 1.0);
    const slow = color('#ff1a40');
    const fast = color('#ffffff');
    return vec4(mix(slow, fast, t), 1.0);
  })();

  material.opacityNode = step(uv().xy.sub(0.5).length(), 0.5).mul(0.8);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  scene.add(mesh);

  function reset() { renderer.compute(initParticles); }
  function stepSimulation() { renderer.compute(updateParticles); }
  function dispose() { geometry.dispose(); material.dispose(); scene.remove(mesh); }

  function setActive(v) { mesh.visible = v; }

  return { count, positionBuffer, velocityBuffer, reset, stepSimulation, dispose, setActive };
}

// =====================================================================
//  MODO 5 · PHYSARUM (red de venas)
//  Cada agente: huele el rastro con 3 sensores (izq / frente / der),
//  gira hacia donde hay más rastro, avanza y deja rastro.
//  El rastro se difunde y se evapora → emergen venas que se rompen y se curan.
// =====================================================================
export function createPhysarum({ renderer, scene, params, count = 32768 }) {
  const GW = 320;
  const GH = 180;
  const PW = 17.0;
  const PH = PW * GH / GW;
  const CELL = PW / GW;
  const SPEED = 2.4;            // unidades de mundo / segundo

  const agentPos = instancedArray(count, 'vec2');
  const agentAng = instancedArray(count, 'float');
  const trail = instancedArray(GW * GH, 'float');
  const trailTmp = instancedArray(GW * GH, 'float');
  const timeU = uniform(0.0);

  // posición del mundo -> índice de celda (con wrap toroidal)
  const cellOf = (p) => {
    const gx = mod(floor(p.x.div(PW).add(0.5).mul(GW)).add(GW), float(GW));
    const gy = mod(floor(p.y.div(PH).add(0.5).mul(GH)).add(GH), float(GH));
    return uint(gy.mul(GW).add(gx));
  };

  // ---------- INICIALIZACIÓN ----------
  const initAgents = Fn(() => {
    const i = instanceIndex;
    const r1 = hash(i.add(uint(11)));
    const r2 = hash(i.add(uint(23)));
    const r3 = hash(i.add(uint(37)));
    agentPos.element(i).assign(vec2(r1.sub(0.5).mul(PW), r2.sub(0.5).mul(PH)));
    agentAng.element(i).assign(r3.mul(6.2832));
  })().compute(count).setName('Initialize Physarum');

  const clearTrail = Fn(() => {
    trail.element(instanceIndex).assign(0.0);
    trailTmp.element(instanceIndex).assign(0.0);
  })().compute(GW * GH).setName('Clear Trail');

  // ---------- AGENTES: sentir -> girar -> avanzar -> depositar ----------
  const stepAgents = Fn(() => {
    const i = instanceIndex;
    const pBuf = agentPos.element(i);
    const aBuf = agentAng.element(i);
    const pos = pBuf.toVar();
    const ang = aBuf.toVar();
    const dt = params.dt.mul(params.timeScale);

    const seed = i.add(uint(timeU.mul(60.0)).mul(uint(9781)));
    const rnd = hash(seed);
    const rnd2 = hash(seed.add(uint(7)));

    // 3 sensores
    const sense = (a) => trail.element(cellOf(pos.add(vec2(cos(a), sin(a)).mul(params.sensorDist))));
    const wF = sense(ang).toVar();
    const wL = sense(ang.add(params.sensorAngle)).toVar();
    const wR = sense(ang.sub(params.sensorAngle)).toVar();

    const turn = params.turnRate.mul(dt);
    const steer = float(0.0).toVar();
    If(wF.lessThan(wL).and(wF.lessThan(wR)), () => {
      steer.assign(rnd.sub(0.5).mul(2.0).mul(turn));          // frente es lo peor: decide al azar
    }).ElseIf(wL.greaterThan(wR).and(wL.greaterThan(wF)), () => {
      steer.assign(turn);                                     // más rastro a la izquierda
    }).ElseIf(wR.greaterThan(wL).and(wR.greaterThan(wF)), () => {
      steer.assign(turn.mul(-1.0));                            // más rastro a la derecha
    });
    ang.addAssign(steer);
    ang.addAssign(rnd2.sub(0.5).mul(2.0).mul(params.turnRate).mul(0.15).mul(dt));   // temblor mínimo

    // BISTURÍ: atrae (+) o repele (-) a los agentes cercanos (steering seek / flee)
    const h = vec2(cos(ang), sin(ang));
    const toA = params.attractor.xy.sub(pos);
    const dA = max(toA.length(), 0.05);
    const d = toA.div(dA);
    const crossZ = h.x.mul(d.y).sub(h.y.mul(d.x));
    const infl = float(1.0).sub(smoothstep(0.0, 4.5, dA));
    ang.addAssign(crossZ.mul(params.radialStrength).mul(infl).mul(dt).mul(3.0));

    // avanzar
    pos.addAssign(vec2(cos(ang), sin(ang)).mul(dt.mul(SPEED)));
    pos.x.assign(mod(pos.x.add(PW * 1.5), PW).sub(PW * 0.5));
    pos.y.assign(mod(pos.y.add(PH * 1.5), PH).sub(PH * 0.5));

    // depositar rastro
    trail.element(cellOf(pos)).addAssign(dt.mul(10.0));

    pBuf.assign(pos);
    aBuf.assign(ang);
  })().compute(count).setName('Update Physarum Agents');

  // ---------- RASTRO: difundir + evaporar + bisturí ----------
  const diffuse = Fn(() => {
    const i = instanceIndex;
    const fi = float(i);
    const cy = floor(fi.div(GW));
    const cx = fi.sub(cy.mul(GW));
    const dt = params.dt.mul(params.timeScale);

    const at = (ox, oy) => trail.element(uint(
      mod(cy.add(oy + GH), float(GH)).mul(GW).add(mod(cx.add(ox + GW), float(GW)))
    ));

    let sum = float(0.0);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) sum = sum.add(at(ox, oy));
    }
    const blur = sum.div(9.0);
    const blended = mix(at(0, 0), blur, 0.65);
    const decay = max(float(1.0).sub(params.evaporation.mul(dt)), 0.0);

    // posición de la celda en el mundo
    const wx = cx.add(0.5).div(GW).sub(0.5).mul(PW);
    const wy = cy.add(0.5).div(GH).sub(0.5).mul(PH);
    const dA = vec2(wx, wy).sub(params.attractor.xy).length();

    // Intensidad de Corte: el bisturí borra el rastro a su alrededor (rompe las venas)
    const cutAmt = abs(params.vortexStrength).div(3.0).clamp(0.0, 1.0);
    const cutZone = float(1.0).sub(smoothstep(0.0, params.cutRadius, dA));
    const keep = float(1.0).sub(cutAmt.mul(cutZone));

    // Fuerza del Bisturí > 0: además funciona como "comida" (fuente de rastro)
    const food = max(params.radialStrength, 0.0)
      .mul(float(1.0).sub(smoothstep(0.0, 0.5, dA)))
      .mul(dt.mul(30.0));

    trailTmp.element(i).assign(blended.mul(decay).mul(keep).add(food));
  })().compute(GW * GH).setName('Diffuse Trail');

  const copyTrail = Fn(() => {
    trail.element(instanceIndex).assign(trailTmp.element(instanceIndex));
  })().compute(GW * GH).setName('Copy Trail');

  // ---------- RENDER: una celda = un sprite suave ----------
  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });

  const v = trail.toAttribute();
  const energy = float(1.0).sub(exp(v.mul(-0.1)));

  material.positionNode = Fn(() => {
    const fi = float(instanceIndex);
    const cy = floor(fi.div(GW));
    const cx = fi.sub(cy.mul(GW));
    return vec3(
      cx.add(0.5).div(GW).sub(0.5).mul(PW),
      cy.add(0.5).div(GH).sub(0.5).mul(PH),
      0.0
    );
  })();
  material.scaleNode = float(CELL * 1.7);

  material.colorNode = Fn(() => {
    const lo = color('#3a0010');
    const mid = color('#ff1a40');
    const hi = color('#ffffff');
    const c = mix(mix(lo, mid, smoothstep(0.0, 0.5, energy)), hi, smoothstep(0.6, 1.0, energy));
    return vec4(c, 1.0);
  })();
  material.opacityNode = float(1.0).sub(smoothstep(0.0, 0.5, uv().xy.sub(0.5).length())).mul(energy);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, GW * GH);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Hoja del bisturí (marcador visual)
  const bladeGeo = new THREE.PlaneGeometry(0.05, 0.9);
  const bladeMat = new THREE.MeshBasicNodeMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.85 });
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.rotation.z = -0.45;
  blade.position.z = 0.1;
  scene.add(blade);

  function reset() {
    renderer.compute(clearTrail);
    renderer.compute(initAgents);
  }
  function stepSimulation() {
    timeU.value += params.dt.value * params.timeScale.value;
    blade.position.x = params.attractor.value.x + 0.2;
    blade.position.y = params.attractor.value.y + 0.35;
    renderer.compute(stepAgents);
    renderer.compute(diffuse);
    renderer.compute(copyTrail);
  }
  function dispose() {
    geometry.dispose(); material.dispose();
    bladeGeo.dispose(); bladeMat.dispose();
    scene.remove(mesh); scene.remove(blade);
  }
  function setActive(v) { mesh.visible = v; blade.visible = v; }
  setActive(false);

  return { count, reset, stepSimulation, dispose, setActive };
}