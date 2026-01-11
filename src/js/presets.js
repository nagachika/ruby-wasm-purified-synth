const STORAGE_KEY = "ruby_synth_presets";

export function getPresets() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
}

// Expose to window for other modules/Ruby if needed, though mostly other JS modules need it.
window.getPresets = getPresets;

function savePresets(presets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    window.dispatchEvent(new Event("presetsUpdated"));
}

export function updateUIFromSettings(json) {
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

export function setupPresets(vm) {
  const nameInput = document.getElementById("preset_name");
  const saveBtn = document.getElementById("save_preset");
  const listSelect = document.getElementById("preset_list");
  const loadBtn = document.getElementById("load_preset");
  const deleteBtn = document.getElementById("delete_preset");

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
      // Always save the full patch structure (works for both legacy-style and custom)
      const json = vm.eval("$synth.export_patch").toString();
      const presets = getPresets();
      presets[name] = json;
      savePresets(presets);
      alert(`Preset "${name}" saved!`);
      nameInput.value = "";
    } catch(e) { console.error(e); }
  };
  loadBtn.onclick = () => {
    const name = listSelect.value;
    if (!name) return;
    const presets = getPresets();
    if (presets[name]) {
        const json = presets[name];
        window._tempPresetJson = json;

        try {
            const data = JSON.parse(json);
            if (data.nodes) {
                // New Modular Patch Format
                vm.eval(`$synth.import_patch(JS.global[:_tempPresetJson])`);
                if (window.modularEditor) {
                    window.modularEditor.loadPatch(data);
                }
            } else {
                // Legacy Format
                vm.eval(`$synth.import_settings(JS.global[:_tempPresetJson])`);
                updateUIFromSettings(json);
                // Update Modular Editor visualization
                const patchJson = vm.eval("$synth.export_patch").toString();
                const patch = JSON.parse(patchJson);
                if (window.modularEditor) {
                    window.modularEditor.loadPatch(patch);
                }
            }
        } catch(e) { console.error(e); }
    }
  };
  deleteBtn.onclick = () => {
    const name = listSelect.value;
    if (!name && confirm(`Delete preset "${name}"?`)) {
        const presets = getPresets();
        delete presets[name];
        savePresets(presets);
    }
  };
}
