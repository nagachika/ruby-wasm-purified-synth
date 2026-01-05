const uiIds = [
  "osc_type", "filter_type", "cutoff", "resonance",
  "attack", "decay", "sustain", "release",
  "lfo_on", "lfo_waveform", "lfo_rate", "lfo_depth",
  "delay_time", "delay_feedback", "delay_mix",
  "reverb_seconds", "reverb_mix"
];

const keyMap = {
  'z': 60, 's': 61, 'x': 62, 'd': 63, 'c': 64, 'v': 65, 'g': 66, 'b': 67, 'h': 68, 'n': 69, 'j': 70, 'm': 71,
  ',': 72, 'q': 72, '2': 73, 'w': 74, '3': 75, 'e': 76, 'r': 77, '5': 78, 't': 79, '6': 80, 'y': 81, '7': 82, 'u': 83
};

function updateParam(vm, id, el) {
  let val;
  if (el.type === "checkbox") {
    val = el.checked ? "true" : "false";
  } else if (el.type === "range") {
    val = el.value;
  } else {
    val = `"${el.value}"`;
  }

  if (el.type === "range") {
     vm.eval(`$synth.${id} = ${el.value}.to_f`);
  } else if (el.type === "checkbox") {
     vm.eval(`$synth.${id} = ${val}`);
  } else {
     vm.eval(`$synth.${id} = ${val}`);
  }
}

export function setupUI(vm) {
  uiIds.forEach(id => {
    const el = document.getElementById(id);
    const display = document.getElementById(`val_${id}`);
    updateParam(vm, id, el);
    el.addEventListener("input", () => {
      if (display) {
        let val = el.value;
        if (id === 'cutoff') val += ' Hz';
        if (id.includes('time') || id.includes('attack') || id.includes('decay') || id.includes('release') || id.includes('seconds')) val += ' s';
        if (id === 'lfo_rate') val += ' Hz';
        display.textContent = val;
      }
      updateParam(vm, id, el);
    });
  });
}

export function setupKeyboard(vm) {
  const getFreq = (note) => 440.0 * Math.pow(2.0, (note - 69) / 12.0);
  const viewSynth = document.getElementById("view-synthesizer");

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (!viewSynth.classList.contains("active")) return;
    const note = keyMap[e.key];
    if (note) vm.eval(`$synth.note_on(${getFreq(note)})`);
  });

  window.addEventListener("keyup", (e) => {
    const note = keyMap[e.key];
    if (note) vm.eval(`$synth.note_off(${getFreq(note)})`);
  });
}
