import { DefaultRubyVM } from "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.7.1/dist/esm/browser.js";

const startBtn = document.getElementById("start-btn");

const main = async () => {
  // Pre-load Ruby VM
  const response = await fetch("https://cdn.jsdelivr.net/npm/@ruby/3.3-wasm-wasi@2.7.1/dist/ruby.wasm");
  const buffer = await response.arrayBuffer();
  const module = await WebAssembly.compile(buffer);
  const { vm } = await DefaultRubyVM(module);
  
  window.rubyVM = vm; // For debugging
  console.log("Ruby VM loaded");

  startBtn.onclick = async () => {
    // AudioContext must be resumed/created on user interaction
    if (!window.audioCtx) {
        window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (window.audioCtx.state === 'suspended') {
        await window.audioCtx.resume();
    }

    console.log("Loading Ruby script...");
    // Fetch the Ruby script
    const scriptRes = await fetch("src/synthesizer.rb");
    if (!scriptRes.ok) {
        console.error("Failed to fetch src/synthesizer.rb");
        return;
    }
    const scriptText = await scriptRes.text();
    
    // Evaluate the script
    vm.eval(scriptText);
    
    // Invoke the demo function defined in Ruby
    try {
        vm.eval("play_demo");
    } catch (e) {
        console.error("Ruby execution failed:", e);
    }
  };
};

main();
