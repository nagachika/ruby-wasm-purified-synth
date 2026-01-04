import { DefaultRubyVM } from "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.7.1/dist/esm/browser.js";

const startBtn = document.getElementById("start-btn");
const overlay = document.getElementById("start-overlay");

const CELL_WIDTH = 10; // px

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

    setupTabs();
    setupUI(vm);
    setupKeyboard(vm);
    setupVisualizer(vm);
    setupSequencer(vm);
    setupPresets(vm);
  };
};

function setupTabs() {
  const tabSynth = document.getElementById("tab-synth");
  const tabSeq = document.getElementById("tab-seq");
  const viewSynth = document.getElementById("view-synthesizer");
  const viewSeq = document.getElementById("view-sequencer");

  function switchTab(view) {
    if (view === "synth") {
      tabSynth.classList.add("active");
      tabSeq.classList.remove("active");
      viewSynth.classList.add("active");
      viewSeq.classList.remove("active");
    } else {
      tabSynth.classList.remove("active");
      tabSeq.classList.add("active");
      viewSynth.classList.remove("active");
      viewSeq.classList.add("active");
      // Trigger sequencer render when switching to it
      window.dispatchEvent(new Event("trackChanged"));
    }
  }

  tabSynth.onclick = () => switchTab("synth");
  tabSeq.onclick = () => switchTab("seq");
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

  // Expose getPresets globally for Sequencer
  window.getPresets = function() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  }

  function savePresets(presets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    updateList();
    window.dispatchEvent(new Event("presetsUpdated")); // Notify sequencer
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
    } catch(e) {
      console.error(e);
      alert("Failed to save preset.");
    }
  };

  loadBtn.onclick = () => {
    const name = listSelect.value;
    if (!name) return;

    const presets = window.getPresets();
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

    const presets = window.getPresets();
    delete presets[name];
    savePresets(presets);
  };
}

