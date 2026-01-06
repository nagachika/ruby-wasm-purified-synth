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

  // Ensure JS module is loaded
  vm.eval("require 'js'");

  startBtn.onclick = async () => {
    if (!window.audioCtx) window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (window.audioCtx.state === 'suspended') await window.audioCtx.resume();
    overlay.style.display = "none";

    console.log("Loading Ruby scripts...");

    const rubyFiles = [
      "src/synthesizer/audio_node_wrapper.rb",
      "src/synthesizer/nodes.rb",
      "src/synthesizer/adsr_envelope.rb",
      "src/synthesizer/voice.rb",
      "src/synthesizer.rb",
      "src/sequencer.rb"
    ];

    for (const file of rubyFiles) {
      const res = await fetch(`${file}?_=${Date.now()}`);
      if (!res.ok) {
        console.error(`Failed to load ${file}`);
        continue;
      }
      const text = await res.text();

      // Pass content to Ruby via global variable to avoid escaping issues
      window._rubyFileContent = text;

      // Force absolute path for VFS to ensure it matches $LOAD_PATH
      const vfsPath = '/' + file;

      // Ensure directory exists
      const dir = vfsPath.substring(0, vfsPath.lastIndexOf('/'));
      if (dir) {
        vm.eval(`
          parts = '${dir}'.split('/').reject(&:empty?)
          current = ''
          parts.each do |part|
            current = current + '/' + part
            Dir.mkdir(current) unless Dir.exist?(current)
          end
        `);
      }

      // Write file
      vm.eval(`File.write('${vfsPath}', JS.global[:_rubyFileContent])`);

      // Verify write
      const exists = vm.eval(`File.exist?('${vfsPath}')`).toJS();
      if (!exists) {
        console.error(`Failed to write ${vfsPath}`);
      }
    }

    // Clean up
    delete window._rubyFileContent;

    // Add src to load path
    vm.eval("$LOAD_PATH.unshift '/src'");

    // Load entry points with error handling
    const loadScript = (script) => {
      try {
        vm.eval(`
          begin
            require '${script}'
          rescue LoadError => e
            puts "Error loading ${script}: #{e.message}"
            puts e.backtrace
            raise e
          end
        `);
        console.log(`Loaded ${script}`);
      } catch (e) {
        console.error(`JS Exception loading ${script}`, e);
      }
    };

    loadScript('/src/synthesizer.rb');
    loadScript('/src/sequencer.rb');

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
