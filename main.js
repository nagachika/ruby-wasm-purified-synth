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

    // Instantiate Sequencer (it will create the first track and its synth)
    vm.eval("$sequencer = Sequencer.new(JS.eval('return window.audioCtx;'))");

    // Set global $synth to the first track's synth for UI binding
    vm.eval("$synth = $sequencer.current_track.synth");

    console.log("Sequencer and Synthesizer initialized");

    setupUI(vm);
    setupKeyboard(vm);
    setupVisualizer(vm);
    setupSequencer(vm);
    setupPresets(vm);
  };
};

function updateUIFromSettings(json) {
  try {
    const data = JSON.parse(json);
    for (const [key, val] of Object.entries(data)) {
      const el = document.getElementById(key);
      if (el) {
          if (el.type === "checkbox") {
            el.checked = val;
          } else {
            el.value = val;
          }
          const display = document.getElementById(`val_${key}`);
          if (display) {
            let text = val;
            if (key === 'cutoff') text += ' Hz';
            if (key.includes('time') || key.includes('attack') || key.includes('decay') || key.includes('release') || key.includes('seconds')) text += ' s';
            if (key === 'lfo_rate') text += ' Hz';
            display.textContent = text;
          }
      }
    }
  } catch(e) {
    console.error("Error updating UI from settings:", e);
  }
}

function setupPresets(vm) {
  const nameInput = document.getElementById("preset_name");
  const saveBtn = document.getElementById("save_preset");
  const listSelect = document.getElementById("preset_list");
  const loadBtn = document.getElementById("load_preset");
  const deleteBtn = document.getElementById("delete_preset");

  const STORAGE_KEY = "ruby_synth_presets";

  function getPresets() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  }

  function savePresets(presets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    updateList();
  }

  function updateList() {
    const presets = getPresets();
    listSelect.innerHTML = '<option value="">-- Select Preset --</option>';
    Object.keys(presets).forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      listSelect.appendChild(opt);
    });
  }

  updateList();

  saveBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) return alert("Please enter a preset name.");

    try {
      const json = vm.eval("$synth.export_settings").toString();
      const presets = getPresets();
      presets[name] = json;
      savePresets(presets);
      alert(`Preset "${name}" saved!`);
      nameInput.value = "";
    } catch(e) {
      console.error(e);
      alert("Failed to save preset.");
    }
  };

  loadBtn.onclick = () => {
    const name = listSelect.value;
    if (!name) return;

    const presets = getPresets();
    const json = presets[name];
    if (!json) return;

    try {
      // Load into Ruby
      window._tempPresetJson = json;
      vm.eval(`$synth.import_settings(JS.global[:_tempPresetJson])`);

      // Update UI
      updateUIFromSettings(json);
    } catch(e) {
      console.error(e);
      alert("Failed to load preset.");
    }
  };

  deleteBtn.onclick = () => {
    const name = listSelect.value;
    if (!name) return;
    if (!confirm(`Delete preset "${name}"?`)) return;

    const presets = getPresets();
    delete presets[name];
    savePresets(presets);
  };
}

// Global callback for Playhead
window.updatePlayhead = (stepIndex) => {
  const container = document.getElementById("sequencer-rows");
  if (!container) return;
  const rows = container.children;
  for (const row of rows) {
     const steps = row.querySelectorAll(".step-btn");
     for (let i = 0; i < steps.length; i++) {
        if (i === stepIndex) {
            steps[i].style.borderColor = "#fff";
            steps[i].style.boxShadow = "0 0 5px #fff";
        } else {
            steps[i].style.borderColor = "#555";
            steps[i].style.boxShadow = "none";
        }
     }
  }
};

