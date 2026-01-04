import { DefaultRubyVM } from "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.7.1/dist/esm/browser.js";

const startBtn = document.getElementById("start-btn");
const overlay = document.getElementById("start-overlay");

const CELL_WIDTH = 10; // px

// State
let chords = {}; // { "Name": [ {a,b,c,d,e}, ... ] }
const CHORD_STORAGE_KEY = "ruby_synth_chords";

// UI Elements
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

const main = async () => {
  // Pre-load Ruby VM
  const response = await fetch("https://cdn.jsdelivr.net/npm/@ruby/3.3-wasm-wasi@2.7.1/dist/ruby.wasm");
  const buffer = await response.arrayBuffer();
  const module = await WebAssembly.compile(buffer);
  const { vm } = await DefaultRubyVM(module);

  window.rubyVM = vm;
  console.log("Ruby VM loaded");

  startBtn.onclick = async () => {
    if (!window.audioCtx) window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (window.audioCtx.state === 'suspended') await window.audioCtx.resume();
    overlay.style.display = "none";

    console.log("Loading Ruby scripts...");
    const scriptRes = await fetch(`src/synthesizer.rb?_=${Date.now()}`);
    if (scriptRes.ok) vm.eval(await scriptRes.text());
    const seqRes = await fetch(`src/sequencer.rb?_=${Date.now()}`);
    if (seqRes.ok) vm.eval(await seqRes.text());

    // Init Sequencer & Synth
    vm.eval("$sequencer = Sequencer.new(JS.eval('return window.audioCtx;'))");
    vm.eval("$synth = $sequencer.current_track.synth");

    // Create a standalone synth for Chord Preview
    vm.eval("$previewSynth = Synthesizer.new(JS.eval('return window.audioCtx;'))");

    console.log("Initialized");

    loadChords();
    setupTabs();
    setupUI(vm);
    setupKeyboard(vm);
    setupVisualizer(vm);
    setupSequencer(vm);
    setupPresets(vm);
    setupChordView(vm);
  };
};

function loadChords() {
  try {
    const raw = localStorage.getItem(CHORD_STORAGE_KEY);
    chords = raw ? JSON.parse(raw) : {};
  } catch(e) { console.error(e); chords = {}; }
}

function saveChords() {
  localStorage.setItem(CHORD_STORAGE_KEY, JSON.stringify(chords));
}

// --- Chord View Logic ---

let currentChordName = "";
let currentChordNotes = [];
let chordSelectedCell = null;

