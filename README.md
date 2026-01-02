# Ruby/WASM Web Synth

A polyphonic subtractive synthesizer running entirely in the browser using Ruby/WASM and the Web Audio API.

## Features

*   **Polyphonic Synthesizer**: Supports simultaneous notes (chords).
*   **Subtractive Synthesis Engine**:
    *   **VCO**: Oscillator with Sawtooth, Square, Triangle, and Sine waveforms.
    *   **VCF**: Multi-mode filter (Lowpass, Highpass, Bandpass, Notch) with Cutoff and Resonance controls.
    *   **VCA**: Amplifier with ADSR (Attack, Decay, Sustain, Release) envelope.
    *   **LFO**: Low Frequency Oscillator modulating the filter cutoff.
*   **Lattice Sequencer**:
    *   **Microtonal Tuning**: Based on Just Intonation ratios rather than equal temperament.
    *   **5-Limit & Beyond**: Construct harmonies using 3rd, 5th, 7th, and 11th harmonics.
    *   **Grid Interface**: Visual chord construction on a harmonic lattice.
    *   **Documentation**: See [Just Intonation Lattice Tuning System](doc/TUNING.md) for details on how pitch is calculated and visualized.
*   **Effects Chain**:
    *   **Delay**: Stereo delay with Time, Feedback, and Mix controls.
    *   **Reverb**: Convolution reverb with procedural Impulse Response generation (Decay Time and Mix controls).
*   **Visualizer**: Real-time visualization of the audio output (Oscilloscope / Spectrum Analyzer).
*   **Interactive UI**: Full control over synthesis parameters via HTML inputs.
*   **Keyboard Support**: Play notes using your computer keyboard (Standard 12-TET mapped to Hz).

## Quick Start

1.  **Install Dependencies**:
    ```bash
    bundle install
    ```

2.  **Start Development Server**:
    ```bash
    rake server
    ```

3.  **Open in Browser**:
    Visit `http://localhost:8000`.

4.  **Play**:
    *   Click "Click to Start" to initialize the audio engine.
    *   **Manual Play**: Use your keyboard to play standard notes (Z, X, C...).
    *   **Sequencer**: Click the grid buttons to open the **Step Editor**. Construct microtonal chords on the lattice grid. Press "Play" to hear the sequence.

## Project Structure

-   `index.html`: The main user interface and entry point.
-   `main.js`: Initializes the Ruby VM, handles UI interactions, and bridges JavaScript events to Ruby.
-   `src/synthesizer.rb`: The core synthesizer logic written in Ruby. Handles voice allocation, audio graph construction, and parameter updates.
-   `src/sequencer.rb`: The lattice-based sequencer logic.
-   `doc/TUNING.md`: Detailed explanation of the Just Intonation tuning system and grid interface.
-   `Rakefile`: Tasks for development (running the server).
-   `GEMINI.md`: Project-specific context and guidelines for AI assistance.

## Technology Stack

-   **Language**: Ruby (compiled to WebAssembly via ruby.wasm)
-   **Audio API**: Web Audio API
-   **Environment**: Modern Web Browser (Chrome, Firefox, Safari, Edge)

## Development Notes

-   **Ruby/JS Interop**: The project uses the `js` gem to interact with Web Audio API objects directly from Ruby.
-   **Real-time Updates**: Editing `src/synthesizer.rb` and refreshing the browser will immediately reflect changes, as the Ruby script is fetched and evaluated at runtime.