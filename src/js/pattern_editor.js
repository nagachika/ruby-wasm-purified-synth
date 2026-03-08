export function setupPatternEditor(App) {
  const container = document.getElementById("pattern-editor-container");
  const patternListEl = document.getElementById("pattern-list");
  const newPatternBtn = document.getElementById("new-pattern-btn");
  const patternNameInput = document.getElementById("pattern-name");
  const patternPlayBtn = document.getElementById("pattern-play-btn");
  const patternBpmInput = document.getElementById("pattern-bpm");
  const patternBpmDisplay = document.getElementById("pattern-val-bpm");

  let currentPatternId = null;
  let currentPlayheadStep = -1;

  function updatePreviewUI() {
      if (!patternPlayBtn) return;
      try {
          // Sync BPM display (Always use $patternSequencer's BPM)
          const bpmVal = App.call("$patternSequencer", "bpm").toString();
          if (patternBpmInput && document.activeElement !== patternBpmInput) {
              patternBpmInput.value = bpmVal;
              if (patternBpmDisplay) patternBpmDisplay.textContent = bpmVal;
          }

          const isPlayingVal = App.call("$patternSequencer", "is_playing");
          const isPlaying = isPlayingVal && isPlayingVal.toString() === "true";

          if (isPlaying) {
              patternPlayBtn.innerHTML = '<span class="material-icons" style="font-size: 1.2rem; margin-right: 4px;">stop</span> Stop';
              patternPlayBtn.style.background = "#dc3545";
          } else {
              patternPlayBtn.innerHTML = '<span class="material-icons" style="font-size: 1.2rem; margin-right: 4px;">play_arrow</span> Preview';
              patternPlayBtn.style.background = "#28a745";
          }
      } catch (e) {
          console.error("Failed to update preview UI", e);
      }
  }

  function updateHighlight() {
      if (!container || !currentPatternId) return;

      const isPlayingVal = App.call("$patternSequencer", "is_playing");
      const isPlaying = isPlayingVal && isPlayingVal.toString() === "true";

      let seqStep = -1;
      if (isPlaying) {
          seqStep = window._currentPreviewStep !== undefined ? window._currentPreviewStep : -1;
      } else {
          // If not previewing, we could optionally highlight the main sequencer's position if appropriate,
          // but usually for a pattern editor we only want to highlight when previewing that pattern.
          seqStep = -1;
      }

      // 16 steps pattern
      const patternStep = Math.floor((seqStep % 32) / 2); // 32 sub-steps = 16 steps

      if (patternStep === currentPlayheadStep) return;
      currentPlayheadStep = patternStep;

      const cells = container.querySelectorAll(".step-cell");
      cells.forEach(cell => {
          const stepIdx = parseInt(cell.dataset.step);
          if (stepIdx === patternStep) {
              cell.style.borderColor = "#fff";
              cell.style.boxShadow = "inset 0 0 5px #fff";
          } else {
              cell.style.borderColor = "#555";
              cell.style.boxShadow = "none";
          }
      });

      const headers = container.querySelectorAll(".step-header");
      headers.forEach(h => {
          const stepIdx = parseInt(h.dataset.step);
          h.style.color = (stepIdx === patternStep) ? "#fff" : "#888";
          h.style.fontWeight = (stepIdx === patternStep || stepIdx % 4 === 0) ? "bold" : "normal";
      });
  }

  function animate() {
      updateHighlight();
      requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // Poll for UI updates (e.g. when sequencer stops)
  setInterval(updatePreviewUI, 200);

  function savePatterns() {
      try {
          const json = App.call("$sequencer", "export_patterns_json").toString();
          localStorage.setItem("ruby_synth_patterns", json);
      } catch (e) {
          console.error("Failed to save patterns", e);
      }
  }

  function loadPatterns() {
      try {
          const json = localStorage.getItem("ruby_synth_patterns");
          if (json) {
              App.call("$sequencer", "import_patterns_json", json);
          }
      } catch (e) {
          console.error("Failed to load patterns", e);
      }
  }

  function renderGrid() {
    container.innerHTML = "";
    if (!currentPatternId) {
      container.innerHTML = "<div style='color: #aaa; text-align: center; padding: 20px;'>Select or create a pattern to edit.</div>";
      return;
    }

    let patternData;
    try {
      const json = App.call("$sequencer", "get_pattern_events_json", currentPatternId).toString();
      patternData = JSON.parse(json);
    } catch (e) {
      console.error("Error fetching pattern data", e);
      return;
    }

    // Instruments
    const instruments = ["Kick", "Snare", "HiHat", "OpenHat"];
    const steps = 16; // Fixed for now

    const table = document.createElement("div");
    table.style.display = "grid";
    table.style.gridTemplateColumns = `100px repeat(${steps}, 1fr)`;
    table.style.gap = "2px";
    table.style.background = "#222";
    table.style.border = "1px solid #444";
    table.style.padding = "10px";

    // Header Row
    table.appendChild(document.createElement("div")); // Empty corner
    for (let i = 0; i < steps; i++) {
      const cell = document.createElement("div");
      cell.className = "step-header";
      cell.dataset.step = i;
      cell.textContent = i + 1;
      cell.style.textAlign = "center";
      cell.style.fontSize = "0.7rem";
      cell.style.color = "#888";
      if (i % 4 === 0) cell.style.fontWeight = "bold";
      table.appendChild(cell);
    }

    // Instrument Rows
    instruments.forEach(inst => {
      const label = document.createElement("div");
      label.textContent = inst;
      label.style.color = "#ccc";
      label.style.display = "flex";
      label.style.alignItems = "center";
      label.style.paddingLeft = "5px";
      label.style.fontSize = "0.9rem";
      table.appendChild(label);

      const activeSteps = patternData[inst] || {};

      for (let i = 0; i < steps; i++) {
        const cell = document.createElement("div");
        cell.className = "step-cell";
        cell.dataset.step = i;
        cell.style.height = "30px";

        const isActive = activeSteps.hasOwnProperty(i.toString());
        const velocity = isActive ? activeSteps[i.toString()] : 0;

        cell.style.background = isActive
            ? `rgba(255, 135, 135, ${0.5 + velocity * 0.5})`
            : (i % 4 === 0 ? "#444" : "#333");

        cell.style.borderRadius = "2px";
        cell.style.cursor = "pointer";
        cell.style.border = "1px solid #555";
        cell.style.transition = "border-color 0.1s, box-shadow 0.1s";

        if (isActive) {
             cell.title = `Velocity: ${Math.round(velocity * 127)}`;
        }

        cell.onclick = () => {
          App.call("$sequencer", "toggle_pattern_step", currentPatternId, inst, i);
          savePatterns();
          renderGrid();
        };

        table.appendChild(cell);
      }
    });

    container.appendChild(table);
  }

  function updatePatternList() {
    let patterns = [];
    try {
      const json = App.call("$sequencer", "get_patterns_json").toString();
      patterns = JSON.parse(json);
    } catch (e) { console.error(e); return; }

    if (patternListEl) patternListEl.innerHTML = "";

    // Ensure currentPatternId is valid
    if (currentPatternId && !patterns.find(p => p.id === currentPatternId)) {
        currentPatternId = patterns.length > 0 ? patterns[0].id : null;
    }
    if (!currentPatternId && patterns.length > 0) {
        currentPatternId = patterns[0].id;
    }

    patterns.forEach(p => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.padding = "5px";
      row.style.marginBottom = "1px";
      row.style.background = (p.id === currentPatternId) ? "#007bff" : "#333";
      row.style.cursor = "pointer";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = p.name;
      nameSpan.style.flexGrow = "1";
      nameSpan.style.whiteSpace = "nowrap";
      nameSpan.style.overflow = "hidden";
      nameSpan.style.textOverflow = "ellipsis";

      nameSpan.onclick = () => {
          loadPattern(p.id);
      };

      const delBtn = document.createElement("button");
      delBtn.innerHTML = "&times;";
      delBtn.style.background = "transparent";
      delBtn.style.border = "none";
      delBtn.style.color = "#ffcccc";
      delBtn.style.fontWeight = "bold";
      delBtn.style.cursor = "pointer";
      delBtn.style.padding = "0 8px";
      delBtn.style.fontSize = "1.2rem";
      delBtn.title = "Delete Pattern";

      delBtn.onclick = (e) => {
          e.stopPropagation();
          if (confirm(`Delete pattern "${p.name}"?`)) {
              App.call("$sequencer", "delete_pattern", p.id);
              savePatterns();
              updatePatternList();
          }
      };

      row.appendChild(nameSpan);
      row.appendChild(delBtn);
      if (patternListEl) patternListEl.appendChild(row);
    });

    if (currentPatternId) {
      loadPattern(currentPatternId, false); // false to avoid recursive updatePatternList if we called it from there
    } else {
      renderGrid(); // Clear grid if no pattern
    }
  }

  function loadPattern(id, refreshList = true) {
    currentPatternId = id;
    let name = "";
    try {
        const json = App.call("$sequencer", "get_patterns_json").toString();
        const patterns = JSON.parse(json);
        const p = patterns.find(x => x.id === id);
        if(p) name = p.name;
    } catch(e){}
    patternNameInput.value = name;

    if (refreshList) updatePatternList();
    else renderGrid();
  }

  newPatternBtn.onclick = () => {
    const name = prompt("Enter pattern name:", "New Beat");
    if (name) {
      try {
        App.call("$sequencer", "create_pattern", name);
        savePatterns();

        // Select the new pattern (last one)
        const json = App.call("$sequencer", "get_patterns_json").toString();
        const patterns = JSON.parse(json);
        const last = patterns[patterns.length - 1];
        if (last) {
            loadPattern(last.id);
        } else {
            updatePatternList();
        }
      } catch (e) { console.error(e); }
    }
  };

  patternNameInput.onchange = (e) => {
      if(!currentPatternId) return;
      // Update name in Ruby
      App.call("$sequencer", "rename_pattern", currentPatternId, e.target.value);
      savePatterns();
      updatePatternList();
  };

  if (patternPlayBtn) {
      patternPlayBtn.onclick = () => {
          if (!currentPatternId) return;
          try {
              const isPlayingVal = App.call("$patternSequencer", "is_playing");
              const isPlaying = isPlayingVal && isPlayingVal.toString() === "true";
              if (isPlaying) {
                  App.call("$patternSequencer", "stop");
              } else {
                  // Setup $patternSequencer to play the current pattern on track 0 (rhythm track)
                  App.call("$patternSequencer", "add_or_update_block", 0, 0, 32, currentPatternId);
                  App.call("$patternSequencer", "start");
              }
          } catch (e) {
              console.error("Failed to toggle pattern preview", e);
          }
      };
  }

  if (patternBpmInput) {
      patternBpmInput.oninput = (e) => {
          const val = parseInt(e.target.value);
          if (patternBpmDisplay) patternBpmDisplay.textContent = val;
          try {
              App.call("$patternSequencer", "set_bpm", val);
          } catch (e) {}
      };
  }

  // Initial load
  loadPatterns();
  updatePatternList();

  // Listen for global events to refresh if needed
  window.addEventListener("refreshPatterns", updatePatternList);
  window.addEventListener("selectPattern", (e) => {
      if (e.detail && e.detail.id) {
          loadPattern(e.detail.id);
      }
  });
}