function setupChordView(vm) {
  const nameInput = document.getElementById("chord-name-input");
  const saveBtn = document.getElementById("save-chord-btn");
  const createBtn = document.getElementById("create-chord-btn");
  const listContainer = document.getElementById("chord-list");
  const editorGrid = document.getElementById("chord-editor-grid");
  const yAxisSel = document.getElementById("chord-y-axis");
  const previewSel = document.getElementById("chord-preview-preset");

  // Populate Preview Presets (sync with main presets)
  function updatePreviewPresets() {
    const presets = window.getPresets ? window.getPresets() : {};
    previewSel.innerHTML = '<option value="">-- Preview Sound --</option>';
    Object.keys(presets).forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      previewSel.appendChild(opt);
    });
  }
  window.addEventListener("presetsUpdated", updatePreviewPresets);
  updatePreviewPresets();

  previewSel.onchange = (e) => {
    const name = e.target.value;
    if (name) {
       const presets = window.getPresets();
       if (presets[name]) {
         window._tempPreviewJson = presets[name];
         vm.eval(`$previewSynth.import_settings(JS.global[:_tempPreviewJson])`);
       }
    }
  };

  createBtn.onclick = () => {
    currentChordName = "";
    currentChordNotes = [];
    nameInput.value = "";
    renderChordEditor();
  };

  saveBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) return alert("Please enter a chord name.");
    if (currentChordNotes.length === 0) return alert("Chord is empty.");

    chords[name] = currentChordNotes;
    saveChords();
    renderChordList();
    alert(`Chord "${name}" saved!`);
  };

  yAxisSel.onchange = () => renderChordEditor();

  function renderChordList() {
    listContainer.innerHTML = "";
    Object.keys(chords).forEach(name => {
      const item = document.createElement("div");
      item.style.background = "#444";
      item.style.padding = "5px";
      item.style.borderRadius = "4px";
      item.style.cursor = "pointer";
      item.style.display = "flex";
      item.style.alignItems = "center";
      item.style.gap = "10px";

      // Thumbnail
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 40;
      drawTetrisShape(canvas.getContext("2d"), chords[name], 40, 40);

      const label = document.createElement("span");
      label.textContent = name;
      label.style.flexGrow = "1";

      const delBtn = document.createElement("span");
      delBtn.className = "material-icons";
      delBtn.textContent = "delete";
      delBtn.style.fontSize = "1rem";
      delBtn.style.color = "#aaa";
      delBtn.onclick = (e) => {
        e.stopPropagation();
        if(confirm(`Delete chord "${name}"?`)){
          delete chords[name];
          saveChords();
          renderChordList();
        }
      };

      item.onclick = () => {
        currentChordName = name;
        // Deep copy notes
        currentChordNotes = JSON.parse(JSON.stringify(chords[name]));
        nameInput.value = name;
        renderChordEditor();
      };

      item.appendChild(canvas);
      item.appendChild(label);
      item.appendChild(delBtn);
      listContainer.appendChild(item);
    });
  }

  function renderChordEditor() {
    const dim = parseInt(yAxisSel.value);

    // Generic Lattice Renderer
    renderGenericLattice(editorGrid, currentChordNotes, dim, chordSelectedCell, (x, y) => {
        // Toggle Logic (JS side only for Chord Editor)
        // Find existing note ignoring octave
        // Coordinates: b=x, [c,d,e]=y
        const idx = currentChordNotes.findIndex(n => {
            let match = (n.b === x);
            if (dim === 3) match &= (n.c === y);
            else if (dim === 4) match &= (n.d === y);
            else if (dim === 5) match &= (n.e === y);
            return match;
        });

        if (idx >= 0) {
            currentChordNotes.splice(idx, 1);
        } else {
            const newNote = { a: 0, b: x, c: 0, d: 0, e: 0 };
            if (dim === 3) newNote.c = y;
            else if (dim === 4) newNote.d = y;
            else if (dim === 5) newNote.e = y;
            currentChordNotes.push(newNote);

            // Audition
            playPreviewNote(newNote);
        }

        chordSelectedCell = {x, y};
        renderChordEditor();
    });
  }

  function playPreviewNote(noteObj) {
      try {
          const freqStr = vm.eval(`
            n = NoteCoord.new(${noteObj.a}, ${noteObj.b}, ${noteObj.c}, ${noteObj.d}, ${noteObj.e})
            $sequencer.calculate_freq(n)
          `).toString();
          const freq = parseFloat(freqStr);
          const now = window.audioCtx.currentTime;
          vm.eval(`$previewSynth.schedule_note(${freq}, ${now}, 0.3)`);
      } catch(e) { console.error(e); }
  }

  // Handle Keyboard for editor
  window.addEventListener("keydown", (e) => {
      const viewChord = document.getElementById("view-chord");
      if (!viewChord.classList.contains("active")) return;
      if (!chordSelectedCell) return;

      // Shift Octave logic for selected cell
      if (e.key === "+" || e.key === "=" || e.key === "-") {
          const delta = (e.key === "+" || e.key === "=") ? 1 : -1;
          const dim = parseInt(yAxisSel.value);
          const note = currentChordNotes.find(n => {
              let match = (n.b === chordSelectedCell.x);
              if (dim === 3) match &= (n.c === chordSelectedCell.y);
              else if (dim === 4) match &= (n.d === chordSelectedCell.y);
              else if (dim === 5) match &= (n.e === chordSelectedCell.y);
              return match;
          });

          if (note) {
              note.a += delta;
              playPreviewNote(note);
              renderChordEditor();
          }
      }

      // Move Selection
      let dx = 0, dy = 0;
      if(e.key === "ArrowUp") dy = 1;
      if(e.key === "ArrowDown") dy = -1;
      if(e.key === "ArrowLeft") dx = -1;
      if(e.key === "ArrowRight") dx = 1;

      if (dx !== 0 || dy !== 0) {
          chordSelectedCell.x += dx;
          chordSelectedCell.y += dy;
          // Bounds
          if(chordSelectedCell.x < -3) chordSelectedCell.x = -3;
          if(chordSelectedCell.x > 3) chordSelectedCell.x = 3;
          if(chordSelectedCell.y < -2) chordSelectedCell.y = -2;
          if(chordSelectedCell.y > 2) chordSelectedCell.y = 2;

          renderChordEditor();
          e.preventDefault();
      }
  });

  renderChordList();
  renderChordEditor();
}

