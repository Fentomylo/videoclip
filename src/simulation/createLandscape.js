import * as THREE from 'three/webgpu';
import {
  Fn, color, float, mix, sin, smoothstep, uniform, uv, vec2, vec3, vec4, positionLocal
} from 'three/tsl';

// =====================================================================
//  FONDO DEL MODO FLORES: niebla gris + siluetas de árboles secos
//  - Un plano con shader: gris claro y brumoso al centro, oscuro hacia los
//    bordes (izquierda y abajo), con bruma que se desplaza muy despacio.
//  - Árboles generados con ramificación recursiva (troncos gruesos y ramitas
//    finísimas) en 3 capas: cercanos negros, medios y lejanos más difusos.
//  - Las ramas se mecen apenas con el viento.
// =====================================================================
const BG_Z = -5;
const TREE_Z = -4.5;
const MIN_W = 0.0028;   // grosor mínimo de las ramitas (en alturas de pantalla)

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Genera los triángulos (quads) de un conjunto de árboles.
// Unidades: y = ±1 es el alto de la pantalla.
function buildTrees(seed, trees) {
  const rnd = mulberry32(seed);
  const pos = [];

  const seg = (x0, y0, w0, x1, y1, w1) => {
    w0 = Math.max(w0, MIN_W); w1 = Math.max(w1, MIN_W);
    const dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy) || 1e-6;
    const nx = -dy / L, ny = dx / L;
    const ax = x0 + nx * w0 * 0.5, ay = y0 + ny * w0 * 0.5;
    const bx = x0 - nx * w0 * 0.5, by = y0 - ny * w0 * 0.5;
    const cx = x1 + nx * w1 * 0.5, cy = y1 + ny * w1 * 0.5;
    const dx2 = x1 - nx * w1 * 0.5, dy2 = y1 - ny * w1 * 0.5;
    pos.push(ax, ay, 0, bx, by, 0, cx, cy, 0, bx, by, 0, dx2, dy2, 0, cx, cy, 0);
  };

  const branch = (x, y, ang, len, w, depth) => {
    const steps = Math.max(2, Math.round(len / 0.06));
    const endW = w * 0.7;
    const drift = (rnd() - 0.5) * 0.11;                // cada rama se curva hacia un lado
    let cx = x, cy = y, a = ang, cw = w;
    for (let s = 0; s < steps; s++) {
      a += drift + (rnd() - 0.5) * 0.1;
      a = Math.min(Math.max(a, 0.12), Math.PI - 0.12);   // las ramas nunca crecen hacia abajo
      const l = len / steps;
      const nx = cx + Math.cos(a) * l;
      const ny = cy + Math.sin(a) * l;
      const w1 = w + (endW - w) * ((s + 1) / steps);
      seg(cx, cy, cw, nx, ny, w1);
      cw = w1; cx = nx; cy = ny;
    }
    if (depth <= 0 || len < 0.03 || pos.length > 600000) return;

    // 2 ramas casi siempre; a veces 3. Una sigue más recta (la "principal")
    const n = rnd() < 0.22 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const main = k === 0;
      const side = (k % 2 === 0 ? -1 : 1);
      const da = main ? (rnd() - 0.5) * 0.25 : side * (0.35 + rnd() * 0.5) + (rnd() - 0.5) * 0.2;
      const lenK = len * (main ? 0.82 + rnd() * 0.1 : 0.58 + rnd() * 0.2);
      const wK = cw * (main ? 0.82 : 0.58 + rnd() * 0.1);
      branch(cx, cy, a + da, lenK, wK, depth - 1);
    }
  };

  for (const t of trees) branch(t.x, t.y, t.ang, t.len, t.w, t.depth);
  return new Float32Array(pos);
}

