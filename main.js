import { DefaultRubyVM } from "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.7.1/dist/esm/browser.js";

const startBtn = document.getElementById("start-btn");
const overlay = document.getElementById("start-overlay");

// UI Elements
const uiIds = [
  "osc_type", "filter_type", "cutoff", "resonance",
  "attack", "decay", "sustain", "release",
  "lfo_on", "lfo_waveform", "lfo_rate", "lfo_depth"
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

let activeNote = null;

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
    const scriptRes = await fetch("src/synthesizer.rb");
    if (!scriptRes.ok) {
        console.error("Failed to fetch src/synthesizer.rb");
        return;
    }
    const scriptText = await scriptRes.text();
    vm.eval(scriptText);

    // Instantiate Synthesizer
    // Passing AudioContext via JS.eval inside Ruby, or passing it as argument?
    // Synthesizer#initialize(ctx) expects a JS::Object.
    // We can put audioCtx on window and let Ruby retrieve it, or pass it.
    // Let's pass it by putting it in a known global for Ruby to grab easily if we can't pass directly via eval str.
    // Actually, we can just do:
    vm.eval("$synth = Synthesizer.new(JS.eval('return window.audioCtx;'))");
    console.log("Synthesizer initialized");

    setupUI(vm);
    setupKeyboard(vm);
  };
};

function setupUI(vm) {
  uiIds.forEach(id => {
    const el = document.getElementById(id);
    const display = document.getElementById(`val_${id}`);
    
    // Initial Sync (Ruby -> UI) isn't strictly necessary if defaults match,
    // but let's sync UI -> Ruby just in case.
    updateParam(vm, id, el);

    el.addEventListener("input", () => {
      if (display) {
        let val = el.value;
        if (id === 'cutoff') val += ' Hz';
        if (id === 'attack' || id === 'decay' || id === 'release') val += ' s';
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
    val = el.value; // Ruby handles string->float conversion if we use appropriate method or if we cast in Ruby
    // But better to pass numbers as strings and let Ruby to_f them, OR make sure Ruby attribute writer handles it.
    // The attr_accessor in Ruby just stores what it gets. Voice class does to_f?
    // Let's check Synthesizer class. It uses attr_accessor.
    // Voice class uses @params.cutoff.
    // @vcf[:frequency][:value] = @params.cutoff
    // If @params.cutoff is a String "2000", JS gem might handle it or might not.
    // Safest is to cast in Ruby.
    // We will update the Synthesizer setters or just eval assignment with explicit conversion.
  } else {
    val = `"${el.value}"`; // Quote strings
  }

  // Construct Ruby code to update the parameter
  // Special handling for numbers
  if (el.type === "range") {
     vm.eval(`$synth.${id} = ${el.value}.to_f`);
  } else if (el.type === "checkbox") {
     vm.eval(`$synth.${id} = ${val}`);
  } else {
     vm.eval(`$synth.${id} = ${val}`);
  }
}

function setupKeyboard(vm) {
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const note = keyMap[e.key];
    if (note) {
      activeNote = note;
      vm.eval(`$synth.note_on(${note})`);
      
      // Visual feedback?
    }
  });

  window.addEventListener("keyup", (e) => {
    const note = keyMap[e.key];
    if (note && note === activeNote) {
      vm.eval(`$synth.note_off`);
      activeNote = null;
    }
  });
}

main();