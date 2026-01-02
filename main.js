import { DefaultRubyVM } from "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.7.1/dist/esm/browser.js";

const startBtn = document.getElementById("start-btn");
const overlay = document.getElementById("start-overlay");

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

    // Instantiate Synthesizer
    vm.eval("$synth = Synthesizer.new(JS.eval('return window.audioCtx;'))");
    console.log("Synthesizer initialized");
    
    // Instantiate Sequencer
    vm.eval("$sequencer = Sequencer.new($synth, JS.eval('return window.audioCtx;'))");

    setupUI(vm);
    setupKeyboard(vm);
    setupVisualizer(vm);
    setupSequencer(vm);
  };
};

// Define global callback immediately
window.updatePlayhead = (stepIndex) => {
  const grid = document.getElementById("sequencer-grid");
  if (!grid) return;
  const steps = grid.children;
  for (let i = 0; i < steps.length; i++) {
    if (i === stepIndex) {
      steps[i].style.borderColor = "#fff";
      steps[i].style.boxShadow = "0 0 5px #fff";
    } else {
      steps[i].style.borderColor = "#555";
      steps[i].style.boxShadow = "none";
    }
  }
};

function setupSequencer(vm) {
  const grid = document.getElementById("sequencer-grid");
  const playBtn = document.getElementById("seq-play-btn");
  const bpmInput = document.getElementById("bpm");
  const bpmDisplay = document.getElementById("val_bpm");
  
  // Generate 16 steps
  for (let i = 0; i < 16; i++) {
    const stepBtn = document.createElement("div");
    stepBtn.style.height = "40px";
    stepBtn.style.background = "#444";
    stepBtn.style.borderRadius = "4px";
    stepBtn.style.cursor = "pointer";
    stepBtn.style.border = "2px solid #555";
    stepBtn.dataset.index = i;
    stepBtn.dataset.active = "false";
    
    stepBtn.onclick = () => {
      const isActive = stepBtn.dataset.active === "true";
      stepBtn.dataset.active = isActive ? "false" : "true";
      stepBtn.style.background = isActive ? "#444" : "#4dabf7";
      
      // Toggle in Ruby
      try {
        vm.eval(`$sequencer.toggle_step(${i}, 60)`);
      } catch (e) {
        console.error("Sequencer toggle error:", e);
      }
    };
    
    grid.appendChild(stepBtn);
  }

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
    } catch (e) {
      console.error("Sequencer play/stop error:", e);
    }
  };

  bpmInput.addEventListener("input", () => {
    bpmDisplay.textContent = bpmInput.value;
    try {
      vm.eval(`$sequencer.bpm = ${bpmInput.value}`);
    } catch (e) {
      console.error("BPM update error:", e);
    }
  });
}

function setupVisualizer(vm) {
  const canvas = document.getElementById("visualizer");
  const canvasCtx = canvas.getContext("2d");
  
  // Retrieve AnalyserNode from Ruby object
  // Since we expose attr_reader :analyser_node, we can access it.
  // Note: Returned value from Ruby eval of a JS::Object wrapper is the JS object itself when crossing boundary back to JS?
  // Actually, via vm.eval(), we get a JsValue. 
  // Let's rely on global JS access or helper.
  // Easiest way: Let Ruby assign it to a global JS variable.
  vm.eval("JS.global[:synthAnalyser] = $synth.analyser_node");
  const analyser = window.synthAnalyser;

  if (!analyser) {
    console.error("Analyser node not found");
    return;
  }

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  let vizMode = "waveform";

  document.querySelectorAll('input[name="viz_mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      vizMode = e.target.value;
    });
  });

  function draw() {
    requestAnimationFrame(draw);

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
    
    // Initial Sync (Ruby -> UI) isn't strictly necessary if defaults match,
    // but let's sync UI -> Ruby just in case.
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
      vm.eval(`$synth.note_on(${note})`);
      
      // Visual feedback?
    }
  });

  window.addEventListener("keyup", (e) => {
    const note = keyMap[e.key];
    if (note) {
      vm.eval(`$synth.note_off(${note})`);
    }
  });
}

main();