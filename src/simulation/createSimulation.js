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

    // ---------- PESOS DE LA HEMORRAGIA (flocking + vórtice) ----------
    // Cohesión baja y alineación media: el enjambre se dispersa, pero el bisturí
    // lo repele (radial negativo) y lo hace girar (vórtice).
    const wCoh    = float(0.25).mul(params.cohesionStrength);
    const wAli    = float(0.40).mul(params.alignmentStrength);
    const wSep    = float(0.70);
    const wFlow   = float(1.00).mul(params.flowStrength);
    const wRadial = float(-1.20).mul(params.radialStrength).mul(params.radialEnabled);
    const wVortex = float(1.60).mul(params.vortexStrength).mul(params.vortexEnabled);
    const wDrag   = float(0.30).mul(params.dragCoefficient).mul(params.dragEnabled);
    const percep  = float(1.6).mul(params.perception);

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

  // sprite suave: núcleo brillante + halo (con blending aditivo se funde en un resplandor)
  material.opacityNode = float(1.0).sub(smoothstep(0.1, 0.5, uv().xy.sub(0.5).length())).mul(0.9);

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
//  PHYSARUM (red de venas) · CAPA DE FONDO que se activa/desactiva con la tecla 5
//  (no es un modo: convive con cualquiera de los modos 1-4, como el corazón).
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
  const SPEED = 3.2;            // unidades de mundo / segundo (más rápido = venas más vivas)
  const HEART = [0.0, 0.75];    // centro del corazón de fondo: de ahí sale la onda del latido

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
    // las ramas "respiran": el ángulo de los sensores oscila lento, así la red nunca se congela
    const breathe = params.sensorAngle.mul(float(1.0).add(sin(timeU.mul(0.7)).mul(0.18)));
    const wF = sense(ang).toVar();
    const wL = sense(ang.add(breathe)).toVar();
    const wR = sense(ang.sub(breathe)).toVar();

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
    // G (crecer) atrae a los agentes con fuerza, H (cortar) los ahuyenta
    const pull = params.radialStrength.add(params.veinGrow.mul(4.0)).sub(params.veinCut.mul(4.0));
    ang.addAssign(crossZ.mul(pull).mul(infl).mul(dt).mul(3.0));

    // avanzar
    pos.addAssign(vec2(cos(ang), sin(ang)).mul(dt.mul(SPEED)));
    pos.x.assign(mod(pos.x.add(PW * 1.5), PW).sub(PW * 0.5));
    pos.y.assign(mod(pos.y.add(PH * 1.5), PH).sub(PH * 0.5));

    // depositar rastro
    // con cada latido las venas depositan más: se hinchan y se encienden
    trail.element(cellOf(pos)).addAssign(dt.mul(10.0).mul(float(1.0).add(params.beat.clamp(0.0, 1.5).mul(1.5))));

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
    // la evaporación también oscila: la red se contrae y se expande como si respirara
    const evap = params.evaporation.mul(float(1.0).add(sin(timeU.mul(0.5)).mul(0.3)));
    const decay = max(float(1.0).sub(evap.mul(dt)), 0.0);

    // posición de la celda en el mundo
    const wx = cx.add(0.5).div(GW).sub(0.5).mul(PW);
    const wy = cy.add(0.5).div(GH).sub(0.5).mul(PH);
    const dA = vec2(wx, wy).sub(params.attractor.xy).length();

    // Intensidad de Corte: el bisturí borra el rastro a su alrededor (rompe las venas)
    // (H sostenida = corte total)
    const cutAmt = max(abs(params.vortexStrength).div(3.0).clamp(0.0, 1.0), params.veinCut);
    const cutZone = float(1.0).sub(smoothstep(0.0, params.cutRadius, dA));
    const keep = float(1.0).sub(cutAmt.mul(cutZone));

    // Fuerza del Bisturí > 0: además funciona como "comida" (fuente de rastro)
    const food = max(params.radialStrength, 0.0)
      .mul(float(1.0).sub(smoothstep(0.0, 0.5, dA)))
      .mul(dt.mul(30.0));

    // G sostenida: el bisturí siembra rastro en una zona ancha → brotan venas nuevas
    const grow = params.veinGrow
      .mul(float(1.0).sub(smoothstep(0.0, params.cutRadius, dA)))
      .mul(dt.mul(90.0));

    // Latido: una onda de rastro sale del corazón y recorre toda la red
    const dH = vec2(wx, wy).sub(vec2(HEART[0], HEART[1])).length();
    const ringD = dH.sub(params.veinWave);
    const wave = exp(ringD.mul(ringD).mul(-2.5))
      .mul(step(0.0, params.veinWave))
      .mul(dt.mul(60.0));

    trailTmp.element(i).assign(blended.mul(decay).mul(keep).add(food).add(grow).add(wave));
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
  const beatGlow = params.beat.clamp(0.0, 1.5);
  // más sensible que antes (las venas se ven antes) + se enciende con el latido
  const energy = float(1.0).sub(exp(v.mul(-0.16))).add(beatGlow.mul(0.12)).clamp(0.0, 1.0);

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
  material.scaleNode = float(CELL * 2.3);      // sprites más grandes: venas más gruesas y continuas

  // brillo que "corre" por la red: parpadeo lento distinto en cada celda (como sangre circulando)
  const shimmer = Fn(() => {
    const fi = float(instanceIndex);
    return sin(timeU.mul(2.5).add(fi.mul(0.013))).mul(0.5).add(0.5);
  })();

  material.colorNode = Fn(() => {
    const lo = color('#4a0010');
    const mid = color('#ff1a40');
    const hi = color('#ffd6dc');
    const c = mix(mix(lo, mid, smoothstep(0.0, 0.45, energy)), hi, smoothstep(0.55, 1.0, energy));
    return vec4(c.mul(float(0.8).add(shimmer.mul(0.35))), 1.0);
  })();
  // es fondo: algo más tenue que los modos, pero más vivo que antes
  material.opacityNode = float(1.0).sub(smoothstep(0.0, 0.5, uv().xy.sub(0.5).length()))
    .mul(energy).mul(float(0.75).add(shimmer.mul(0.25)));

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, GW * GH);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;          // detrás del corazón (-1) y de los modos
  scene.add(mesh);

  function reset() {
    renderer.compute(clearTrail);
    renderer.compute(initAgents);
  }
  function stepSimulation() {
    timeU.value += params.dt.value * params.timeScale.value;
    renderer.compute(stepAgents);
    renderer.compute(diffuse);
    renderer.compute(copyTrail);
  }
  function dispose() {
    geometry.dispose(); material.dispose();
    scene.remove(mesh);
  }
  function setActive(v) { mesh.visible = v; }
  setActive(false);

  return { count, reset, stepSimulation, dispose, setActive };
}