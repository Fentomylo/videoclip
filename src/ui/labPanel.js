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
    <p>Teclado <strong>1/2/3</strong>: Modos de Tejido. <strong>WASD</strong>: Bisturí. <strong>M</strong>: Música.</p>
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