// --- Common Logic ---

function renderGenericLattice(container, notes, dim, selectedCell, onToggle) {
    container.innerHTML = "";
    // Grid: X: -3 to 3 (7 cols), Y: 2 to -2 (5 rows)
    for (let y = 2; y >= -2; y--) {
      for (let x = -3; x <= 3; x++) {
        const cell = document.createElement("div");
        cell.style.background = "#222";
        cell.style.color = "#fff";
        cell.style.display = "flex";
        cell.style.alignItems = "center";
        cell.style.justifyContent = "center";
        cell.style.aspectRatio = "1 / 1";
        cell.style.cursor = "pointer";
        cell.style.fontSize = "0.8rem";
        cell.style.border = "1px solid #333";
        cell.style.userSelect = "none";

        // Selection
        if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
          cell.style.borderColor = "#fff";
          cell.style.boxShadow = "inset 0 0 0 2px #fff";
          cell.style.zIndex = "10";
        }

        // Find Note
        const note = notes.find(n => {
            let match = (n.b === x);
            if (dim === 3) match = match && (n.c === y);
            if (dim === 4) match = match && (n.d === y);
            if (dim === 5) match = match && (n.e === y);
            return match;
        });

        if (note) {
          cell.style.background = "#4dabf7";
          if (note.a > 0) cell.textContent = `↑${note.a}`;
          else if (note.a < 0) cell.textContent = `↓${Math.abs(note.a)}`;
        }

        cell.onclick = () => onToggle(x, y);
        container.appendChild(cell);
      }
    }
}

function drawTetrisShape(ctx, notes, w, h) {
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, w, h);
    if (!notes || notes.length === 0) return;

    // Use (b, c) for visualization default
    const coords = notes.map(n => ({ x: n.b, y: n.c }));

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    coords.forEach(p => {
        if(p.x < minX) minX = p.x;
        if(p.x > maxX) maxX = p.x;
        if(p.y < minY) minY = p.y;
        if(p.y > maxY) maxY = p.y;
    });

    const rangeX = maxX - minX + 1;
    const rangeY = maxY - minY + 1;
    const cellSize = Math.min(w / (rangeX + 2), h / (rangeY + 2), 10);

    const offsetX = (w - rangeX * cellSize) / 2 - minX * cellSize;
    const offsetY = (h - rangeY * cellSize) / 2; // relative to bounding box top

    coords.forEach(p => {
        const cx = offsetX + p.x * cellSize;
        const cy = offsetY + (maxY - p.y) * cellSize;

        ctx.fillStyle = "#4dabf7";

        // Root (0,0) check
        if (p.x === 0 && p.y === 0) {
            ctx.beginPath();
            ctx.arc(cx + cellSize/2, cy + cellSize/2, cellSize/2 - 1, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "white";
            ctx.lineWidth = 1;
            ctx.stroke();
        } else {
            // Rounded rect
            const r = 2;
            ctx.beginPath();
            ctx.roundRect(cx + 1, cy + 1, cellSize - 2, cellSize - 2, r);
            ctx.fill();
        }
    });
}

