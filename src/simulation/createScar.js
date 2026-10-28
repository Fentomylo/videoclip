import * as THREE from 'three/webgpu';
import {
  Fn, If, color, float, hash, instanceIndex, instancedArray, max, mix, sin,
  step, uint, uniform, uv, vec2, vec3, vec4, floor, sign, abs, smoothstep
} from 'three/tsl';

// ---------- Geometría de la cicatriz (sacada del boceto) ----------
export const LINE_COUNT = 700;                 // partículas de la línea principal
const PER_STITCH = 110;                        // partículas por puntada
const N_STITCH = 6;
export const SCAR_COUNT = LINE_COUNT + PER_STITCH * N_STITCH;   // 1360

const SCAR_TOP = 3.8;                          // y superior de la cicatriz
const SCAR_H = 7.6;                            // alto total

// Posición de cada puntada a lo largo de la cicatriz (0 = arriba, 1 = abajo)
const STITCH_T = [0.10, 0.256, 0.437, 0.60, 0.75, 0.924];
// Cuánto se extiende cada puntada a izquierda / derecha de la línea
const STITCH_L = [0.78, 0.54, 0.36, 0.26, 0.65, 0.54];
const STITCH_R = [0.74, 0.91, 0.58, 0.60, 0.72, 0.44];
// Inclinación (dy/dx) de cada puntada
const STITCH_SLOPE = [-0.03, -0.04, 0.05, 0.24, 0.17, 0.02];

// x de la línea en función de y (curva suave en S, igual al dibujo)
const curveX = (y) =>
  smoothstep(0.2, 1.0, float(SCAR_TOP).sub(y).div(SCAR_H).clamp(0.0, 1.0)).sub(0.5);

// Tabla de consulta: devuelve arr[idx] con idx como nodo float
const lut = (arr, idx) => {
  let n = float(arr[0]);
  for (let k = 1; k < arr.length; k++) n = mix(n, float(arr[k]), step(float(k) - 0.5, idx));
  return n;
};

