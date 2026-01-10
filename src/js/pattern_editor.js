export function setupPatternEditor(vm) {
  const container = document.getElementById("pattern-editor-container");
  const patternSelect = document.getElementById("pattern-select");
  const newPatternBtn = document.getElementById("new-pattern-btn");
  const patternNameInput = document.getElementById("pattern-name");

  let currentPatternId = null;

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

    patternSelect.innerHTML = "";
    patterns.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      patternSelect.appendChild(opt);
    });

    if (currentPatternId) {
      patternSelect.value = currentPatternId;
    } else if (patterns.length > 0) {
      currentPatternId = patterns[0].id;
      patternSelect.value = currentPatternId;
      loadPattern(currentPatternId);
    }
  }

  function loadPattern(id) {
    currentPatternId = id;
    let name = "";
    try {
        // Need a safe way to get name, the JSON list has it
        const json = vm.eval(`$sequencer.get_patterns_json`).toString();
        const patterns = JSON.parse(json);
        const p = patterns.find(x => x.id === id);
        if(p) name = p.name;
    } catch(e){}
    patternNameInput.value = name;
    renderGrid();
  }

  patternSelect.onchange = (e) => {
    loadPattern(e.target.value);
  };

  newPatternBtn.onclick = () => {
    const name = prompt("Enter pattern name:", "New Beat");
    if (name) {
      try {
        const newPattern = vm.eval(`$sequencer.create_pattern("${name}")`);
        // We need the ID. Returns ruby object.
        // Let's just reload list and pick last?
        updatePatternList();
        // Set to last
        patternSelect.selectedIndex = patternSelect.options.length - 1;
        loadPattern(patternSelect.value);
      } catch (e) { console.error(e); }
    }
  };

  patternNameInput.onchange = (e) => {
      if(!currentPatternId) return;
      // Update name in Ruby
      vm.eval(`$sequencer.get_pattern("${currentPatternId}").name = "${e.target.value}"`);
      updatePatternList();
  };

  // Initial load
  updatePatternList();

  // Listen for global events to refresh if needed
  window.addEventListener("refreshPatterns", updatePatternList);
}