// --- Tabs ---
function setupTabs() {
  const tabSynth = document.getElementById("tab-synth");
  const tabSeq = document.getElementById("tab-seq");
  const tabChord = document.getElementById("tab-chord");
  const viewSynth = document.getElementById("view-synthesizer");
  const viewSeq = document.getElementById("view-sequencer");
  const viewChord = document.getElementById("view-chord");

  function switchTab(view) {
    [tabSynth, tabSeq, tabChord].forEach(t => t.classList.remove("active"));
    [viewSynth, viewSeq, viewChord].forEach(v => v.classList.remove("active"));

    if (view === "synth") {
      tabSynth.classList.add("active");
      viewSynth.classList.add("active");
    } else if (view === "seq") {
      tabSeq.classList.add("active");
      viewSeq.classList.add("active");
      window.dispatchEvent(new Event("trackChanged"));
    } else if (view === "chord") {
      tabChord.classList.add("active");
      viewChord.classList.add("active");
    }
  }

  tabSynth.onclick = () => switchTab("synth");
  tabSeq.onclick = () => switchTab("seq");
  tabChord.onclick = () => switchTab("chord");
}

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
  } catch(e) { console.error(e); }
}

function setupPresets(vm) {
  const nameInput = document.getElementById("preset_name");
  const saveBtn = document.getElementById("save_preset");
  const listSelect = document.getElementById("preset_list");
  const loadBtn = document.getElementById("load_preset");
  const deleteBtn = document.getElementById("delete_preset");
  const STORAGE_KEY = "ruby_synth_presets";

  window.getPresets = function() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  }
  function savePresets(presets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    updateList();
    window.dispatchEvent(new Event("presetsUpdated"));
  }
  function updateList() {
    const presets = window.getPresets();
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
      const presets = window.getPresets();
      presets[name] = json;
      savePresets(presets);
      alert(`Preset "${name}" saved!`);
      nameInput.value = "";
    } catch(e) { console.error(e); }
  };
  loadBtn.onclick = () => {
    const name = listSelect.value;
    if (!name) return;
    const presets = window.getPresets();
    if (presets[name]) {
        window._tempPresetJson = presets[name];
        vm.eval(`$synth.import_settings(JS.global[:_tempPresetJson])`);
        updateUIFromSettings(presets[name]);
    }
  };
  deleteBtn.onclick = () => {
    const name = listSelect.value;
    if (!name && confirm(`Delete preset "${name}"?`)) {
        const presets = window.getPresets();
        delete presets[name];
        savePresets(presets);
    }
  };
}

// Global callback for Playhead
window.updatePlayhead = (stepIndex) => {
  try {
      const idx = Number(stepIndex);
      const container = document.getElementById("sequencer-rows");
      if (!container) return;

      const oldPlayheads = container.querySelectorAll(".playhead-cursor");
      oldPlayheads.forEach(el => el.remove());

      const grids = container.querySelectorAll(".timeline-grid");
      grids.forEach(grid => {
         const cursor = document.createElement("div");
         cursor.className = "playhead-cursor";
         cursor.style.position = "absolute";
         cursor.style.top = "0";
         cursor.style.bottom = "0";
         cursor.style.width = "2px";
         cursor.style.background = "#fff";
         cursor.style.boxShadow = "0 0 4px #fff";
         cursor.style.left = `${idx * CELL_WIDTH}px`;
         cursor.style.zIndex = "10";
         cursor.style.pointerEvents = "none";
         grid.appendChild(cursor);
      });

      const scrollContainer = document.getElementById("master-scroll-container");
      if (scrollContainer) {
          const left = idx * CELL_WIDTH;
          const width = scrollContainer.clientWidth;
          if (left < scrollContainer.scrollLeft || left > scrollContainer.scrollLeft + width) {
              scrollContainer.scrollLeft = left - width / 2;
          }
      }
  } catch (e) {
      console.error("Error in updatePlayhead:", e);
  }
};

