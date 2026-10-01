import * as THREE from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';

import songUrl from './CANCION/CIRUGIA.mp3';

import { createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';
import { createLabPanel } from './ui/labPanel.js';

const PARTICLE_COUNT = 1536;

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
    hud.innerHTML = `<strong>INSTRUMENTO</strong> · <strong>WASD</strong>: Bisturí · <strong>Modo [1/2/3]</strong>: <span style="color:#ff3355">${currentTissueMode}</span> · <strong>M</strong>: Música · <strong>P</strong>: Panel`;
  }
  document.body.append(hud);
  updateHudText();

  // Línea de tiempo exacta con la letra solicitada
  const LYRICS_TIMELINE = [
    { start: 53.0, end: 54.5, text: "POR VOS", size: "72px", effect: 'none' },
    { start: 55.0, end: 57.0, text: "VOY EN MISIÓN SUICIDA", size: "64px", effect: 'invert' },

    { start: 136.0, end: 138.0, text: "POR VOS", size: "72px", effect: 'none' },
    { start: 138.0, end: 141.0, text: "VOY EN MISIÓN SUICIDA", size: "80px", effect: 'invert' },
    { start: 142.0, end: 147.0, text: "PIERDE VALOR LA VIDA CUANDO NO SOY TU DIVERSIÓN", size: "42px", effect: 'none' }
  ];

  function updateNarrativeScore(currentTime) {
    document.body.style.filter = 'none';
    lyricsBox.style.fontSize = "56px";
    let activeText = "";

    const currentFrame = LYRICS_TIMELINE.find(
      (clip) => currentTime >= clip.start && currentTime < clip.end
    );

    if (currentFrame) {
      activeText = currentFrame.text;

      if (currentFrame.effect === 'invert') {
        document.body.style.filter = 'invert(1)';
      }

      if (currentFrame.size) {
        lyricsBox.style.fontSize = currentFrame.size;
      }
    }

    if (activeText !== "") {
      lyricsBox.textContent = activeText;
      lyricsBox.classList.add('visible');
    } else {
      lyricsBox.classList.remove('visible');
    }
  }

  const keyboardPos = new THREE.Vector3(0, 0, 0);
  const moveSpeed = 0.2;
  const keys = {};

  addEventListener('keydown', (e) => {
    keys[e.key] = true;
    keys[e.code] = true;

    if (e.key === '1' || e.code === 'Digit1') {
      params.bioMode.value = 1.0;
      currentTissueMode = "1. Sutura Celular";
      updateHudText();
    }
    if (e.key === '2' || e.code === 'Digit2') {
      params.bioMode.value = 2.0;
      currentTissueMode = "2. Hemorragia / Vórtice";
      updateHudText();
    }
    if (e.key === '3' || e.code === 'Digit3') {
      params.bioMode.value = 3.0;
      currentTissueMode = "3. Disección Estructural";
      updateHudText();
    }

    if (e.repeat) return;
    
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
    if (e.code === 'KeyR') simulation.reset();
  });

  addEventListener('keyup', (e) => {
    keys[e.key] = false;
    keys[e.code] = false;
  });

  function updateKeyboardAttractor() {
    if (keys['KeyW'] || keys['ArrowUp']) keyboardPos.y += moveSpeed;
    if (keys['KeyS'] || keys['ArrowDown']) keyboardPos.y -= moveSpeed;
    if (keys['KeyA'] || keys['ArrowLeft']) keyboardPos.x -= moveSpeed;
    if (keys['KeyD'] || keys['ArrowRight']) keyboardPos.x += moveSpeed;

    keyboardPos.clampScalar(-9.0, 9.0);
    params.attractor.value.copy(keyboardPos);
  }

  let paused = false;
  let panelVisible = true;

  const panel = createLabPanel({
    params,
    onReset: () => simulation.reset(),
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

  renderer.setAnimationLoop(() => {
    if (!paused) {
      updateKeyboardAttractor();
      simulation.stepSimulation();
      if (!audio.paused) {
        updateNarrativeScore(audio.currentTime);
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