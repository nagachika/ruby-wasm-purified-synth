import { drawTetrisShape } from "./utils.js";
import { getChords, saveChords, updateChord, deleteChord } from "./chord_manager.js";
import { getPresets } from "./presets.js";

let currentChordName = "";
let currentChordNotes = [];
let chordSelectedCell = null;

export function setupChordView(vm) {
  const nameInput = document.getElementById("chord-name-input");
  const saveBtn = document.getElementById("save-chord-btn");
  const createBtn = document.getElementById("create-chord-btn");
  const listContainer = document.getElementById("chord-list");
  const editorGrid = document.getElementById("chord-editor-grid");
  const yAxisSel = document.getElementById("chord-y-axis");
  const previewSel = document.getElementById("chord-preview-preset");

  // Populate Preview Presets (sync with main presets)
  function updatePreviewPresets() {
    const presets = getPresets();
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
       const presets = getPresets();
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
    renderChordEditor(vm);
  };

  saveBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) return alert("Please enter a chord name.");
    if (currentChordNotes.length === 0) return alert("Chord is empty.");

    updateChord(name, {
        notes: currentChordNotes,
        dimension: parseInt(yAxisSel.value)
    });
    renderChordList(vm);
    alert(`Chord "${name}" saved!`);
  };

  yAxisSel.onchange = () => {
      // Keep only root note (0,0,0,0,0) with potential octave shift
      currentChordNotes = currentChordNotes.filter(n => n.b === 0 && n.c === 0 && n.d === 0 && n.e === 0);
      renderChordEditor(vm);
  };

  function renderChordList(vm) {
    listContainer.innerHTML = "";
    const chords = getChords();
    Object.keys(chords).forEach(name => {
      const entry = chords[name];
      const isLegacy = Array.isArray(entry);
      const notes = isLegacy ? entry : entry.notes;
      const dim = isLegacy ? null : entry.dimension;

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
      drawTetrisShape(canvas.getContext("2d"), notes, 40, 40, dim);

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
          deleteChord(name);
          renderChordList(vm);
        }
      };

      item.onclick = () => {
        currentChordName = name;
        // Deep copy notes
        currentChordNotes = JSON.parse(JSON.stringify(notes));
        
        // Restore dimension
        if (dim) {
            yAxisSel.value = dim;
        } else {
            // Infer
            let inferred = 3;
            if (notes.some(n => n.e !== 0)) inferred = 5;
            else if (notes.some(n => n.d !== 0)) inferred = 4;
            yAxisSel.value = inferred;
        }

        nameInput.value = name;
        renderChordEditor(vm);
      };

      item.appendChild(canvas);
      item.appendChild(label);
      item.appendChild(delBtn);
      listContainer.appendChild(item);
    });
  }

  function renderChordEditor(vm) {
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
            playPreviewNote(vm, newNote);
        }

        chordSelectedCell = {x, y};
        renderChordEditor(vm);
    });
  }

  function playPreviewNote(vm, noteObj) {
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
              playPreviewNote(vm, note);
              renderChordEditor(vm);
          }
      }

      // Move Selection
      let dx = 0, dy = 0;
      if(e.key === "ArrowUp") dy = 1;
      if(e.key === "ArrowDown") dy = -1;
      if(e.key === "ArrowLeft") dx = -1;
      if(e.key === "ArrowRight") dx = 1;

      if (dx !== 0 || dy !== 0) {
          if (!chordSelectedCell) chordSelectedCell = {x: 0, y: 0};
          chordSelectedCell.x += dx;
          chordSelectedCell.y += dy;
          // Bounds
          if(chordSelectedCell.x < -3) chordSelectedCell.x = -3;
          if(chordSelectedCell.x > 3) chordSelectedCell.x = 3;
          if(chordSelectedCell.y < -2) chordSelectedCell.y = -2;
          if(chordSelectedCell.y > 2) chordSelectedCell.y = 2;

          renderChordEditor(vm);
          e.preventDefault();
      }
  });

  renderChordList(vm);
  renderChordEditor(vm);
}

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
