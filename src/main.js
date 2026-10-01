import * as THREE from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';

import songUrl from './CANCION/CIRUGIA.mp3';

import { createParameters } from './simulation/parameters.js';
import { createSimulation, createPhysarum } from './simulation/createSimulation.js';
import { createScar } from './simulation/createScar.js';
import { createLabPanel } from './ui/labPanel.js';

const PARTICLE_COUNT = 1536;
const SCAR_PARTICLE_COUNT = 3400;
const PHYSARUM_AGENT_COUNT = 32768;

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
  const simulation = createSimulation({ renderer, scene, params, count: PARTICLE_COUNT });
  const scar = createScar({ renderer, scene, params, count: SCAR_PARTICLE_COUNT });
  const physarum = createPhysarum({ renderer, scene, params, count: PHYSARUM_AGENT_COUNT });

  // Escena activa: 'tissue' (enjambre 1/2/3), 'scar' (tecla 4) o 'physarum' (tecla 5)
  let activeScene = 'tissue';
  function setScene(name) {
    activeScene = name;
    simulation.setActive(name === 'tissue');
    scar.setActive(name === 'scar');
    physarum.setActive(name === 'physarum');
  }
  setScene('tissue');

  const audio = new Audio(songUrl);

  // Inyectar la capa fotográfica de decoración en el DOM
  const backdrop = document.createElement('div');
  backdrop.className = 'photo-backdrop';
  document.body.append(backdrop);

  const narrativeLayer = document.createElement('div');
  narrativeLayer.className = 'narrative-layer';
  narrativeLayer.innerHTML = `
    <div id="lyrics-box" class="lyrics-text"></div>
  `;
  document.body.append(narrativeLayer);

  const lyricsBox = document.getElementById('lyrics-box');

  const hud = document.createElement('div');
  hud.className = 'hud';
  let currentTissueMode = "1. Sutura Celular";
  function updateHudText() {
    hud.innerHTML = `<strong>INSTRUMENTO</strong> · <strong>WASD</strong>: Bisturí · <strong>Modo [1-5]</strong>: <span style="color:#ff3355">${currentTissueMode}</span> · <strong>M</strong>: Música · <strong>Z/X/C</strong>: Letra · <strong>P</strong>: Panel`;
  }
  document.body.append(hud);
  updateHudText();

  // La letra la dispara el intérprete (mantener la tecla), no el reloj de la canción
  const LYRIC_KEYS = {
    KeyZ: { text: "POR VOS", size: "72px", effect: 'none' },
    KeyX: { text: "VOY EN MISIÓN SUICIDA", size: "80px", effect: 'invert' },
    KeyC: { text: "PIERDE VALOR LA VIDA CUANDO NO SOY TU DIVERSIÓN", size: "42px", effect: 'none' }
  };

  function showLyric(clip) {
    lyricsBox.textContent = clip.text;
    lyricsBox.style.fontSize = clip.size;
    lyricsBox.classList.add('visible');
    document.body.style.filter = clip.effect === 'invert' ? 'invert(1)' : 'none';
  }

  function hideLyric() {
    lyricsBox.classList.remove('visible');
    document.body.style.filter = 'none';
  }

  // bioMode (1/2/3) se interpola hacia su objetivo para que los cambios de modo sean un morph
  let bioTarget = 1.0;

  const keyboardPos = new THREE.Vector3(0, 0, 0);
  const moveSpeed = 0.2;
  const keys = {};

  addEventListener('keydown', (e) => {
    keys[e.key] = true;
    keys[e.code] = true;

    if (e.key === '1' || e.code === 'Digit1') {
      bioTarget = 1.0;
      setScene('tissue');
      currentTissueMode = "1. Sutura Celular";
      updateHudText();
    }
    if (e.key === '2' || e.code === 'Digit2') {
      bioTarget = 2.0;
      setScene('tissue');
      currentTissueMode = "2. Hemorragia / Vórtice";
      updateHudText();
    }
    if (e.key === '3' || e.code === 'Digit3') {
      bioTarget = 3.0;
      setScene('tissue');
      currentTissueMode = "3. Disección Estructural";
      updateHudText();
    }
    if (e.key === '4' || e.code === 'Digit4') {
      setScene('scar');
      currentTissueMode = "4. Cicatriz";
      updateHudText();
    }

    if (e.key === '5' || e.code === 'Digit5') {
      setScene('physarum');
      currentTissueMode = "5. Physarum / Venas";
      updateHudText();
    }

    if (e.repeat) return;

    if (LYRIC_KEYS[e.code]) showLyric(LYRIC_KEYS[e.code]);

    if (e.code === 'KeyM') {
      if (audio.paused) {
        audio.play().catch(err => console.log("Audio error:", err));
      } else {
        audio.pause();
      }
    }
    if (e.code === 'KeyP') {
      const panelEl = document.querySelector('.panel');
      if (panelEl) panelEl.classList.toggle('hidden');
    }
    if (e.code === 'KeyR') { simulation.reset(); scar.reset(); physarum.reset(); }
  });

  addEventListener('keyup', (e) => {
    keys[e.key] = false;
    keys[e.code] = false;
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

  let paused = false;
  let panelVisible = true;

  const panel = createLabPanel({
    params,
    onReset: () => { simulation.reset(); scar.reset(); physarum.reset(); },
    onModeChange: () => {
      panelVisible = !panelVisible;
      panel.setVisible(panelVisible);
    },
    onPauseChange: () => paused = !paused
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  simulation.reset();
  scar.reset();
  physarum.reset();

  renderer.setAnimationLoop(() => {
    if (!paused) {
      updateKeyboardAttractor();
      params.time.value += params.dt.value * params.timeScale.value;
      params.bioMode.value += (bioTarget - params.bioMode.value) * 0.08;
      if (activeScene === 'scar') scar.stepSimulation();
      else if (activeScene === 'physarum') physarum.stepSimulation();
      else simulation.stepSimulation();
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