export function setupPatternEditor(vm) {
  const container = document.getElementById("pattern-editor-container");
  const patternSelectOriginal = document.getElementById("pattern-select");
  const newPatternBtn = document.getElementById("new-pattern-btn");
  const patternNameInput = document.getElementById("pattern-name");

  // Replace <select> with a custom list container if not already done
  // We need to do this because the original HTML has a select, but we want a list with delete buttons.
  let patternListEl = document.getElementById("pattern-list");

  if (!patternListEl && patternSelectOriginal) {
      patternListEl = document.createElement("div");
      patternListEl.id = "pattern-list";
      patternListEl.style.width = "100%";
      patternListEl.style.background = "#222";
      patternListEl.style.color = "white";
      patternListEl.style.border = "1px solid #555";
      patternListEl.style.marginBottom = "10px";
      patternListEl.style.flexGrow = "1";
      patternListEl.style.overflowY = "auto";
      patternListEl.style.height = "200px"; // Fallback height if flex fails (it's inside a flex column so should grow if styled right, but size=10 select has height)

      patternSelectOriginal.replaceWith(patternListEl);
  } else if (!patternListEl) {
      // If we can't find the select or the list, create a dummy to prevent crash, though UI will be broken
      patternListEl = document.createElement("div");
  }

  // We also need a container for the grid if not exists, to avoid clearing everything
  // In the original, container IS the grid container.

  let currentPatternId = null;

  function savePatterns() {
      try {
          const json = vm.eval("$sequencer.export_patterns_json").toString();
          localStorage.setItem("ruby_synth_patterns", json);
      } catch (e) {
          console.error("Failed to save patterns", e);
      }
  }

  function loadPatterns() {
      try {
          const json = localStorage.getItem("ruby_synth_patterns");
          if (json) {
              window._tempPatternsFn = json;
              vm.eval(`$sequencer.import_patterns_json(JS.global[:_tempPatternsFn])`);
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
      const json = vm.eval(`$sequencer.get_pattern_events_json("${currentPatternId}")`).toString();
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
        cell.style.height = "30px";

        const isActive = activeSteps.hasOwnProperty(i.toString());
        const velocity = isActive ? activeSteps[i.toString()] : 0;

        cell.style.background = isActive
            ? `rgba(255, 135, 135, ${0.5 + velocity * 0.5})`
            : (i % 4 === 0 ? "#444" : "#333");

        cell.style.borderRadius = "2px";
        cell.style.cursor = "pointer";
        cell.style.border = "1px solid #555";

        if (isActive) {
             cell.title = `Velocity: ${Math.round(velocity * 127)}`;
        }

        cell.onclick = () => {
          vm.eval(`$sequencer.toggle_pattern_step("${currentPatternId}", "${inst}", ${i})`);
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
      const json = vm.eval(`$sequencer.get_patterns_json`).toString();
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
              vm.eval(`$sequencer.delete_pattern("${p.id}")`);
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
        const json = vm.eval(`$sequencer.get_patterns_json`).toString();
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
        const newPattern = vm.eval(`$sequencer.create_pattern("${name}")`);
        savePatterns();

        // Select the new pattern (last one)
        const json = vm.eval(`$sequencer.get_patterns_json`).toString();
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
      vm.eval(`$sequencer.get_pattern("${currentPatternId}").name = "${e.target.value}"`);
      savePatterns();
      updatePatternList();
  };

  // Initial load
  loadPatterns();
  updatePatternList();

  // Listen for global events to refresh if needed
  window.addEventListener("refreshPatterns", updatePatternList);
}