export function createScar({ renderer, scene, params, count = 3400 }) {
  const positionBuffer = instancedArray(count, 'vec3');
  const velocityBuffer = instancedArray(count, 'vec3');
  const homeBuffer = instancedArray(count, 'vec3');
  // x: apertura (cicatriz) o vida restante (sangre) · y: vida máxima · z: 0 cicatriz, 1 sangre
  const stateBuffer = instancedArray(count, 'vec3');

  const timeU = uniform(0.0);

  // ---------- INICIALIZACIÓN ----------
  const initParticles = Fn(() => {
    const i = instanceIndex;
    const fi = float(i);
    const r1 = hash(i.add(uint(11)));
    const r2 = hash(i.add(uint(23)));

    const home = vec3(0.0).toVar();
    const st = vec3(0.0).toVar();

    If(fi.lessThan(LINE_COUNT), () => {
      // línea principal
      const t = fi.add(r1).div(LINE_COUNT);
      const y = float(SCAR_TOP).sub(t.mul(SCAR_H));
      home.assign(vec3(curveX(y).add(r2.sub(0.5).mul(0.02)), y, 0.0));
    }).ElseIf(fi.lessThan(SCAR_COUNT), () => {
      // puntadas
      const j = fi.sub(LINE_COUNT);
      const sid = floor(j.div(PER_STITCH));
      const k = j.sub(sid.mul(PER_STITCH));
      const u = k.add(r1).div(PER_STITCH);
      const yc = float(SCAR_TOP).sub(lut(STITCH_T, sid).mul(SCAR_H));
      const xc = curveX(yc);
      const x = xc.add(mix(lut(STITCH_L, sid).mul(-1.0), lut(STITCH_R, sid), u));
      const y = yc.add(lut(STITCH_SLOPE, sid).mul(x.sub(xc))).add(r2.sub(0.5).mul(0.02));
      home.assign(vec3(x, y, 0.0));
    }).Else(() => {
      // pool de sangre: empieza "muerta" (invisible)
      home.assign(vec3(0.0, -20.0, 0.0));
      st.z.assign(1.0);
    });

    positionBuffer.element(i).assign(home);
    homeBuffer.element(i).assign(home);
    velocityBuffer.element(i).assign(vec3(0.0));
    stateBuffer.element(i).assign(st);
  })().compute(count).setName('Initialize Scar');

  // ---------- ACTUALIZACIÓN ----------
  const updateParticles = Fn(() => {
    const i = instanceIndex;
    const pBuf = positionBuffer.element(i);
    const vBuf = velocityBuffer.element(i);
    const sBuf = stateBuffer.element(i);

    const pos = pBuf.toVar();
    const vel = vBuf.toVar();
    const home = homeBuffer.element(i).toVar();
    const st = sBuf.toVar();

    const dt = params.dt.mul(params.timeScale);
    const att = params.attractor;
    const t = timeU;

    // Comportamiento de la herida (se ajusta desde el panel)
    const gapeMode  = params.gape.mul(0.6);
    const healMode  = params.healRate.mul(0.8);
    const bleedMode = params.bleedRate.mul(1.4);

    const seed = i.add(uint(t.mul(60.0)).mul(uint(9781)));
    const r1 = hash(seed);
    const r2 = hash(seed.add(uint(101)));
    const r3 = hash(seed.add(uint(211)));
    const r4 = hash(seed.add(uint(307)));
    const r5 = hash(seed.add(uint(401)));
    const r6 = hash(seed.add(uint(503)));

    If(st.z.lessThan(0.5), () => {
      // ================= CICATRIZ =================
      const dx = home.x.sub(curveX(home.y));
      const randSide = step(0.5, hash(i.add(uint(5)))).mul(2.0).sub(1.0);
      const side = mix(randSide, sign(dx), step(0.03, abs(dx)));
      const varK = hash(i.add(uint(13))).mul(0.8).add(0.6);   // labios irregulares

      // cercanía del bisturí (zona un poco alargada a lo largo de la cicatriz)
      const dA = vec2(att.x.sub(home.x), att.y.sub(home.y).mul(0.6)).length();
      const infl = float(1.0).sub(smoothstep(0.0, params.cutRadius, dA));

      const open = st.x;
      const rate = mix(healMode, float(14.0), step(open, infl));   // abre rápido, cierra lento
      const newOpen = open.add(infl.sub(open).mul(rate.mul(dt).clamp(0.0, 1.0))).toVar();
      st.x.assign(newOpen);

      const wobble = sin(t.mul(4.0).add(home.y.mul(7.0))).mul(0.04).mul(newOpen);
      const target = home.add(vec3(side.mul(newOpen).mul(gapeMode).mul(varK), wobble, 0.0));

      // steering ARRIVE hacia su puesto (los labios se abren y vuelven a cerrar)
      const toT = target.sub(pos);
      const dd = toT.length();
      const desired = toT.div(max(dd, 1e-4)).mul(5.0).mul(dd.div(0.8).clamp(0.0, 1.0));
      vel.addAssign(desired.sub(vel).mul(dt.mul(14.0)));
      pos.addAssign(vel.mul(dt));
    }).Else(() => {
      // ================= SANGRE =================
      const life = st.x.toVar();

      If(life.greaterThan(0.0), () => {
        // la sangre sigue un FLOW FIELD que cae (steering hacia la velocidad del campo)
        const fieldDir = vec3(sin(pos.y.mul(0.9).add(t.mul(1.3)).add(pos.x.mul(0.5))).mul(0.9), params.gravity.mul(-1.0), 0.0);
        vel.addAssign(fieldDir.sub(vel).mul(dt.mul(1.5)));
        pos.addAssign(vel.mul(dt));
        st.x.assign(life.sub(dt));
        If(pos.y.lessThan(-5.5), () => { st.x.assign(0.0); });
      }).Else(() => {
        // partícula libre: puede nacer si el bisturí está sobre la cicatriz
        const onScar = float(1.0).sub(
          smoothstep(0.0, params.cutRadius.mul(0.7), abs(att.x.sub(curveX(att.y))))
        );
        const inRange = step(-SCAR_TOP, att.y).mul(step(att.y, SCAR_TOP));
        const p = bleedMode.mul(0.7).mul(onScar).mul(inRange).mul(dt);

        If(r1.lessThan(p), () => {
          const y0 = att.y.add(r2.sub(0.5).mul(params.cutRadius.mul(1.4))).clamp(-SCAR_TOP, SCAR_TOP);
          const s = sign(r3.sub(0.5));
          pos.assign(vec3(curveX(y0).add(r3.sub(0.5).mul(0.08)), y0, 0.0));
          vel.assign(vec3(s.mul(r4.mul(1.2).add(0.2)), r5.mul(0.8).sub(0.6), 0.0));
          const ml = r6.mul(2.0).add(2.0);
          st.assign(vec3(ml, ml, 1.0));
        });
      });
    });

    pBuf.assign(pos);
    vBuf.assign(vel);
    sBuf.assign(st);
  })().compute(count).setName('Update Scar');

  // ---------- RENDER ----------
  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });

  const stAttr = stateBuffer.toAttribute();
  const isBlood = stAttr.z;
  const lifeFrac = stAttr.x.div(max(stAttr.y, 0.0001)).clamp(0.0, 1.0);
  const visible = max(float(1.0).sub(isBlood), step(0.0001, stAttr.x));

  material.positionNode = positionBuffer.toAttribute();
  material.scaleNode = mix(params.particleSize.mul(0.22), params.particleSize.mul(0.4), isBlood).mul(visible);

  material.colorNode = Fn(() => {
    const scarCol = mix(color('#ffffff'), color('#ff1a40'), stAttr.x.clamp(0.0, 1.0));
    const bloodCol = mix(color('#4a0010'), color('#ff1a40'), lifeFrac);
    return vec4(mix(scarCol, bloodCol, isBlood), 1.0);
  })();

  const alpha = mix(float(0.9), smoothstep(0.0, 0.35, lifeFrac).mul(0.9), isBlood);
  material.opacityNode = float(1.0).sub(smoothstep(0.1, 0.5, uv().xy.sub(0.5).length())).mul(alpha);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Hoja del bisturí (marcador visual)
  const bladeGeo = new THREE.PlaneGeometry(0.05, 0.9);
  const bladeMat = new THREE.MeshBasicNodeMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.85 });
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.rotation.z = -0.45;
  blade.position.z = 0.1;
  scene.add(blade);

  function reset() { renderer.compute(initParticles); }
  function stepSimulation() {
    timeU.value += params.dt.value * params.timeScale.value;
    blade.position.x = params.attractor.value.x + 0.2;
    blade.position.y = params.attractor.value.y + 0.35;
    renderer.compute(updateParticles);
  }
  function dispose() {
    geometry.dispose(); material.dispose();
    bladeGeo.dispose(); bladeMat.dispose();
    scene.remove(mesh); scene.remove(blade);
  }

  function setActive(v) { mesh.visible = v; blade.visible = v; }
  setActive(false);

  return { count, positionBuffer, velocityBuffer, reset, stepSimulation, dispose, setActive };
}