import { CELL_WIDTH, drawTetrisShape } from "./utils.js";
import { getChords } from "./chord_manager.js";
import { getPresets } from "./presets.js";

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

export function setupSequencer(vm) {
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
        const presets = getPresets();
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
                const cw = b.length * CELL_WIDTH - 4;
                const ch = 70; // Reduced height to ensure fit
                canvas.width = cw > 0 ? cw : 1;
                canvas.height = ch;
                canvas.style.display = "block"; // Prevent inline spacing issues

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

  function selectTrack(t) {
      vm.eval(`$sequencer.select_track(${t})`);
      renderSequencer();
      // Also update synth UI to reflect this track's settings?
      // Actually, $synth is updated in Ruby side to point to current track synth.
      // So we might need to refresh UI knobs.
      // But currently setupUI binds events, it doesn't auto-refresh from $synth on track change except
      // if we explicitly call something.
      // Ideally we should re-read values.
      // Let's trigger a UI refresh if possible.
      // For now, at least render sequencer to show selected track.
  }

  function removeTrack(t) {
      if(confirm(`Remove Track ${t+1}?`)) {
          vm.eval(`$sequencer.remove_track(${t})`);
          renderSequencer();
      }
  }

  function openChordSelector(trackIdx, startStep) {
      selectorList.innerHTML = "";
      const chords = getChords();
      const chordNames = Object.keys(chords);
      if (chordNames.length === 0) {
          selectorList.innerHTML = "<div style='grid-column: 1/-1; text-align: center; color: #aaa; padding: 20px;'>No chords saved. Create one in the Chord tab.</div>";
          selectorModal.style.display = "flex";
          return;
      }

      // Add existing chords
      chordNames.forEach(name => {
          const entry = chords[name];
          const isLegacy = Array.isArray(entry);
          const notes = isLegacy ? entry : entry.notes;
          const dim = isLegacy ? null : entry.dimension;

          const item = document.createElement("div");
          item.style.background = "#444";
          item.style.padding = "5px";
          item.style.borderRadius = "4px";
          item.style.cursor = "pointer";
          item.style.textAlign = "center";

          const cvs = document.createElement("canvas");
          cvs.width = 80; cvs.height = 80;
          drawTetrisShape(cvs.getContext("2d"), notes, 80, 80, dim);

          const lbl = document.createElement("div");
          lbl.textContent = name;
          lbl.style.marginTop = "5px";
          lbl.style.fontSize = "0.9rem";

          item.appendChild(cvs);
          item.appendChild(lbl);

          item.onclick = () => {
              applyChordToBlock(trackIdx, startStep, name, notes);
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
      if (measuresDisplay) measuresDisplay.textContent = measuresInput.value;
      try { vm.eval(`$sequencer.total_bars = ${measuresInput.value}`); renderSequencer(); } catch(e){}
  });
  bpmInput.addEventListener("input", () => {
      if (bpmDisplay) bpmDisplay.textContent = bpmInput.value;
      try{vm.eval(`$sequencer.bpm = ${bpmInput.value}`);}catch(e){}
  });
  rootFreqInput.addEventListener("change", () => { try{vm.eval(`$sequencer.root_freq = ${rootFreqInput.value}`);}catch(e){} });
  yAxisSelect.addEventListener("change", () => { try{vm.eval(`$sequencer.y_axis_dim = ${yAxisSelect.value}`);}catch(e){} });

  window.addEventListener("trackChanged", renderSequencer);
  renderSequencer();
}