export function createLandscape({ scene, camera, params }) {
  const aspectU = uniform(innerWidth / innerHeight);
  const group = new THREE.Group();

  // ---------- niebla gris ----------
  const bgMat = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
  bgMat.colorNode = Fn(() => {
    const u = uv().x;
    const v = uv().y;
    const x = u.mul(aspectU);
    const t = params.time;

    // luz difusa: clara arriba al centro, oscura en bordes
    const d = vec2(u.sub(0.55).mul(aspectU).mul(0.62), v.sub(0.66)).length();
    let L = float(1.0).sub(smoothstep(0.0, 0.95, d)).mul(0.74).add(0.05);
    // oscurece abajo y a la izquierda
    L = L.mul(float(0.3).add(smoothstep(0.0, 0.5, v).mul(0.7)));
    L = L.mul(float(0.4).add(smoothstep(0.0, 0.4, u).mul(0.6)));
    // bruma que se desplaza muy despacio
    const mist = sin(x.mul(2.2).add(t.mul(0.05)).add(sin(v.mul(6.0).add(t.mul(0.03))).mul(1.5)));
    L = L.add(mist.mul(0.025).mul(smoothstep(0.1, 0.5, v)));

    const col = mix(color('#0d0508'), color('#c8b4b9'), L.clamp(0.0, 1.0)).toVar();
    // bruma roja sangre pegada al suelo (el mismo rojo de las flores y el corazón)
    col.addAssign(color('#ff1a40').mul(0.07).mul(float(1.0).sub(smoothstep(0.0, 0.4, v))));
    return vec4(col, 1.0);
  })();
  const bgGeo = new THREE.PlaneGeometry(1, 1);
  const bg = new THREE.Mesh(bgGeo, bgMat);
  bg.position.z = BG_Z;
  bg.renderOrder = -10;
  bg.frustumCulled = false;
  group.add(bg);

  // ---------- árboles en 3 capas ----------
  const layers = [
    {   // lejanos: difusos, grises
      seed: 5, order: -9, col: '#6e3d49', opacity: 0.5,
      trees: [
        { x: -0.5, y: -1.2, ang: 1.7, len: 0.55, w: 0.03, depth: 8 },
        { x: 0.75, y: -1.2, ang: 1.45, len: 0.5, w: 0.028, depth: 8 }
      ]
    },
    {   // medios
      seed: 11, order: -8, col: '#220b13', opacity: 0.9,
      trees: [
        { x: -1.35, y: -1.2, ang: 1.55, len: 0.85, w: 0.055, depth: 9 }
      ]
    },
    {   // cercanos: negros, gruesos
      seed: 23, order: -7, col: '#0a0205', opacity: 1.0,
      trees: [
        { x: 1.55, y: -1.2, ang: 1.8, len: 0.95, w: 0.12, depth: 10 },
        { x: -2.1, y: -1.2, ang: 1.1, len: 1.0, w: 0.075, depth: 9 }
      ]
    }
  ];

  const treeMeshes = [];
  const geos = [];
  const mats = [];
  for (const L of layers) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(buildTrees(L.seed, L.trees), 3));
    const mat = new THREE.MeshBasicNodeMaterial({
      color: L.col, transparent: L.opacity < 1, opacity: L.opacity,
      side: THREE.DoubleSide, depthWrite: false, depthTest: false
    });
    // viento: las ramas altas se mecen un poco más que la base
    mat.positionNode = positionLocal.add(vec3(
      sin(params.time.mul(0.6).add(positionLocal.y.mul(1.5)).add(float(L.seed))).mul(0.012).mul(positionLocal.y.add(1.2)),
      0.0, 0.0
    ));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = TREE_Z;
    mesh.renderOrder = L.order;
    mesh.frustumCulled = false;
    group.add(mesh);
    treeMeshes.push(mesh); geos.push(geo); mats.push(mat);
  }

  // el fondo y los árboles siempre cubren la pantalla
  function resize() {
    const aspect = innerWidth / innerHeight;
    const fovT = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const hBg = 2 * (camera.position.z - BG_Z) * fovT * 1.02;
    bg.scale.set(hBg * aspect, hBg, 1);
    const halfH = (camera.position.z - TREE_Z) * fovT;
    for (const m of treeMeshes) m.scale.setScalar(halfH);
    aspectU.value = aspect;
  }
  addEventListener('resize', resize);
  resize();

  function setActive(v) {
    group.visible = v;
    if (v && !group.parent) scene.add(group);
    else if (!v && group.parent) scene.remove(group);
  }
  function dispose() {
    removeEventListener('resize', resize);
    bgGeo.dispose(); bgMat.dispose();
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
    scene.remove(group);
  }
  setActive(false);   // solo existe en el modo Flores

  return { setActive, dispose };
}