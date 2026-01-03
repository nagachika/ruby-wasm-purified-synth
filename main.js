import { DefaultRubyVM } from "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.7.1/dist/esm/browser.js";

const startBtn = document.getElementById("start-btn");
const overlay = document.getElementById("start-overlay");

// UI Elements
const uiIds = [
  "osc_type", "filter_type", "cutoff", "resonance",
  "attack", "decay", "sustain", "release",
  "lfo_on", "lfo_waveform", "lfo_rate", "lfo_depth",
  "delay_time", "delay_feedback", "delay_mix",
  "reverb_seconds", "reverb_mix"
];

const keyMap = {
  'z': 60, // C4
  's': 61,
  'x': 62,
  'd': 63,
  'c': 64,
  'v': 65,
  'g': 66,
  'b': 67,
  'h': 68,
  'n': 69,
  'j': 70,
  'm': 71,
  ',': 72, // C5
  'q': 72, // C5 (upper row)
  '2': 73,
  'w': 74,
  '3': 75,
  'e': 76,
  'r': 77,
  '5': 78,
  't': 79,
  '6': 80,
  'y': 81,
  '7': 82,
  'u': 83
};

const main = async () => {
  // Pre-load Ruby VM
  const response = await fetch("https://cdn.jsdelivr.net/npm/@ruby/3.3-wasm-wasi@2.7.1/dist/ruby.wasm");
  const buffer = await response.arrayBuffer();
  const module = await WebAssembly.compile(buffer);
  const { vm } = await DefaultRubyVM(module);

  window.rubyVM = vm;
  console.log("Ruby VM loaded");

  startBtn.onclick = async () => {
    // AudioContext setup
    if (!window.audioCtx) {
        window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (window.audioCtx.state === 'suspended') {
        await window.audioCtx.resume();
    }

    overlay.style.display = "none";

    console.log("Loading Ruby script...");
    const scriptRes = await fetch(`src/synthesizer.rb?_=${Date.now()}`);
    if (!scriptRes.ok) {
        console.error("Failed to fetch src/synthesizer.rb");
        return;
    }
    const scriptText = await scriptRes.text();
    vm.eval(scriptText);

    // Load Sequencer script
    const seqRes = await fetch(`src/sequencer.rb?_=${Date.now()}`);
    if (seqRes.ok) {
      const seqText = await seqRes.text();
      vm.eval(seqText);
    } else {
      console.error("Failed to fetch src/sequencer.rb");
    }

    // Instantiate Synthesizer
    vm.eval("$synth = Synthesizer.new(JS.eval('return window.audioCtx;'))");
    console.log("Synthesizer initialized");

    // Instantiate Sequencer
    vm.eval("$sequencer = Sequencer.new($synth, JS.eval('return window.audioCtx;'))");

    setupUI(vm);
    setupKeyboard(vm);
    setupVisualizer(vm);
    setupSequencer(vm);
  };
};

// Define global callback immediately
window.updatePlayhead = (stepIndex) => {
  const grid = document.getElementById("sequencer-grid");
  if (!grid) return;
  const steps = grid.children;
  for (let i = 0; i < steps.length; i++) {
    if (i === stepIndex) {
      steps[i].style.borderColor = "#fff";
      steps[i].style.boxShadow = "0 0 5px #fff";
    } else {
      steps[i].style.borderColor = "#555";
      steps[i].style.boxShadow = "none";
    }
  }
};

function setupSequencer(vm) {
  const grid = document.getElementById("sequencer-grid");
  const playBtn = document.getElementById("seq-play-btn");
  const bpmInput = document.getElementById("bpm");
  const bpmDisplay = document.getElementById("val_bpm");
  const rootFreqInput = document.getElementById("root_freq");

  // Modal Elements
  const modal = document.getElementById("grid-modal");
  const closeModal = document.getElementById("close-modal");
  const modalStepNum = document.getElementById("modal-step-num");
  const yAxisSelect = document.getElementById("y_axis_dim");
  const latticeGrid = document.getElementById("lattice-grid");

  let currentEditingStep = null;
  let currentStepNotes = [];

  // Initialize Sequencer Grid
  for (let i = 0; i < 16; i++) {
    const stepBtn = document.createElement("div");
    stepBtn.style.height = "40px";
    stepBtn.style.background = "#444";
    stepBtn.style.borderRadius = "4px";
    stepBtn.style.cursor = "pointer";
    stepBtn.style.border = "2px solid #555";
    stepBtn.dataset.index = i;

    stepBtn.onclick = () => {
      openEditor(i);
    };

    grid.appendChild(stepBtn);
  }

  playBtn.onclick = () => {
    try {
      const isPlaying = vm.eval("$sequencer.is_playing").toString() === "true";
      if (isPlaying) {
        vm.eval("$sequencer.stop");
        playBtn.textContent = "Play";
        playBtn.style.background = "#007bff";
      } else {
        vm.eval("$sequencer.start");
        playBtn.textContent = "Stop";
        playBtn.style.background = "#dc3545";
      }
    } catch (e) {
      console.error("Sequencer play/stop error:", e);
    }
  };

  bpmInput.addEventListener("input", () => {
    bpmDisplay.textContent = bpmInput.value;
    try {
      vm.eval(`$sequencer.bpm = ${bpmInput.value}`);
    } catch (e) { console.error(e); }
  });

  rootFreqInput.addEventListener("change", () => {
    try {
      vm.eval(`$sequencer.root_freq = ${rootFreqInput.value}`);
    } catch (e) { console.error(e); }
  });

  yAxisSelect.addEventListener("change", () => {
    try {
      vm.eval(`$sequencer.y_axis_dim = ${yAxisSelect.value}`);
      if (currentEditingStep !== null) {
        renderLattice(currentEditingStep);
      }
    } catch (e) { console.error(e); }
  });

  closeModal.onclick = () => {
    modal.style.display = "none";
    currentEditingStep = null;

    // Update step visual status (active if has notes)
    // We should do this on modal close to refresh the grid color
    updateGridVisuals();
  };

  function updateGridVisuals() {
    for (let i = 0; i < 16; i++) {
      const stepBtn = grid.children[i];
      try {
        const json = vm.eval(`$sequencer.get_step_notes_json(${i})`).toString();
        const notes = JSON.parse(json);
        if (notes.length > 0) {
          stepBtn.style.background = "#4dabf7";
        } else {
          stepBtn.style.background = "#444";
        }
      } catch(e) {}
    }
  }

  function openEditor(stepIndex) {
    currentEditingStep = stepIndex;
    modalStepNum.textContent = stepIndex + 1;
    modal.style.display = "flex";

    try {
      const currentDim = vm.eval("$sequencer.y_axis_dim").toString();
      yAxisSelect.value = currentDim;
    } catch(e) {}

    renderLattice(stepIndex);
  }

  function renderLattice(stepIndex) {
    latticeGrid.innerHTML = "";

    try {
      const json = vm.eval(`$sequencer.get_step_notes_json(${stepIndex})`).toString();
      currentStepNotes = JSON.parse(json);
    } catch(e) { console.error(e); return; }

    const currentDim = parseInt(yAxisSelect.value);

    // Grid: X: -3 to 3 (7 cols), Y: 2 to -2 (5 rows)
    for (let y = 2; y >= -2; y--) {
      for (let x = -3; x <= 3; x++) {
        const cell = document.createElement("div");
        cell.style.background = "#222";
        cell.style.color = "#fff";
        cell.style.display = "flex";
        cell.style.alignItems = "center";
        cell.style.justifyContent = "center";
        cell.style.height = "50px";
        cell.style.cursor = "pointer";
        cell.style.fontSize = "0.8rem";
        cell.style.border = "1px solid #333";
        cell.style.userSelect = "none";

        // Find notes
        const note = currentStepNotes.find(n => {
            let match = (n.b === x);
            if (currentDim === 3) match = match && (n.c === y);
            if (currentDim === 4) match = match && (n.d === y);
            if (currentDim === 5) match = match && (n.e === y);
            return match;
        });

                if (note) {
                  cell.style.background = "#4dabf7";
                  if (note.a > 0) cell.textContent = `↑${note.a}`;
                  else if (note.a < 0) cell.textContent = `↓${Math.abs(note.a)}`;
                  // Hide 0
                }
        
                cell.onclick = () => {
                  vm.eval(`$sequencer.toggle_note(${stepIndex}, ${x}, ${y})`);
                  renderLattice(stepIndex);
                };
                
                latticeGrid.appendChild(cell);
              }
            }
          }
        
          // Keyboard handler for Modal (Shift Grid)
          window.addEventListener("keydown", (e) => {
            if (modal.style.display === "none" || currentEditingStep === null) return;
            
            let dx = 0;
            let dy = 0;
            
            switch(e.key) {
              case "ArrowUp":    dy = 1; break;
              case "ArrowDown":  dy = -1; break;
              case "ArrowLeft":  dx = -1; break;
              case "ArrowRight": dx = 1; break;
              default: return;
            }
            
            e.preventDefault();
            try {
              // Call Ruby shift method
              // We pass dx, dy. The method checks bounds.
              const result = vm.eval(`$sequencer.shift_step_notes(${currentEditingStep}, ${dx}, ${dy})`).toString();
              if (result === "true") {
                renderLattice(currentEditingStep);
              }
            } catch(err) {
              console.error(err);
            }
          });
        }
function setupVisualizer(vm) {
  const canvas = document.getElementById("visualizer");
  const canvasCtx = canvas.getContext("2d");

  vm.eval("JS.global[:synthAnalyser] = $synth.analyser_node");
  const analyser = window.synthAnalyser;

  if (!analyser) {
    console.error("Analyser node not found");
    return;
  }

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  let vizMode = "waveform";

  document.querySelectorAll('input[name="viz_mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      vizMode = e.target.value;
    });
  });

  function draw() {
    requestAnimationFrame(draw);

    canvasCtx.fillStyle = "rgb(20, 20, 20)";
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = "rgb(77, 171, 247)";
    canvasCtx.fillStyle = "rgb(77, 171, 247)";

    if (vizMode === "waveform") {
      analyser.getByteTimeDomainData(dataArray);
      canvasCtx.beginPath();
      const sliceWidth = canvas.width * 1.0 / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;

        if (i === 0) canvasCtx.moveTo(x, y);
        else canvasCtx.lineTo(x, y);

        x += sliceWidth;
      }
      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    } else {
      analyser.getByteFrequencyData(dataArray);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 255.0 * canvas.height;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    }
  }

  draw();
}

function setupUI(vm) {
  uiIds.forEach(id => {
    const el = document.getElementById(id);
    const display = document.getElementById(`val_${id}`);

    updateParam(vm, id, el);

    el.addEventListener("input", () => {
      if (display) {
        let val = el.value;
        if (id === 'cutoff') val += ' Hz';
        if (id === 'attack' || id === 'decay' || id === 'release' || id === 'delay_time' || id === 'reverb_seconds') val += ' s';
        if (id === 'lfo_rate') val += ' Hz';
        display.textContent = val;
      }
      updateParam(vm, id, el);
    });
  });
}

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

function setupKeyboard(vm) {
  const getFreq = (note) => 440.0 * Math.pow(2.0, (note - 69) / 12.0);

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const note = keyMap[e.key];
    if (note) {
      vm.eval(`$synth.note_on(${getFreq(note)})`);
    }
  });

  window.addEventListener("keyup", (e) => {
    const note = keyMap[e.key];
    if (note) {
      vm.eval(`$synth.note_off(${getFreq(note)})`);
    }
  });
}

main();