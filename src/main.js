import * as THREE from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';

import songUrl from './CANCION/CIRUGIA.mp3';

import { createParameters } from './simulation/parameters.js';
import { createSimulation, createPhysarum } from './simulation/createSimulation.js';
import { createScar } from './simulation/createScar.js';
import { createHeart } from './simulation/createHeart.js';
import { createBone, createNerves } from './simulation/createShapes.js';
import { createFlowers } from './simulation/createFlowers.js';
import { createLandscape } from './simulation/createLandscape.js';
import { createLabPanel } from './ui/labPanel.js';

const PARTICLE_COUNT = 1536;
const SCAR_PARTICLE_COUNT = 3400;
const PHYSARUM_AGENT_COUNT = 32768;
const HEART_COUNT = 14000;
const BONE_COUNT = 18000;
const NERVE_COUNT = 14000;
const FLOWER_COUNT = 16000;
const SPEEDS = [1, 1.5, 2, 3, 0.5];   // ciclo del botón de velocidad

async function main() {
  const mount = document.querySelector('#app');

  if (!WebGPU.isAvailable()) {
    mount.appendChild(WebGPU.getErrorMessage());
    throw new Error('Este proyecto requiere WebGPU para ejecutar compute shaders.');
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#050607');

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  mount.appendChild(renderer.domElement);
  await renderer.init();

  const params = createParameters();
  const heart = createHeart({ renderer, scene, params, count: HEART_COUNT });          // fondo, siempre activo
  const bone = createBone({ renderer, scene, params, count: BONE_COUNT });            // 1
  const nerves = createNerves({ renderer, scene, params, count: NERVE_COUNT });        // 2
  const simulation = createSimulation({ renderer, scene, params, count: PARTICLE_COUNT }); // 3
  const scar = createScar({ renderer, scene, params, count: SCAR_PARTICLE_COUNT });    // 4
  const physarum = createPhysarum({ renderer, scene, params, count: PHYSARUM_AGENT_COUNT }); // capa de fondo (tecla 5)
  const landscape = createLandscape({ scene, camera, params });                             // paisaje de fondo de Flores
  const flowers = createFlowers({ renderer, scene, params, count: FLOWER_COUNT });          // 6 (flores, modo bonito)

  // 'bone' (1) · 'nerve' (2) · 'tissue' (3 hemorragia) · 'scar' (4) · 'flowers' (6)
  let activeScene = 'bone';
  let allMode = false;            // TURBIO: todos los instrumentos a la vez (tecla T)
  let veinsOn = false;            // venas de fondo (tecla 5)
  let veinsBeforeAll = false;     // para restaurar las venas al salir de TURBIO

  function applyVisibility() {
    bone.setActive(allMode || activeScene === 'bone');
    nerves.setActive(allMode || activeScene === 'nerve');
    simulation.setActive(allMode || activeScene === 'tissue');
    scar.setActive(allMode || activeScene === 'scar');
    physarum.setActive(veinsOn);
    const flowersOn = !allMode && activeScene === 'flowers';
    flowers.setActive(flowersOn);
    landscape.setActive(flowersOn);
    heart.setActive(!flowersOn);          // en Flores el corazón desaparece
    document.documentElement.classList.toggle('flores', flowersOn);
    scene.background.set(flowersOn ? '#090a24' : '#050607');
  }

  // Elegir un modo 1-4 sale de TURBIO y deja solo ese instrumento
  function setScene(name) {
    activeScene = name;
    if (allMode) setAll(false);
    applyVisibility();
  }

  // Venas (Physarum): capa de fondo independiente de los modos, se prende/apaga con 5
  function setVeins(on) {
    veinsOn = on;
    applyVisibility();
  }

  // TURBIO: los 4 modos + venas + corazón al mismo tiempo, con la pantalla "sucia"
  function setAll(on) {
    if (on === allMode) return;
    allMode = on;
    if (on) { veinsBeforeAll = veinsOn; veinsOn = true; }
    else veinsOn = veinsBeforeAll;
    document.documentElement.classList.toggle('turbio', on);
    applyVisibility();
  }
  applyVisibility();

  // se llama desde la tecla T y desde el botón del panel
  function toggleAll() {
    setAll(!allMode);
    updateHudText();
  }

  const audio = new Audio(songUrl);

  // Anillo del bisturí: muestra el radio de percepción (cutRadius) y reacciona al latido
  const ringMat = new THREE.MeshBasicNodeMaterial({ color: 0xff3355, transparent: true, opacity: 0.25, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.0, 96), ringMat);
  ring.position.z = 0.1;
  scene.add(ring);

  // Grano de película sobre todo (da textura clínica / analógica)
  const grain = document.createElement('div');
  grain.className = 'grain';
  document.body.append(grain);

  const narrativeLayer = document.createElement('div');
  narrativeLayer.className = 'narrative-layer';
  narrativeLayer.innerHTML = `<div id="lyrics-box" class="lyrics-text"></div>`;
  document.body.append(narrativeLayer);
  const lyricsBox = document.getElementById('lyrics-box');

  // Viñeta para dar profundidad
  const vignette = document.createElement('div');
  vignette.className = 'vignette';
  document.body.append(vignette);

  // ---------- CORAZÓN: solo late cuando el intérprete lo pide (Espacio) ----------
  let lastBeat = -10;

  // pulso rápido: sube casi de golpe y cae suave
  const pulse = (x) => (x < 0 ? 0 : (1 - Math.exp(-x * 45)) * Math.exp(-x * 7) * 1.6);

  let veinWaveR = -1;             // radio de la onda de las venas (-1 = apagada)

  function beat() {
    lastBeat = params.time.value;
    nerves.fire();
    veinWaveR = 0;                // las venas reciben una onda que sale del corazón
  }

  const hud = document.createElement('div');
  hud.className = 'hud';
  let currentMode = '1. Hueso';
  function updateHudText() {
    const veins = veinsOn ? 'ON' : 'off';
    const modeLabel = allMode ? 'TURBIO · todos' : currentMode;
    hud.innerHTML = `<strong>WASD / Mouse</strong>: Bisturí · <strong>[1-4 · 6]</strong>: <span class="mode">${modeLabel}</span> · <strong>Q</strong>: Velocidad <span class="mode">×${params.timeScale.value}</span> · <strong>T</strong>: Turbio (todos) · <strong>5</strong>: Venas <span class="mode">${veins}</span> · <strong>G/H</strong> (mantener): Crecer / Cortar venas · <strong>Espacio</strong>: Latido · <strong>Z/X/C</strong>: Letra · <strong>V</strong>: Invertir · <strong>M</strong>: Música · <strong>F</strong>: Pantalla completa · <strong>P</strong>: Panel`;
  }
  document.body.append(hud);
  updateHudText();

  const LYRIC_KEYS = {
    KeyZ: { text: "POR VOS", size: "72px", effect: 'none' },
    KeyX: { text: "VOY EN MISIÓN SUICIDA", size: "80px", effect: 'invert' },
    KeyC: { text: "PIERDE VALOR LA VIDA CUANDO NO SOY TU DIVERSIÓN", size: "42px", effect: 'none' },
    // solo cambia el color (invierte), sin letra
    KeyV: { text: "", size: "0px", effect: 'invert' }
  };

  function showLyric(clip) {
    lyricsBox.textContent = clip.text;
    lyricsBox.style.fontSize = clip.size;
    lyricsBox.classList.toggle('visible', clip.text !== '');
    document.body.style.filter = clip.effect === 'invert' ? 'invert(1)' : 'none';
  }
  function hideLyric() {
    lyricsBox.classList.remove('visible');
    document.body.style.filter = 'none';
  }

  const keyboardPos = new THREE.Vector3(0, 0, 0);
  const MOVE_SPEED = 12.0;      // unidades de mundo por segundo (antes 0.2 por frame: dependía de los fps)
  const keys = {};

  // Bisturí con mouse: convierte la posición de pantalla al plano z=0 de la cámara
  addEventListener('pointermove', (e) => {
    if (e.target.closest?.('.panel')) return;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * camera.aspect;
    keyboardPos.x = ((e.clientX / innerWidth) * 2 - 1) * halfW;
    keyboardPos.y = (1 - (e.clientY / innerHeight) * 2) * halfH;
  });
  // si la ventana pierde el foco, soltar todas las teclas (evita que el bisturí quede "pegado")
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  let panel;

  addEventListener('keydown', (e) => {
    keys[e.key] = true;
    keys[e.code] = true;

    if (e.code === 'Space') e.preventDefault();

    const SCENES = {
      Digit1: ['bone', '1. Hueso'],
      Digit2: ['nerve', '2. Nervios'],
      Digit3: ['tissue', '3. Hemorragia / Vórtice'],
      Digit4: ['scar', '4. Cicatriz'],
      Digit6: ['flowers', '6. Flores']
    };
    if (SCENES[e.code]) {
      const [name, label] = SCENES[e.code];
      setScene(name);
      currentMode = label;
      updateHudText();
    }

    if (e.repeat) return;

    if (e.code === 'Digit5') {         // venas de fondo: prender / apagar
      if (allMode) setAll(false);      // en TURBIO las venas ya están; 5 sale de TURBIO
      else setVeins(!veinsOn);
      updateHudText();
    }
    if (e.code === 'KeyT') {           // TURBIO: todos los instrumentos a la vez
      toggleAll();
    }

    if (e.code === 'Space') beat();
    if (e.code === 'KeyQ') cycleSpeed();

    if (LYRIC_KEYS[e.code]) showLyric(LYRIC_KEYS[e.code]);

    if (e.code === 'KeyM') {
      if (audio.paused) audio.play().catch((err) => console.log('Audio error:', err));
      else audio.pause();
    }
    if (e.code === 'KeyF') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    }
    if (e.code === 'KeyP') {
      const panelEl = document.querySelector('.panel');
      if (panelEl) panelEl.classList.toggle('hidden');
    }
    if (e.code === 'KeyR') resetAll();
  });

  addEventListener('keyup', (e) => {
    keys[e.key] = false;
    keys[e.code] = false;
    if (e.code === 'Space') e.preventDefault();
    if (LYRIC_KEYS[e.code]) hideLyric();
  });

  function updateKeyboardAttractor(frameDt) {
    const mv = MOVE_SPEED * frameDt;
    if (keys['KeyW'] || keys['ArrowUp']) keyboardPos.y += mv;
    if (keys['KeyS'] || keys['ArrowDown']) keyboardPos.y -= mv;
    if (keys['KeyA'] || keys['ArrowLeft']) keyboardPos.x -= mv;
    if (keys['KeyD'] || keys['ArrowRight']) keyboardPos.x += mv;

    keyboardPos.x = Math.max(-8.3, Math.min(8.3, keyboardPos.x));
    keyboardPos.y = Math.max(-4.6, Math.min(4.6, keyboardPos.y));
    params.attractor.value.copy(keyboardPos);
  }

  function resetAll() {
    heart.reset(); bone.reset(); nerves.reset();
    simulation.reset(); scar.reset(); physarum.reset(); flowers.reset();
  }

  // Botón / tecla Q: acelera todo el movimiento (1 → 1.5 → 2 → 3 → 0.5 → 1 …)
  function cycleSpeed() {
    const idx = SPEEDS.findIndex((v) => Math.abs(v - params.timeScale.value) < 0.01);
    params.timeScale.value = SPEEDS[(idx + 1) % SPEEDS.length];
    panel?.refresh();
    updateHudText();
  }

  let paused = false;
  let panelVisible = true;

  panel = createLabPanel({
    params,
    onReset: resetAll,
    onModeChange: () => {
      panelVisible = !panelVisible;
      panel.setVisible(panelVisible);
    },
    onPauseChange: () => { paused = !paused; },
    onBeat: beat,
    onAll: toggleAll,
    onSpeed: cycleSpeed
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  resetAll();

  // Paso de tiempo real: la simulación corre igual a 60, 120 o 144 Hz.
  // Se acota para que una pestaña en segundo plano no provoque un salto enorme.
  let lastFrame = performance.now();

  renderer.setAnimationLoop(() => {
    const nowMs = performance.now();
    const frameDt = Math.min(Math.max((nowMs - lastFrame) / 1000, 1 / 240), 1 / 30);
    lastFrame = nowMs;
    params.dt.value = frameDt;

    if (!paused) {
      updateKeyboardAttractor(frameDt);
      params.time.value += params.dt.value * params.timeScale.value;
      const now = params.time.value;

      // latido: solo lo dispara el intérprete (Espacio)
      const x = now - lastBeat;
      params.beat.value = pulse(x) + 0.7 * pulse(x - 0.24);   // "lub-dub"
      // gestos sobre las venas: G mantenida = crecer, H mantenida = cortar
      params.veinGrow.value = keys['KeyG'] ? 1 : 0;
      params.veinCut.value = keys['KeyH'] ? 1 : 0;

      // onda del latido que recorre las venas (sale del corazón y se apaga lejos)
      if (veinWaveR >= 0) {
        veinWaveR += frameDt * params.timeScale.value * 10.0;
        if (veinWaveR > 14) veinWaveR = -1;
      }
      params.veinWave.value = veinWaveR;

      if (!(!allMode && activeScene === 'flowers')) heart.stepSimulation();
      if (veinsOn) physarum.stepSimulation();

      // TURBIO: se simulan los cuatro instrumentos a la vez
      if (allMode || activeScene === 'bone') bone.stepSimulation();
      if (allMode || activeScene === 'nerve') nerves.stepSimulation();
      if (allMode || activeScene === 'scar') scar.stepSimulation();
      if (allMode || activeScene === 'tissue') simulation.stepSimulation();
      if (!allMode && activeScene === 'flowers') flowers.stepSimulation();

      // anillo del bisturí: sigue al atractor, mide cutRadius y brilla con el latido
      ring.position.x = params.attractor.value.x;
      ring.position.y = params.attractor.value.y;
      ring.scale.setScalar(params.cutRadius.value);
      ringMat.opacity = 0.2 + Math.min(params.beat.value, 1.0) * 0.5;
      ringMat.color.setHex(!allMode && activeScene === 'flowers' ? 0x7ffcff : 0xff3355);
    }
    landscape.setActive(!allMode && activeScene === 'flowers');   // paisaje: SOLO en el modo Flores
    renderer.render(scene, camera);
  });
}

main().catch((error) => {
  console.error(error);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:16px;white-space:pre-wrap;color:#fff;z-index:50';
  pre.textContent = String(error?.stack || error);
  document.body.append(pre);
});