// Global callback for Playhead
window.updatePlayhead = (stepIndex) => {
  const container = document.getElementById("sequencer-rows");
  if (!container) return;
  // Clear old playheads
  const oldPlayheads = container.querySelectorAll(".playhead-cursor");
  oldPlayheads.forEach(el => el.remove());

  // Add new playhead to each timeline grid
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
     cursor.style.left = `${stepIndex * CELL_WIDTH}px`; 
     cursor.style.zIndex = "10";
     cursor.style.pointerEvents = "none";
     grid.appendChild(cursor);
  });
  
  // Auto-scroll Master Scrollbar
  const scrollContainer = document.getElementById("master-scroll-container");
  if (scrollContainer) {
      const left = stepIndex * CELL_WIDTH;
      // Simple follow logic: keep playhead in view
      const width = scrollContainer.clientWidth;
      if (left < scrollContainer.scrollLeft || left > scrollContainer.scrollLeft + width) {
          scrollContainer.scrollLeft = left - width / 2;
      }
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

  // Sequencer State
  let isDrawing = false;
  let drawStartStep = 0;
  let drawTrackIndex = -1;
  let ghostBlock = null;

  function renderSequencer() {
    rowsContainer.innerHTML = "";
    let tracksCount = 0;
    let currentTrackIndex = 0;
    let totalSteps = 128; // Default
    
    try {
        tracksCount = parseInt(vm.eval("$sequencer.tracks.length").toString());
        currentTrackIndex = parseInt(vm.eval("$sequencer.current_track_index").toString());
        totalSteps = parseInt(vm.eval("$sequencer.total_steps").toString());
    } catch(e) { return; }

    // Master Scrollbar Container
    const scrollContainer = document.createElement("div");
    scrollContainer.id = "master-scroll-container";
    scrollContainer.style.overflowX = "scroll";
    scrollContainer.style.overflowY = "hidden";
    scrollContainer.style.marginTop = "10px";
    scrollContainer.style.marginBottom = "10px";
    scrollContainer.style.border = "1px solid #444";
    scrollContainer.style.background = "#222";
    scrollContainer.style.height = "15px"; // Scrollbar height

    // Spacer to force scroll width
    const scrollSpacer = document.createElement("div");
    scrollSpacer.style.width = `${totalSteps * CELL_WIDTH}px`;
    scrollSpacer.style.height = "1px";
    scrollContainer.appendChild(scrollSpacer);

    // Sync Scroll Event
    scrollContainer.onscroll = (e) => {
        const left = e.target.scrollLeft;
        document.querySelectorAll(".timeline-wrapper").forEach(wrapper => {
            wrapper.scrollLeft = left;
        });
        window._lastScrollLeft = left;
    };

    // Restore scroll position
    setTimeout(() => {
        if (window._lastScrollLeft) {
            scrollContainer.scrollLeft = window._lastScrollLeft;
        }
    }, 0);

    for (let t = 0; t < tracksCount; t++) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "0";
        row.style.alignItems = "stretch";
        row.style.marginBottom = "10px";
        row.style.height = "60px";

        // Track Controls (Left Panel)
        const controlDiv = document.createElement("div");
        controlDiv.style.display = "flex";
        controlDiv.style.flexDirection = "column";
        controlDiv.style.width = "140px"; // Increased width for preset selector
        controlDiv.style.flexShrink = "0";
        controlDiv.style.borderRight = "1px solid #555";
        controlDiv.style.paddingRight = "10px";
        controlDiv.style.marginRight = "10px";
        controlDiv.style.justifyContent = "center";
        controlDiv.style.gap = "5px";

        // Select Button (Just for highlighting active track in Synth Mode if needed, though Synth Mode operates on current track)
        // Actually, we need a way to say "This track uses THIS preset".
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

        // Preset Selector
        const presetSel = document.createElement("select");
        presetSel.style.fontSize = "0.8rem";
        presetSel.style.padding = "2px";
        presetSel.style.width = "100%";
        
        // Populate Presets
        const presets = window.getPresets ? window.getPresets() : {};
        presetSel.innerHTML = '<option value="">(Default)</option>';
        Object.keys(presets).forEach(name => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            presetSel.appendChild(opt);
        });

        // Set current value
        let currentPresetName = "";
        try {
            currentPresetName = vm.eval(`$sequencer.tracks[${t}].preset_name`).toString();
        } catch(e) {}
        presetSel.value = currentPresetName;

        presetSel.onchange = (e) => {
            const name = e.target.value;
            // Load preset to track synth
            if (name && presets[name]) {
                try {
                    // Update Ruby Synth
                    // We need to pass JSON string. Ideally call a method on Track?
                    // Or just use import_settings on that track's synth
                    window._tempTrackPresetJson = presets[name];
                    vm.eval(`$sequencer.tracks[${t}].synth.import_settings(JS.global[:_tempTrackPresetJson])`);
                    // Update preset name in Track
                    vm.eval(`$sequencer.tracks[${t}].preset_name = "${name}"`);
                } catch(err) { console.error(err); }
            }
        };

        // Remove & Mute Buttons
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "🗑"; 
        removeBtn.style.padding = "4px";
        removeBtn.style.fontSize = "0.8rem";
        removeBtn.style.background = "#dc3545";
        removeBtn.style.color = "white";
        removeBtn.style.border = "none";
        removeBtn.style.cursor = "pointer";
        removeBtn.onclick = () => removeTrack(t);

        const muteBtn = document.createElement("button");
        let isMuted = false;
        try {
            isMuted = vm.eval(`$sequencer.tracks[${t}].mute`).toString() === "true";
        } catch(e) {}
        muteBtn.textContent = isMuted ? "🔇" : "🔊";
        muteBtn.style.padding = "4px";
        muteBtn.style.fontSize = "0.8rem";
        muteBtn.style.background = isMuted ? "#6c757d" : "#444";
        muteBtn.style.color = "white";
        muteBtn.style.border = "1px solid #555";
        muteBtn.style.cursor = "pointer";
        muteBtn.onclick = () => {
            try {
                const newVal = !isMuted;
                vm.eval(`$sequencer.tracks[${t}].mute = ${newVal}`);
                renderSequencer();
            } catch(e) {}
        };

        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.gap = "2px";
        btnRow.appendChild(removeBtn);
        btnRow.appendChild(muteBtn);

        controlDiv.appendChild(labelBtn);
        controlDiv.appendChild(presetSel);
        controlDiv.appendChild(btnRow);
        row.appendChild(controlDiv);

        // Timeline Container
        const timelineWrapper = document.createElement("div");
        timelineWrapper.className = "timeline-wrapper";
        timelineWrapper.style.flexGrow = "1";
        timelineWrapper.style.overflowX = "hidden"; // Hide individual bars
        timelineWrapper.style.overflowY = "hidden";
        timelineWrapper.style.position = "relative";
        timelineWrapper.style.background = "#222";
        timelineWrapper.style.border = "1px solid #444";

        // Actual Grid
        const grid = document.createElement("div");
        grid.className = "timeline-grid"; 
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = `repeat(${totalSteps}, ${CELL_WIDTH}px)`;
        // Force width to match totalSteps * CELL_WIDTH to allow scrolling
        grid.style.width = `${totalSteps * CELL_WIDTH}px`;
        grid.style.height = "100%";
        grid.style.position = "relative";
        grid.dataset.track = t;

        // Draw Background Lines (every 4 steps = 1 beat, every 32 steps = 1 bar)
        grid.style.backgroundImage = `
            repeating-linear-gradient(90deg,
                #888 0px,
                #888 1px,
                transparent 1px,
                transparent ${CELL_WIDTH * 32}px
            ),
            repeating-linear-gradient(90deg,
                #555 0px,
                #555 1px,
                transparent 1px, 
                transparent ${CELL_WIDTH * 8}px
            ),
            repeating-linear-gradient(90deg, 
                #333 0px, 
                #333 1px, 
                transparent 1px, 
                transparent ${CELL_WIDTH}px
            )
        `;

        // ... Mouse Events ...
        grid.onmousedown = (e) => {
            if (e.target.classList.contains("block")) return; 
            isDrawing = true;
            drawTrackIndex = t;
            const rect = grid.getBoundingClientRect();
            const x = e.clientX - rect.left;
            drawStartStep = Math.floor(x / CELL_WIDTH);
            
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
            const rect = grid.getBoundingClientRect();
            const x = e.clientX - rect.left;
            let currentStep = Math.floor(x / CELL_WIDTH);
            
            const start = Math.min(drawStartStep, currentStep);
            const end = Math.max(drawStartStep, currentStep);
            const len = end - start + 1;
            
            ghostBlock.style.left = `${start * CELL_WIDTH}px`;
            ghostBlock.style.width = `${len * CELL_WIDTH}px`;
        };
        
        // Render Existing Blocks
        try {
            const blocksJson = vm.eval(`$sequencer.get_track_blocks_json(${t})`).toString();
            const blocks = JSON.parse(blocksJson);
            
            blocks.forEach(b => {
                const blockDiv = document.createElement("div");
                blockDiv.className = "block";
                blockDiv.style.gridColumnStart = b.start + 1; // 1-based
                blockDiv.style.gridColumnEnd = `span ${b.length}`;
                blockDiv.style.background = b.notes_count > 0 ? "#4dabf7" : "#555";
                blockDiv.style.border = "1px solid #fff";
                blockDiv.style.borderRadius = "4px";
                blockDiv.style.cursor = "pointer";
                blockDiv.style.zIndex = "5";
                blockDiv.style.position = "relative"; // To stack above grid
                blockDiv.textContent = b.notes_count > 0 ? "♪" : "";
                blockDiv.style.fontSize = "0.8rem";
                blockDiv.style.color = "#fff";
                blockDiv.style.display = "flex";
                blockDiv.style.alignItems = "center";
                blockDiv.style.justifyContent = "center";
                blockDiv.title = `Start: ${b.start}, Len: ${b.length}`;
                
                blockDiv.onclick = (e) => {
                    e.stopPropagation();
                    if (currentTrackIndex !== t) selectTrack(t);
                    openEditor(t, b.start);
                };
                
                // Right click to delete
                blockDiv.oncontextmenu = (e) => {
                    e.preventDefault();
                    if (confirm("Delete block?")) {
                        vm.eval(`$sequencer.remove_block(${t}, ${b.start})`);
                        renderSequencer();
                    }
                };
                
                grid.appendChild(blockDiv);
            });
        } catch(e) { console.error(e); }

        timelineWrapper.appendChild(grid);
        row.appendChild(timelineWrapper);
        rowsContainer.appendChild(row);
    }
    
    // Append Master Scrollbar at the end
    const scrollRow = document.createElement("div");
    scrollRow.style.display = "flex";
    scrollRow.style.gap = "0";
    
    const spacer = document.createElement("div");
    spacer.style.width = "150px"; // Adjusted for wider control div
    spacer.style.flexShrink = "0";
    
    scrollContainer.style.flexGrow = "1";
    
    scrollRow.appendChild(spacer);
    scrollRow.appendChild(scrollContainer);
    rowsContainer.appendChild(scrollRow);
  }
  
  // Global Mouse Up
  window.addEventListener("mouseup", () => {
    if (isDrawing) {
        if (ghostBlock) {
            const left = parseInt(ghostBlock.style.left);
            const width = parseInt(ghostBlock.style.width);
            const startStep = Math.round(left / CELL_WIDTH);
            const steps = Math.round(width / CELL_WIDTH);
            try {
                vm.eval(`$sequencer.add_or_update_block(${drawTrackIndex}, ${startStep}, ${steps})`);
                renderSequencer();
            } catch(e) { console.error(e); }
            ghostBlock = null;
        }
        isDrawing = false;
        drawTrackIndex = -1;
    }
  });

  // Listen for preset updates to re-render dropdowns
  window.addEventListener("presetsUpdated", renderSequencer);
  window.addEventListener("trackChanged", renderSequencer);

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
    } catch (e) { console.error("Sequencer play/stop error:", e); }
  };

  measuresInput.addEventListener("input", () => {
    measuresDisplay.textContent = measuresInput.value;
    try {
      vm.eval(`$sequencer.total_bars = ${measuresInput.value}`);
      renderSequencer(); // Re-render grid
    } catch (e) { console.error(e); }
  });

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

  // Initial render
  renderSequencer();

  function openEditor(trackIndex, stepIndex) {
    currentEditingTrack = trackIndex;
    currentEditingStep = stepIndex; // acts as Block ID (Start Step)
    
    // Get block info
    let blockLen = 1;
    try {
        const blocksJson = vm.eval(`$sequencer.get_track_blocks_json(${trackIndex})`).toString();
        const blocks = JSON.parse(blocksJson);
        const b = blocks.find(x => x.start === stepIndex);
        if (b) blockLen = b.length;
    } catch(e) {}

    modalStepNum.textContent = `T${trackIndex + 1} : Block @ ${stepIndex} (Len: ${blockLen})`;
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
      const json = vm.eval(`$sequencer.get_block_notes_json(${currentEditingTrack}, ${stepIndex})`).toString();
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

        // Selection highlight
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
          vm.eval(`$sequencer.toggle_note_in_block(${currentEditingTrack}, ${stepIndex}, ${x}, ${y})`);
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
        vm.eval(`$sequencer.shift_octave_in_block(${currentEditingTrack}, ${currentEditingStep}, ${currentSelectedCell.x}, ${currentSelectedCell.y}, ${delta})`);
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

    if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        try {
          const result = vm.eval(`$sequencer.shift_block_notes(${currentEditingTrack}, ${currentEditingStep}, ${dx}, ${dy})`).toString();
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
  const viewSynth = document.getElementById("view-synthesizer");

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    // Only allow keyboard play in Synthesizer mode
    if (!viewSynth.classList.contains("active")) return;

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