function setupSequencer(vm) {
  const rowsContainer = document.getElementById("sequencer-rows");
  const playBtn = document.getElementById("seq-play-btn");
  const addTrackBtn = document.getElementById("add_track_btn");
  const bpmInput = document.getElementById("bpm");
  const bpmDisplay = document.getElementById("val_bpm");
  const measuresInput = document.getElementById("measures");
  const measuresDisplay = document.getElementById("val_measures");
  const rootFreqInput = document.getElementById("root_freq");
  const yAxisSelect = document.getElementById("y_axis_dim");

  // Chord Selector Modal
  const selectorModal = document.getElementById("chord-selector-modal");
  const selectorClose = document.getElementById("close-chord-selector");
  const selectorList = document.getElementById("selector-list");

  let isDrawing = false;
  let drawStartStep = 0;
  let drawTrackIndex = -1;
  let ghostBlock = null;

  function renderSequencer() {
    rowsContainer.innerHTML = "";
    let tracksCount = 0;
    let currentTrackIndex = 0;
    let totalSteps = 128;

    try {
        tracksCount = parseInt(vm.eval("$sequencer.tracks.length").toString());
        currentTrackIndex = parseInt(vm.eval("$sequencer.current_track_index").toString());
        totalSteps = parseInt(vm.eval("$sequencer.total_steps").toString());
    } catch(e) { return; }

    const scrollContainer = document.getElementById("master-scroll-container") || document.createElement("div");
    if (!scrollContainer.id) {
        scrollContainer.id = "master-scroll-container";
        // ... (styles) ...
        scrollContainer.style.overflowX = "scroll";
        scrollContainer.style.overflowY = "hidden";
        scrollContainer.style.marginTop = "10px";
        scrollContainer.style.marginBottom = "10px";
        scrollContainer.style.border = "1px solid #444";
        scrollContainer.style.background = "#222";
        scrollContainer.style.height = "15px";
    }

    // Clear and rebuild scroll spacer
    scrollContainer.innerHTML = "";
    const scrollSpacer = document.createElement("div");
    scrollSpacer.style.width = `${totalSteps * CELL_WIDTH}px`;
    scrollSpacer.style.height = "1px";
    scrollContainer.appendChild(scrollSpacer);

    scrollContainer.onscroll = (e) => {
        const left = e.target.scrollLeft;
        document.querySelectorAll(".timeline-wrapper").forEach(wrapper => wrapper.scrollLeft = left);
        window._lastScrollLeft = left;
    };

    setTimeout(() => { if(window._lastScrollLeft) scrollContainer.scrollLeft = window._lastScrollLeft; }, 0);

    for (let t = 0; t < tracksCount; t++) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "0";
        row.style.alignItems = "stretch";
        row.style.marginBottom = "10px";
        row.style.height = "80px";
        row.style.flexShrink = "0";

        // Track Controls
        const controlDiv = document.createElement("div");
        controlDiv.style.display = "flex";
        controlDiv.style.flexDirection = "column";
        controlDiv.style.width = "140px";
        controlDiv.style.flexShrink = "0";
        controlDiv.style.borderRight = "1px solid #555";
        controlDiv.style.paddingRight = "10px";
        controlDiv.style.marginRight = "10px";
        controlDiv.style.justifyContent = "center";
        controlDiv.style.gap = "5px";

        const labelBtn = document.createElement("button");
        labelBtn.textContent = `Track ${t + 1}`;
        labelBtn.style.padding = "4px";
        labelBtn.style.fontSize = "0.8rem";
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

        const presetSel = document.createElement("select");
        presetSel.style.fontSize = "0.8rem";
        presetSel.style.padding = "2px";
        presetSel.style.width = "100%";
        const presets = window.getPresets ? window.getPresets() : {};
        presetSel.innerHTML = '<option value="">(Default)</option>';
        Object.keys(presets).forEach(name => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            presetSel.appendChild(opt);
        });
        try {
            presetSel.value = vm.eval(`$sequencer.tracks[${t}].preset_name`).toString();
        } catch(e) {}
        presetSel.onchange = (e) => {
            const name = e.target.value;
            if (name && presets[name]) {
                window._tempTrackPresetJson = presets[name];
                vm.eval(`$sequencer.tracks[${t}].synth.import_settings(JS.global[:_tempTrackPresetJson])`);
                vm.eval(`$sequencer.tracks[${t}].preset_name = "${name}"`);
            }
        };

        const removeBtn = document.createElement("button");
        removeBtn.innerHTML = '<span class="material-icons" style="font-size: 1.2rem;">delete</span>';
        removeBtn.style.padding = "4px";
        removeBtn.style.background = "#dc3545";
        removeBtn.style.color = "white";
        removeBtn.style.border = "none";
        removeBtn.style.cursor = "pointer";
        removeBtn.onclick = () => removeTrack(t);

        const muteBtn = document.createElement("button");
        let isMuted = false;
        try { isMuted = vm.eval(`$sequencer.tracks[${t}].mute`).toString() === "true"; } catch(e) {}
        muteBtn.innerHTML = `<span class="material-icons" style="font-size: 1.2rem;">${isMuted ? "volume_off" : "volume_up"}</span>`;
        muteBtn.style.padding = "4px";
        muteBtn.style.background = isMuted ? "#6c757d" : "#444";
        muteBtn.style.color = "white";
        muteBtn.style.border = "1px solid #555";
        muteBtn.style.cursor = "pointer";
        muteBtn.onclick = () => {
            vm.eval(`$sequencer.tracks[${t}].mute = ${!isMuted}`);
            renderSequencer();
        };

        const soloBtn = document.createElement("button");
        let isSolo = false;
        try { isSolo = vm.eval(`$sequencer.tracks[${t}].solo`).toString() === "true"; } catch(e) {}
        soloBtn.innerHTML = `<span class="material-icons" style="font-size: 1.2rem;">${isSolo ? "grade" : "star_outline"}</span>`;
        soloBtn.style.padding = "4px";
        soloBtn.style.background = isSolo ? "#fcc419" : "#444";
        soloBtn.style.color = isSolo ? "black" : "white";
        soloBtn.style.border = "1px solid #555";
        soloBtn.style.cursor = "pointer";
        soloBtn.onclick = () => {
            vm.eval(`$sequencer.tracks[${t}].solo = ${!isSolo}`);
            renderSequencer();
        };

        const knobContainer = document.createElement("div");
        knobContainer.style.display = "flex";
        knobContainer.style.alignItems = "center";
        knobContainer.style.justifyContent = "center";
        knobContainer.style.cursor = "ns-resize";
        knobContainer.title = "Volume";
        const knobIcon = document.createElement("span");
        knobIcon.className = "material-icons";
        knobIcon.textContent = "arrow_circle_up";
        knobIcon.style.fontSize = "1.5rem";
        knobIcon.style.color = "#4dabf7";
        let currentVol = 1.0;
        try { currentVol = parseFloat(vm.eval(`$sequencer.tracks[${t}].volume`).toString()); } catch(e) {}
        knobIcon.style.transform = `rotate(${(currentVol - 1.0) * 160}deg)`;
        knobContainer.appendChild(knobIcon);

        knobContainer.onmousedown = (e) => {
            const startY = e.clientY;
            const startVol = currentVol;
            const onMove = (me) => {
                let nv = startVol + (startY - me.clientY) / 100;
                if(nv < 0) nv = 0; if(nv > 2) nv = 2;
                vm.eval(`$sequencer.tracks[${t}].volume = ${nv}`);
                knobIcon.style.transform = `rotate(${(nv - 1.0) * 160}deg)`;
            };
            const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        };

        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.gap = "2px";
        btnRow.appendChild(removeBtn);
        btnRow.appendChild(muteBtn);
        btnRow.appendChild(soloBtn);
        btnRow.appendChild(knobContainer);

        controlDiv.appendChild(labelBtn);
        controlDiv.appendChild(presetSel);
        controlDiv.appendChild(btnRow);
        row.appendChild(controlDiv);

        const timelineWrapper = document.createElement("div");
        timelineWrapper.className = "timeline-wrapper";
        timelineWrapper.style.flexGrow = "1";
        timelineWrapper.style.overflowX = "hidden";
        timelineWrapper.style.overflowY = "hidden";
        timelineWrapper.style.position = "relative";
        timelineWrapper.style.background = "#222";
        timelineWrapper.style.border = "1px solid #444";

        const grid = document.createElement("div");
        grid.className = "timeline-grid";
        grid.style.width = `${totalSteps * CELL_WIDTH}px`;
        grid.style.height = "100%";
        grid.style.position = "relative";
        grid.dataset.track = t;
        grid.style.backgroundImage = `repeating-linear-gradient(90deg,#888 0px,#888 1px,transparent 1px,transparent ${CELL_WIDTH * 32}px),repeating-linear-gradient(90deg,#555 0px,#555 1px,transparent 1px,transparent ${CELL_WIDTH * 8}px),repeating-linear-gradient(90deg,#333 0px,#333 1px,transparent 1px,transparent ${CELL_WIDTH}px)`;

        // Mouse Draw
        grid.onmousedown = (e) => {
            if (e.target.classList.contains("block") || e.target.tagName === "CANVAS") return;
            isDrawing = true;
            drawTrackIndex = t;
            drawStartStep = Math.floor((e.clientX - grid.getBoundingClientRect().left) / CELL_WIDTH);
            ghostBlock = document.createElement("div");
            ghostBlock.style.position = "absolute";
            ghostBlock.style.height = "100%";
            ghostBlock.style.background = "rgba(77, 171, 247, 0.5)";
            ghostBlock.style.left = `${drawStartStep * CELL_WIDTH}px`;
            ghostBlock.style.width = `${CELL_WIDTH}px`;
            ghostBlock.style.pointerEvents = "none";
            grid.appendChild(ghostBlock);
        };
        grid.onmousemove = (e) => {
            if (!isDrawing || drawTrackIndex !== t) return;
            const cur = Math.floor((e.clientX - grid.getBoundingClientRect().left) / CELL_WIDTH);
            const s = Math.min(drawStartStep, cur);
            const len = Math.max(drawStartStep, cur) - s + 1;
            ghostBlock.style.left = `${s * CELL_WIDTH}px`;
            ghostBlock.style.width = `${len * CELL_WIDTH}px`;
        };

        // Render Blocks
        try {
            const blocksJson = vm.eval(`$sequencer.get_track_blocks_json(${t})`).toString();
            const blocks = JSON.parse(blocksJson);
            blocks.forEach(b => {
                const blockDiv = document.createElement("div");
                blockDiv.className = "block";
                blockDiv.style.position = "absolute";
                blockDiv.style.left = `${b.start * CELL_WIDTH}px`;
                blockDiv.style.width = `${b.length * CELL_WIDTH}px`;
                blockDiv.style.height = "100%";
                blockDiv.style.background = b.notes_count > 0 ? "#4dabf7" : "#555";
                blockDiv.style.border = "1px solid #fff";
                blockDiv.style.borderRadius = "4px";
                blockDiv.style.cursor = "pointer";
                blockDiv.style.zIndex = "5";
                blockDiv.style.display = "flex";
                blockDiv.style.alignItems = "center";
                blockDiv.style.justifyContent = "center";
                blockDiv.title = b.chord_name || `Start: ${b.start}`;

                // Render Tetris Shape inside Block
                const canvas = document.createElement("canvas");
                // dynamic width based on block?
                const cw = b.length * CELL_WIDTH - 4;
                const ch = 76; // 80 - border
                canvas.width = cw > 0 ? cw : 1;
                canvas.height = ch;
                // We need the notes to draw
                try {
                    const notesJson = vm.eval(`$sequencer.get_block_notes_json(${t}, ${b.start})`).toString();
                    const notes = JSON.parse(notesJson);
                    drawTetrisShape(canvas.getContext("2d"), notes, cw, ch);
                } catch(e){}

                blockDiv.appendChild(canvas);

                blockDiv.onclick = (e) => {
                    e.stopPropagation();
                    openChordSelector(t, b.start);
                };
                blockDiv.oncontextmenu = (e) => {
                    e.preventDefault();
                    if(confirm("Delete block?")) {
                        vm.eval(`$sequencer.remove_block(${t}, ${b.start})`);
                        renderSequencer();
                    }
                };
                grid.appendChild(blockDiv);
            });
        } catch(e){}

        timelineWrapper.appendChild(grid);
        row.appendChild(timelineWrapper);
        rowsContainer.appendChild(row);
    } // end tracks loop

    // Append master scroll
    const scrollRow = document.createElement("div");
    scrollRow.style.display = "flex";
    const spacer = document.createElement("div");
    spacer.style.width = "150px"; spacer.style.flexShrink = "0";
    scrollContainer.style.flexGrow = "1";
    scrollRow.appendChild(spacer);
    scrollRow.appendChild(scrollContainer);
    rowsContainer.appendChild(scrollRow);
  } // end renderSequencer

  function openChordSelector(trackIdx, startStep) {
      selectorList.innerHTML = "";

      const chordNames = Object.keys(chords);
      if (chordNames.length === 0) {
          selectorList.innerHTML = "<div style='grid-column: 1/-1; text-align: center; color: #aaa; padding: 20px;'>No chords saved. Create one in the Chord tab.</div>";
          selectorModal.style.display = "flex";
          return;
      }

      // Add existing chords
      chordNames.forEach(name => {
          const item = document.createElement("div");
          item.style.background = "#444";
          item.style.padding = "5px";
          item.style.borderRadius = "4px";
          item.style.cursor = "pointer";
          item.style.textAlign = "center";

          const cvs = document.createElement("canvas");
          cvs.width = 80; cvs.height = 80;
          drawTetrisShape(cvs.getContext("2d"), chords[name], 80, 80);

          const lbl = document.createElement("div");
          lbl.textContent = name;
          lbl.style.marginTop = "5px";
          lbl.style.fontSize = "0.9rem";

          item.appendChild(cvs);
          item.appendChild(lbl);

          item.onclick = () => {
              applyChordToBlock(trackIdx, startStep, name, chords[name]);
              selectorModal.style.display = "none";
          };

          selectorList.appendChild(item);
      });

      selectorModal.style.display = "flex";
  }

  selectorClose.onclick = () => selectorModal.style.display = "none";

  function applyChordToBlock(t, s, name, notes) {
      const json = JSON.stringify(notes);
      window._tempChordNotes = json;

      vm.eval(`$sequencer.update_block_notes(${t}, ${s}, JS.global[:_tempChordNotes])`);
      vm.eval(`
        t = $sequencer.tracks[${t}]
        b = t.blocks.find { |blk| blk.start_step == ${s} }
        b.chord_name = "${name}" if b
      `);

      renderSequencer();
  }

  // ... (Other handlers like window.mouseup for drawing blocks) ...
  window.addEventListener("mouseup", () => {
    if (isDrawing && ghostBlock) {
        const left = parseInt(ghostBlock.style.left);
        const width = parseInt(ghostBlock.style.width);
        const start = Math.round(left / CELL_WIDTH);
        const len = Math.round(width / CELL_WIDTH);
        try {
            vm.eval(`$sequencer.add_or_update_block(${drawTrackIndex}, ${start}, ${len})`);
            renderSequencer();
            openChordSelector(drawTrackIndex, start);
        } catch(e){ console.error(e); }
        ghostBlock = null;
    }
    isDrawing = false;
    drawTrackIndex = -1;
  });

  addTrackBtn.onclick = () => {
      try {
          vm.eval("$sequencer.add_track");
          renderSequencer();
      } catch(e) { console.error(e); }
  };
  playBtn.onclick = () => {
    try {
      const isPlaying = vm.eval("$sequencer.is_playing").toString() === "true";
      if (isPlaying) {
        vm.eval("$sequencer.stop");
        playBtn.innerHTML = '<span class="material-icons">play_arrow</span> Play';
        playBtn.style.background = "#007bff";
      } else {
        vm.eval("$sequencer.start");
        playBtn.innerHTML = '<span class="material-icons">stop</span> Stop';
        playBtn.style.background = "#dc3545";
      }
    } catch (e) { console.error("Sequencer play/stop error:", e); }
  };
  measuresInput.addEventListener("input", () => {
      try { vm.eval(`$sequencer.total_bars = ${measuresInput.value}`); renderSequencer(); } catch(e){}
  });
  bpmInput.addEventListener("input", () => { try{vm.eval(`$sequencer.bpm = ${bpmInput.value}`);}catch(e){} });
  rootFreqInput.addEventListener("change", () => { try{vm.eval(`$sequencer.root_freq = ${rootFreqInput.value}`);}catch(e){} });
  yAxisSelect.addEventListener("change", () => { try{vm.eval(`$sequencer.y_axis_dim = ${yAxisSelect.value}`);}catch(e){} });

  window.addEventListener("trackChanged", renderSequencer);
  renderSequencer();
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
        if (id.includes('time') || id.includes('attack') || id.includes('decay') || id.includes('release') || id.includes('seconds')) val += ' s';
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

function setupVisualizer(vm) {
  const canvas = document.getElementById("visualizer");
  const canvasCtx = canvas.getContext("2d");
  const bufferLength = 1024;
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
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i] / 255.0 * canvas.height;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    }
  }
  draw();
}

main();
