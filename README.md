# Ruby/WASM Purified Synth

A polyphonic subtractive synthesizer and microtonal sequencer running entirely in the browser using Ruby/WASM and the Web Audio API.

## Features

*   **Polyphonic Synthesizer**: Supports simultaneous notes with a full subtractive synthesis engine.
    *   **VCO**: Sawtooth, Square, Triangle, Sine, and Noise waveforms.
    *   **VCF**: Multi-mode filter (Lowpass, Highpass, Bandpass, Notch) with Cutoff and Resonance.
    *   **VCA**: ADSR envelope for amplitude control.
    *   **LFO**: Modulates filter cutoff.
    *   **Effects**: Stereo Delay and Convolution Reverb.
    *   **Presets**: Save and load your sound design settings.
*   **Multi-Track Lattice Sequencer**:
    *   **Multiple Tracks**: Compose with multiple independent synthesizer instances.
    *   **Block-Based Arrangement**: Arrange your composition using reusable patterns (blocks).
    *   **Microtonal Tuning**: Just Intonation tuning based on harmonic ratios (3rd, 5th, 7th, 11th harmonics).
*   **Chord Editor**:
    *   **Visual Design**: Construct complex microtonal chords on a harmonic lattice grid.
    *   **Library**: Save and organize your custom chords for use in the sequencer.
*   **Visualizer**: Real-time Oscilloscope and Spectrum Analyzer.
*   **Interactive UI**: Tabbed interface for Synthesis, Chord design, and Sequencing.

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

4.  **Usage**:
    *   **Synthesizer Tab**:
        *   Play manually using your keyboard (Z, X, C...).
        *   Adjust oscillators, filters, and effects.
        *   Save your settings as Presets.
    *   **Chord Tab**:
        *   Create new chords by clicking on the lattice grid.
        *   Use the **Y-Axis Dimension** selector to explore 5-limit (Major 3rd), 7-limit (Harmonic 7th), or 11-limit harmonies.
        *   Save chords to your library with a custom name.
    *   **Sequencer Tab**:
        *   **Add Tracks**: Create separate tracks for different parts (Bass, Lead, Pad).
        *   **Add Blocks**: Click on the timeline to add a pattern block.
        *   **Edit Blocks**: Assign a saved chord to a block or edit its notes directly on the lattice.
        *   **Play**: Press Play to hear your microtonal composition.

## Project Structure

-   `index.html`: The main user interface with tabbed views for Synthesizer, Chord Editor, and Sequencer.
-   `main.js`: Initializes Ruby/WASM, handles UI events, and manages the main loop.
-   `src/synthesizer.rb`: Core synthesis logic (Voice allocation, AudioNode graph, Presets).
-   `src/sequencer.rb`: Logic for the Multi-track Sequencer, Tracks, Blocks, and Note Coordinates.
-   `doc/TUNING.md`: Detailed explanation of the Just Intonation tuning system.
-   `Rakefile`: Development tasks.

## Technology Stack

-   **Language**: Ruby (compiled to WebAssembly via ruby.wasm)
-   **Audio API**: Web Audio API (accessed via the `js` gem)
-   **Environment**: Modern Web Browser (Chrome, Firefox, Safari, Edge)

## Development Notes

-   **Ruby/JS Interop**: The project uses the `js` gem to interact with Web Audio API objects directly from Ruby.
-   **Hot Reload**: Editing Ruby files in `src/` requires a page refresh to take effect.