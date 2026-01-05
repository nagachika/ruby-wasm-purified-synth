import { DefaultRubyVM } from "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.7.1/dist/esm/browser.js";
import { loadChords } from "./chord_manager.js";
import { setupChordView } from "./chord_view.js";
import { setupPresets } from "./presets.js";
import { setupSequencer } from "./sequencer_ui.js";
import { setupUI, setupKeyboard } from "./synth_ui.js";
import { setupVisualizer } from "./visualizer.js";

const startBtn = document.getElementById("start-btn");
const overlay = document.getElementById("start-overlay");

function setupTabs() {
  const tabSynth = document.getElementById("tab-synth");
  const tabSeq = document.getElementById("tab-seq");
  const tabChord = document.getElementById("tab-chord");
  const viewSynth = document.getElementById("view-synthesizer");
  const viewSeq = document.getElementById("view-sequencer");
  const viewChord = document.getElementById("view-chord");

  function switchTab(view) {
    [tabSynth, tabSeq, tabChord].forEach(t => t.classList.remove("active"));
    [viewSynth, viewSeq, viewChord].forEach(v => v.classList.remove("active"));

    if (view === "synth") {
      tabSynth.classList.add("active");
      viewSynth.classList.add("active");
    } else if (view === "seq") {
      tabSeq.classList.add("active");
      viewSeq.classList.add("active");
      window.dispatchEvent(new Event("trackChanged"));
    } else if (view === "chord") {
      tabChord.classList.add("active");
      viewChord.classList.add("active");
    }
  }

  tabSynth.onclick = () => switchTab("synth");
  tabSeq.onclick = () => switchTab("seq");
  tabChord.onclick = () => switchTab("chord");
}

const main = async () => {
  // Pre-load Ruby VM
  const response = await fetch("https://cdn.jsdelivr.net/npm/@ruby/3.3-wasm-wasi@2.7.1/dist/ruby.wasm");
  const buffer = await response.arrayBuffer();
  const module = await WebAssembly.compile(buffer);
  const { vm } = await DefaultRubyVM(module);

  window.rubyVM = vm;
  console.log("Ruby VM loaded");

  startBtn.onclick = async () => {
    if (!window.audioCtx) window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (window.audioCtx.state === 'suspended') await window.audioCtx.resume();
    overlay.style.display = "none";

    console.log("Loading Ruby scripts...");
    const scriptRes = await fetch(`src/synthesizer.rb?_=${Date.now()}`);
    if (scriptRes.ok) vm.eval(await scriptRes.text());
    const seqRes = await fetch(`src/sequencer.rb?_=${Date.now()}`);
    if (seqRes.ok) vm.eval(await seqRes.text());

    // Init Sequencer & Synth
    vm.eval("$sequencer = Sequencer.new(JS.eval('return window.audioCtx;'))");
    vm.eval("$synth = $sequencer.current_track.synth");

    // Create a standalone synth for Chord Preview
    vm.eval("$previewSynth = Synthesizer.new(JS.eval('return window.audioCtx;'))");

    console.log("Initialized");

    loadChords();
    setupTabs();
    setupUI(vm);
    setupKeyboard(vm);
    setupVisualizer(vm);
    setupSequencer(vm);
    setupPresets(vm);
    setupChordView(vm);
  };
};

main();
