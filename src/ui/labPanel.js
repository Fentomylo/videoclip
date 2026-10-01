function rangeRow(parent, label, object, key, min, max, step, onInput, getValue) {
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const lab = document.createElement('label');
  const name = document.createElement('span');
  const value = document.createElement('span');
  value.className = 'value';
  name.textContent = label;
  lab.append(name, value);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(object[key]);
  const refresh = () => {
    object[key] = Number(input.value);
    value.textContent = Number(input.value).toFixed(step < 0.01 ? 3 : 2);
    onInput?.(object[key]);
  };
  input.addEventListener('input', refresh);
  refresh();
  wrap.append(lab, input);
  parent.append(wrap);
  return {
    input,
    refresh() {
      if (getValue) {
        const next = Number(getValue());
        object[key] = next;
        input.value = String(next);
        value.textContent = next.toFixed(step < 0.01 ? 3 : 2);
      }
    }
  };
}

function button(parent, label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  parent.append(b);
  return b;
}

export function createLabPanel({ params, onReset, onModeChange, onPauseChange }) {
  const refreshers = [];
  const panel = document.createElement('aside');
  panel.className = 'panel';
  panel.innerHTML = `
    <h1>INSTRUMENTO · CIRUGÍA</h1>
    <p>Teclado <strong>1/2/3</strong>: Modos de Tejido · <strong>4</strong>: Cicatriz · <strong>5</strong>: Physarum. <strong>WASD</strong>: Bisturí. <strong>M</strong>: Música. <strong>Z/X/C</strong>: Letra (mantener).</p>
  `;

  const sim = document.createElement('div');
  sim.className = 'group';
  sim.innerHTML = '<h2>Parámetros del Tejido</h2>';
  panel.append(sim);

  const state = {
    timeScale: params.timeScale.value,
    flowStrength: params.flowStrength.value,
    cohesionStrength: params.cohesionStrength.value,
    radialStrength: params.radialStrength.value,
    vortexStrength: params.vortexStrength.value,
    particleSize: params.particleSize.value
  };

  refreshers.push(rangeRow(sim, 'Velocidad Global', state, 'timeScale', 0, 2, 0.01, (v) => params.timeScale.value = v, () => params.timeScale.value));
  refreshers.push(rangeRow(sim, 'Fuerza de Flujo', state, 'flowStrength', 0, 5, 0.05, (v) => params.flowStrength.value = v, () => params.flowStrength.value));
  refreshers.push(rangeRow(sim, 'Cohesión Celular', state, 'cohesionStrength', 0, 3, 0.05, (v) => params.cohesionStrength.value = v, () => params.cohesionStrength.value));
  refreshers.push(rangeRow(sim, 'Fuerza del Bisturí (WASD)', state, 'radialStrength', -6, 6, 0.05, (v) => params.radialStrength.value = v, () => params.radialStrength.value));
  refreshers.push(rangeRow(sim, 'Intensidad de Corte', state, 'vortexStrength', -6, 6, 0.05, (v) => params.vortexStrength.value = v, () => params.vortexStrength.value));
  refreshers.push(rangeRow(sim, 'Grosor de Filamentos', state, 'particleSize', 0.1, 0.6, 0.01, (v) => params.particleSize.value = v, () => params.particleSize.value));

  const scarGroup = document.createElement('div');
  scarGroup.className = 'group';
  scarGroup.innerHTML = '<h2>Cicatriz (tecla 4)</h2>';
  panel.append(scarGroup);

  const scarState = {
    cutRadius: params.cutRadius.value,
    gape: params.gape.value,
    healRate: params.healRate.value,
    bleedRate: params.bleedRate.value,
    gravity: params.gravity.value
  };

  refreshers.push(rangeRow(scarGroup, 'Radio del Bisturí', scarState, 'cutRadius', 0.3, 3, 0.05, (v) => params.cutRadius.value = v, () => params.cutRadius.value));
  refreshers.push(rangeRow(scarGroup, 'Apertura de la Herida', scarState, 'gape', 0, 3, 0.05, (v) => params.gape.value = v, () => params.gape.value));
  refreshers.push(rangeRow(scarGroup, 'Cicatrización (cierre)', scarState, 'healRate', 0, 4, 0.05, (v) => params.healRate.value = v, () => params.healRate.value));
  refreshers.push(rangeRow(scarGroup, 'Sangrado', scarState, 'bleedRate', 0, 4, 0.05, (v) => params.bleedRate.value = v, () => params.bleedRate.value));
  refreshers.push(rangeRow(scarGroup, 'Gravedad de la Sangre', scarState, 'gravity', 0, 8, 0.1, (v) => params.gravity.value = v, () => params.gravity.value));

  const physGroup = document.createElement('div');
  physGroup.className = 'group';
  physGroup.innerHTML = '<h2>Physarum · Venas (tecla 5)</h2>';
  panel.append(physGroup);

  const physState = {
    sensorAngle: params.sensorAngle.value,
    sensorDist: params.sensorDist.value,
    turnRate: params.turnRate.value,
    evaporation: params.evaporation.value
  };

  refreshers.push(rangeRow(physGroup, 'Ángulo del Sensor', physState, 'sensorAngle', 0.1, 1.4, 0.01, (v) => params.sensorAngle.value = v, () => params.sensorAngle.value));
  refreshers.push(rangeRow(physGroup, 'Distancia del Sensor', physState, 'sensorDist', 0.1, 1.2, 0.01, (v) => params.sensorDist.value = v, () => params.sensorDist.value));
  refreshers.push(rangeRow(physGroup, 'Giro hacia el Rastro', physState, 'turnRate', 1, 20, 0.5, (v) => params.turnRate.value = v, () => params.turnRate.value));
  refreshers.push(rangeRow(physGroup, 'Evaporación', physState, 'evaporation', 0.1, 4, 0.05, (v) => params.evaporation.value = v, () => params.evaporation.value));

  const actions = document.createElement('div');
  actions.className = 'group';
  actions.innerHTML = '<h2>Acciones</h2>';
  panel.append(actions);
  button(actions, 'Reiniciar Sistema (R)', onReset);
  button(actions, 'Pausar / Continuar', onPauseChange);
  button(actions, 'Ocultar Panel (P)', onModeChange);

  document.body.append(panel);

  return {
    element: panel,
    setVisible(visible) { panel.classList.toggle('hidden', !visible); },
    refresh() { for (const item of refreshers) item.refresh(); }
  };
}