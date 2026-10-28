import * as THREE from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';

import songUrl from './CANCION/CIRUGIA.mp3';

import { createParameters } from './simulation/parameters.js';
import { createSimulation, createPhysarum } from './simulation/createSimulation.js';
import { createScar } from './simulation/createScar.js';
import { createHeart } from './simulation/createHeart.js';
import { createBone, createNerves } from './simulation/createShapes.js';
import { createLabPanel } from './ui/labPanel.js';

const PARTICLE_COUNT = 1536;
const SCAR_PARTICLE_COUNT = 3400;
const PHYSARUM_AGENT_COUNT = 32768;
const HEART_COUNT = 14000;
const BONE_COUNT = 18000;
const NERVE_COUNT = 14000;

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
  const physarum = createPhysarum({ renderer, scene, params, count: PHYSARUM_AGENT_COUNT }); // 5

  // 'bone' (1) · 'nerve' (2) · 'tissue' (3 hemorragia) · 'scar' (4) · 'physarum' (5)
  let activeScene = 'bone';
  function setScene(name) {
    activeScene = name;
    bone.setActive(name === 'bone');
    nerves.setActive(name === 'nerve');
    simulation.setActive(name === 'tissue');
    scar.setActive(name === 'scar');
    physarum.setActive(name === 'physarum');
  }
  setScene('bone');

  const audio = new Audio(songUrl);

  // Capa fotográfica de decoración
  const backdrop = document.createElement('div');
  backdrop.className = 'photo-backdrop';
  document.body.append(backdrop);

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

  function beat() {
    lastBeat = params.time.value;
    nerves.fire();
  }

  const hud = document.createElement('div');
  hud.className = 'hud';
  let currentMode = '1. Hueso';
  function updateHudText() {
    hud.innerHTML = `<strong>WASD</strong>: Bisturí · <strong>[1-5]</strong>: <span style="color:#ff3355">${currentMode}</span> · <strong>Espacio</strong>: Latido · <strong>Z/X/C</strong>: Letra · <strong>V</strong>: Invertir color · <strong>M</strong>: Música · <strong>F</strong>: Pantalla completa · <strong>P</strong>: Panel`;
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
  const moveSpeed = 0.2;
  const keys = {};

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
      Digit5: ['physarum', '5. Physarum / Venas']
    };
    if (SCENES[e.code]) {
      const [name, label] = SCENES[e.code];
      setScene(name);
      currentMode = label;
      updateHudText();
    }

    if (e.repeat) return;

    if (e.code === 'Space') beat();

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

  function updateKeyboardAttractor() {
    if (keys['KeyW'] || keys['ArrowUp']) keyboardPos.y += moveSpeed;
    if (keys['KeyS'] || keys['ArrowDown']) keyboardPos.y -= moveSpeed;
    if (keys['KeyA'] || keys['ArrowLeft']) keyboardPos.x -= moveSpeed;
    if (keys['KeyD'] || keys['ArrowRight']) keyboardPos.x += moveSpeed;

    keyboardPos.x = Math.max(-8.3, Math.min(8.3, keyboardPos.x));
    keyboardPos.y = Math.max(-4.6, Math.min(4.6, keyboardPos.y));
    params.attractor.value.copy(keyboardPos);
  }

  function resetAll() {
    heart.reset(); bone.reset(); nerves.reset();
    simulation.reset(); scar.reset(); physarum.reset();
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
    onBeat: beat
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  resetAll();

  renderer.setAnimationLoop(() => {
    if (!paused) {
      updateKeyboardAttractor();
      params.time.value += params.dt.value * params.timeScale.value;
      const now = params.time.value;

      // latido: solo lo dispara el intérprete (Espacio)
      const x = now - lastBeat;
      params.beat.value = pulse(x) + 0.7 * pulse(x - 0.24);   // "lub-dub"
      heart.stepSimulation();

      if (activeScene === 'bone') bone.stepSimulation();
      else if (activeScene === 'nerve') nerves.stepSimulation();
      else if (activeScene === 'scar') scar.stepSimulation();
      else if (activeScene === 'physarum') physarum.stepSimulation();
      else {
        params.bioMode.value += (2.0 - params.bioMode.value) * 0.08;
        simulation.stepSimulation();
      }
    }
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