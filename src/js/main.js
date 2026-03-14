import { DefaultRubyVM } from "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.8.1/dist/esm/browser.js";
import { loadChords } from "./chord_manager.js";
import { setupChordView } from "./chord_view.js";
import { setupPresets } from "./presets.js";
import { setupSequencer } from "./sequencer_ui.js";
import { setupUI, setupKeyboard } from "./synth_ui.js";
import { setupVisualizer } from "./visualizer.js";
import { setupPatternEditor } from "./pattern_editor.js";

const startBtn = document.getElementById("start-btn");
const overlay = document.getElementById("start-overlay");

// Central Application Object
window.App = {
  vm: null,
  audioCtx: null,

  // Safe Ruby evaluation with centralized error handling
  eval(code, context = "Main") {
    try {
      const result = this.vm.eval(code);
      return result;
    } catch (e) {
      console.error(`[Ruby Error in ${context}]:`, e);
      if (e.stack) console.error(e.stack);
      return null;
    }
  },

  // Safe Method Call via JSON Facade
  call(target, method, ...args) {
    const jsonArgs = JSON.stringify(args);
    window._tempJsonArgs = jsonArgs;
    const code = `js_bridge_dispatch('${target}', '${method}', JS.global[:_tempJsonArgs].to_s)`;
    const result = this.eval(code, `Call(${target}.${method})`);
    delete window._tempJsonArgs;
    return result;
  }
};

function setupTabs() {  const tabSynth = document.getElementById("tab-synth");
  const tabSeq = document.getElementById("tab-seq");
  const tabChord = document.getElementById("tab-chord");
  const tabPattern = document.getElementById("tab-pattern");

  const viewSynth = document.getElementById("view-synthesizer");
  const viewSeq = document.getElementById("view-sequencer");
  const viewChord = document.getElementById("view-chord");
  const viewPattern = document.getElementById("view-pattern");

  function switchTab(view) {
    [tabSynth, tabSeq, tabChord, tabPattern].forEach(t => t && t.classList.remove("active"));
    [viewSynth, viewSeq, viewChord, viewPattern].forEach(v => v && v.classList.remove("active"));

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
    } else if (view === "pattern") {
      tabPattern.classList.add("active");
      viewPattern.classList.add("active");
    }
  }

  tabSynth.onclick = () => switchTab("synth");
  tabSeq.onclick = () => switchTab("seq");
  tabChord.onclick = () => switchTab("chord");
  if (tabPattern) tabPattern.onclick = () => switchTab("pattern");
}

const main = async () => {
  // Pre-load Ruby VM
  const response = await fetch("https://cdn.jsdelivr.net/npm/@ruby/3.3-wasm-wasi@2.8.1/dist/ruby+stdlib.wasm");
  const buffer = await response.arrayBuffer();
  const module = await WebAssembly.compile(buffer);
  const { vm } = await DefaultRubyVM(module);

  App.vm = vm;
  console.log("Ruby VM loaded");

  // Enable the start button and update text now that VM is ready
  startBtn.disabled = false;
  startBtn.textContent = "Click to Start";

  // Ensure JS module is loaded
  App.eval("require 'js'");

  startBtn.onclick = async () => {
    if (!App.audioCtx) App.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (App.audioCtx.state === 'suspended') await App.audioCtx.resume();
    // Expose for visualizer (Legacy support if needed, or update visualizer)
    window.audioCtx = App.audioCtx;

    overlay.style.display = "none";

    console.log("Loading Ruby scripts...");

    const rubyFiles = [
      "src/synthesizer/audio_node_wrapper.rb",
      "src/synthesizer/nodes.rb",
      "src/synthesizer/adsr_envelope.rb",
      "src/synthesizer/voice.rb",
      "src/synthesizer.rb",
      "src/synthesizer/drum_machine.rb",
      "src/sequencer.rb",
      "src/js_bridge.rb"
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
        window._tempDir = dir;
        App.eval(`
          parts = JS.global[:_tempDir].to_s.split('/').reject(&:empty?)
          current = ''
          parts.each do |part|
            current = current + '/' + part
            Dir.mkdir(current) unless Dir.exist?(current)
          end
        `, "DirSetup");
        delete window._tempDir;
      }

      // Write file
      window._tempPath = vfsPath;
      App.eval(`File.write(JS.global[:_tempPath].to_s, JS.global[:_rubyFileContent])`, "FileWrite");

      // Verify write
      const exists = App.eval(`File.exist?(JS.global[:_tempPath].to_s)`, "FileExistCheck").toJS();
      if (!exists) {
        console.error(`Failed to write ${vfsPath}`);
      }
      delete window._tempPath;
    }

    // Clean up
    delete window._rubyFileContent;

    // Add src to load path
    App.eval("$LOAD_PATH.unshift '/src'");

    // Load entry points
    const loadScript = (script) => {
      window._tempScript = script;
      App.eval(`
        begin
          require JS.global[:_tempScript].to_s
        rescue LoadError => e
          puts "Error loading #{JS.global[:_tempScript].to_s}: #{e.message}"
          puts e.backtrace
          raise e
        end
      `, `LoadScript`);
      delete window._tempScript;
      console.log(`Loaded ${script}`);
    };

    loadScript('/src/synthesizer.rb');
    loadScript('/src/sequencer.rb');
    loadScript('/src/js_bridge.rb');

    // Init Sequencer & Synth
    App.eval("$sequencer = Sequencer.new(JS.eval('return window.App.audioCtx;'), name: '$sequencer')");
    App.eval("$synth = $sequencer.current_track.synth");

    // Pattern Preview Sequencer
    App.eval("$patternSequencer = Sequencer.new(JS.eval('return window.App.audioCtx;'), name: '$patternSequencer', enable_analyser: false)");
    App.eval("$patternSequencer.add_rhythm_track");
    App.eval("$patternSequencer.set_patterns_reference($sequencer.patterns)");
    App.eval("$patternSequencer.set_total_bars(1)"); // Preview is 1 bar (32 steps)

    // Create a standalone synth for Chord Preview
    App.eval("$previewSynth = Synthesizer.new(JS.eval('return window.App.audioCtx;'))");
    App.eval("$previewSynth.connect_to_destination_with_compressor");

    console.log("Initialized");

    loadChords();
    setupTabs();
    setupUI(App);
    setupKeyboard(App);
    setupVisualizer(App);
    setupSequencer(App);
    setupPresets(App);
    setupChordView(App);
    setupPatternEditor(App);
  };
};

main();
