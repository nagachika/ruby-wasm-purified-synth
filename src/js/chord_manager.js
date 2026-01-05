const CHORD_STORAGE_KEY = "ruby_synth_chords";
let chords = {};

export function getChords() {
    return chords;
}

export function loadChords() {
  try {
    const raw = localStorage.getItem(CHORD_STORAGE_KEY);
    chords = raw ? JSON.parse(raw) : {};
  } catch(e) { console.error(e); chords = {}; }
  return chords;
}

export function saveChords() {
  localStorage.setItem(CHORD_STORAGE_KEY, JSON.stringify(chords));
}

export function updateChord(name, data) {
    chords[name] = data;
    saveChords();
}

export function deleteChord(name) {
    delete chords[name];
    saveChords();
}