function setupSequencer(vm) {
  const rowsContainer = document.getElementById("sequencer-rows");
  const playBtn = document.getElementById("seq-play-btn");
  const addTrackBtn = document.getElementById("add_track_btn");
  const bpmInput = document.getElementById("bpm");
  const bpmDisplay = document.getElementById("val_bpm");
  const rootFreqInput = document.getElementById("root_freq");

  // Modal Elements
  const modal = document.getElementById("grid-modal");
  const closeModal = document.getElementById("close-modal");
  const modalStepNum = document.getElementById("modal-step-num");
  const yAxisSelect = document.getElementById("y_axis_dim");
  const latticeGrid = document.getElementById("lattice-grid");

  let currentEditingTrack = null;
  let currentEditingStep = null;
  let currentStepNotes = [];
  let currentSelectedCell = null; // {x, y}

  function renderSequencer() {
    rowsContainer.innerHTML = "";
    let tracksCount = 0;
    let currentTrackIndex = 0;
    try {
        tracksCount = parseInt(vm.eval("$sequencer.tracks.length").toString());
        currentTrackIndex = parseInt(vm.eval("$sequencer.current_track_index").toString());
    } catch(e) { return; }

    for (let t = 0; t < tracksCount; t++) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "5px";
        row.style.alignItems = "center";

        // Track Controls
        const controlDiv = document.createElement("div");
        controlDiv.style.display = "flex";
        controlDiv.style.gap = "5px";
        controlDiv.style.minWidth = "120px";

        // Select Button / Label
        const labelBtn = document.createElement("button");
        labelBtn.textContent = `Track ${t + 1}`;
        labelBtn.style.flexGrow = "1";
        labelBtn.style.padding = "5px";
        labelBtn.style.border = "1px solid #555";
        labelBtn.style.cursor = "pointer";
        if (t === currentTrackIndex) {
            labelBtn.style.background = "#007bff";
            labelBtn.style.color = "white";
        } else {
            labelBtn.style.background = "#333";
            labelBtn.style.color = "#ccc";
        }
        labelBtn.onclick = () => selectTrack(t);

        // Remove Button
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "🗑"; // Trash icon
        removeBtn.style.padding = "5px";
        removeBtn.style.background = "#dc3545";
        removeBtn.style.color = "white";
        removeBtn.style.border = "none";
        removeBtn.style.cursor = "pointer";
        removeBtn.onclick = () => removeTrack(t);

        controlDiv.appendChild(removeBtn);
        controlDiv.appendChild(labelBtn);
        row.appendChild(controlDiv);

        // Steps
        for (let s = 0; s < 16; s++) {
            const stepBtn = document.createElement("div");
            stepBtn.className = "step-btn"; // Class for playhead targeting
            stepBtn.style.width = "30px";
            stepBtn.style.height = "30px";
            stepBtn.style.background = "#444";
            stepBtn.style.borderRadius = "2px";
            stepBtn.style.cursor = "pointer";
            stepBtn.style.border = "1px solid #555";
            stepBtn.dataset.track = t;
            stepBtn.dataset.step = s;

            // Check if active
            try {
                const json = vm.eval(`$sequencer.get_track_step_notes_json(${t}, ${s})`).toString();
                const notes = JSON.parse(json);
                if (notes.length > 0) {
                    stepBtn.style.background = "#4dabf7";
                }
            } catch(e) {}

            stepBtn.onclick = () => {
                // Ensure track is selected when editing?
                // It might be better to just select the track to update UI contex
                if (currentTrackIndex !== t) {
                    selectTrack(t);
                }
                openEditor(t, s);
            };

            row.appendChild(stepBtn);
        }

        rowsContainer.appendChild(row);
    }
  }

  function selectTrack(index) {
    try {
        vm.eval(`$sequencer.select_track(${index})`);

        // Update Synth UI
        const settings = vm.eval("$synth.export_settings").toString();
        updateUIFromSettings(settings);

        renderSequencer(); // Redraw to show selected state
    } catch(e) { console.error(e); }
  }

  function removeTrack(index) {
    if (!confirm(`Delete Track ${index + 1}?`)) return;
    try {
        vm.eval(`$sequencer.remove_track(${index})`);
        // Handle selection update if needed
        const newIdx = parseInt(vm.eval("$sequencer.current_track_index").toString());
        selectTrack(newIdx); // Will re-render
    } catch(e) { console.error(e); }
  }

  addTrackBtn.onclick = () => {
    try {
        vm.eval("$sequencer.add_track");
        const len = parseInt(vm.eval("$sequencer.tracks.length").toString());
        selectTrack(len - 1);
    } catch(e) { console.error(e); }
  };

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
    currentEditingTrack = null;
    currentSelectedCell = null;
    renderSequencer(); // Update visuals
  };

  window.addEventListener("trackChanged", () => {
    renderSequencer();
    if (modal.style.display !== "none" && currentEditingStep !== null) {
        renderLattice(currentEditingStep);
    }
  });

  // Initial render
  renderSequencer();

  function openEditor(trackIndex, stepIndex) {
    currentEditingTrack = trackIndex;
    currentEditingStep = stepIndex;
    modalStepNum.textContent = `T${trackIndex + 1} : Step ${stepIndex + 1}`;
    modal.style.display = "flex";

    try {
      const currentDim = vm.eval("$sequencer.y_axis_dim").toString();
      yAxisSelect.value = currentDim;
    } catch(e) {}

    renderLattice(stepIndex);
  }

  function renderLattice(stepIndex) {
    latticeGrid.innerHTML = "";
    if (currentEditingTrack === null) return;

    try {
      const json = vm.eval(`$sequencer.get_track_step_notes_json(${currentEditingTrack}, ${stepIndex})`).toString();
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

        // Selection highligh
        if (currentSelectedCell && currentSelectedCell.x === x && currentSelectedCell.y === y) {
          cell.style.borderColor = "#fff";
          cell.style.boxShadow = "inset 0 0 0 2px #fff";
          cell.style.zIndex = "10";
        }

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
          // Select and toggle
          currentSelectedCell = { x, y };
          vm.eval(`$sequencer.toggle_note(${stepIndex}, ${x}, ${y})`);
          renderLattice(stepIndex);
        };

        latticeGrid.appendChild(cell);
      }
    }
  }

  // Keyboard handler for Modal
  window.addEventListener("keydown", (e) => {
    if (modal.style.display === "none" || currentEditingStep === null) return;

    // Octave Shift (+/-)
    if (e.key === "+" || e.key === "=" || e.key === "-") {
      if (!currentSelectedCell) return;
      const delta = (e.key === "+" || e.key === "=") ? 1 : -1;

      try {
        vm.eval(`$sequencer.shift_octave(${currentEditingStep}, ${currentSelectedCell.x}, ${currentSelectedCell.y}, ${delta})`);
        renderLattice(currentEditingStep);
      } catch(err) { console.error(err); }
      return;
    }

    // Grid Shift (Arrows)
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
      const result = vm.eval(`$sequencer.shift_step_notes(${currentEditingStep}, ${dx}, ${dy})`).toString();
      if (result === "true") {
        if (currentSelectedCell) {
            currentSelectedCell.x += dx;
            currentSelectedCell.y += dy;
            // Bounds check
            if (currentSelectedCell.x < -3) currentSelectedCell.x = -3;
            if (currentSelectedCell.x > 3)  currentSelectedCell.x = 3;
            if (currentSelectedCell.y < -2) currentSelectedCell.y = -2;
            if (currentSelectedCell.y > 2)  currentSelectedCell.y = 2;
        }
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

  // Initial setup is handled by Sequencer -> select_track

  // Buffer length is usually constant for the same AudioContext/Analyser creation params
  // But if we create new Analyser, we should be careful.
  // Generally fftSize is 2048 (from synth.rb).
  const bufferLength = 1024; // fftSize / 2
  const dataArray = new Uint8Array(bufferLength);
  let vizMode = "waveform";

  document.querySelectorAll('input[name="viz_mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      vizMode = e.target.value;
    });
  });

  function draw() {
    requestAnimationFrame(draw);

    const analyser = window.synthAnalyser;
    if (!analyser) return;

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
