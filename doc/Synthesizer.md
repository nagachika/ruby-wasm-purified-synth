# Modular Synthesizer Architecture Design

This document outlines the refactoring plan for the `Synthesizer` class, transitioning from a monolithic, hardcoded voice architecture to a flexible, node-based modular system.

## 1. Core Concepts

The synthesizer follows a **Semi-Modular Polyphonic** architecture.

*   **Global Graph (Shared)**: A fixed (or configurable) chain of effects (Delay, Reverb, Compressor) applied to the mixed output of all voices.
*   **Voice Graph (Polyphonic)**: A dynamic graph of nodes instantiated for *each* active note. Unlike the previous implementation, the internal structure of a Voice is **fully modular**, allowing arbitrary connections between oscillators, filters, and envelopes.

## 2. Structural Layers

### 2.1 Voice Layer (Per-Note)
When a note is triggered, a new `Voice` instance is created. This instance builds a Web Audio graph based on the current **Patch Definition**.

**Capabilities:**
*   **Arbitrary Routing**: Nodes can be connected freely.
    *   Audio Path: `Osc1` -> `Filter` -> `VCA` -> `Output`
    *   FM Synthesis: `Osc1` -> `Osc2.frequency`
    *   AM Synthesis / Ring Mod: `Osc1` -> `Gain.gain` (processing Osc2)
*   **Modulation**: Control signals (LFO, Envelopes) can drive *any* `AudioParam` (Frequency, Detune, Gain, Q, etc.).
*   **Multiple Sources**: Mixing multiple oscillators, noise generators, or constant sources.

**Lifecycle:**
1.  **Note On**: The graph is built, oscillators started, and Attack/Decay phases of envelopes triggered.
2.  **Note Off**: Release phase of envelopes triggered.
3.  **Cleanup**: When the amplitude envelope finishes (or a timeout occurs), the nodes are disconnected and destroyed.

### 2.2 Global Layer (Master FX)
Processes the summed output of all active voices. Since creating Reverbs/Delays for every voice is computationally expensive, these remain global.

**Chain:**
`Voice Sum` -> `Mix Node` -> `Delay` -> `Reverb` -> `DynamicsCompressor` -> `Master Gain` -> (Output)

*   **Output**: The `Synthesizer` does not connect directly to `AudioContext.destination`. It exposes its final output node (or a `connect` method) so the `Sequencer` or host app can route it (e.g., to a visualizer or recording node).

## 3. Node Types

We will introduce Ruby wrapper classes for Web Audio nodes to unify interface and manage connections.

### 3.1 Audio Nodes (Signal Sources & Processors)
| Node Type | Wrapper Class | Usage |
| :--- | :--- | :--- |
| **Oscillator** | `OscillatorNode` | Sine, Square, Sawtooth, Triangle. Used for audible sound (VCO) or modulation (LFO). |
| **Noise** | `NoiseNode` | White/Pink noise (via `AudioBufferSourceNode`). |
| **Constant** | `ConstantNode` | `ConstantSourceNode`. Outputs a fixed DC offset. Crucial for shifting modulation ranges or setting base parameters. |
| **Gain** | `GainNode` | VCA, Mixer, Amplitude modulation, Modulation depth control. |
| **Filter** | `BiquadFilterNode` | Lowpass, Highpass, Bandpass, Notch, etc. |
| **Delay** | `DelayNode` | Echo/Delay effects (Global layer). |
| **Convolver** | `ConvolverNode` | Reverb (Global layer). |
| **Compressor** | `CompressorNode` | Dynamics compression (Global layer). |

### 3.2 Modulators (Control Logic)
These abstractions manage `AudioParam` automation.

*   **ADSR Envelope**:
    *   Not a native Web Audio node (usually). Implemented as a controller that schedules ramps on a target `AudioParam`.
    *   **Inputs**: Gate (Note On/Off).
    *   **Targets**: Typically `GainNode.gain` (VCA) or `BiquadFilterNode.frequency` (VCF).

## 4. Patch Data Structure

The synthesis structure is defined by a data object (Patch). This allows for serialization and future UI editing.

**JSON Schema Concept:**

```json
{
  "voice": {
    "nodes": [
      { "id": "osc1", "type": "Oscillator", "freq_track": true, "params": { "type": "sawtooth" } },
      { "id": "osc2", "type": "Oscillator", "freq_track": true, "params": { "type": "sine", "detune": 10 } },
      { "id": "lfo1", "type": "Oscillator", "params": { "type": "sine", "frequency": 5 } },
      { "id": "lfo_depth", "type": "Gain", "params": { "gain": 100 } },
      { "id": "filter", "type": "BiquadFilter", "params": { "type": "lowpass", "frequency": 2000, "q": 1.0 } },
      { "id": "vca", "type": "Gain", "params": { "gain": 0 } },
      { "id": "env1", "type": "ADSR", "params": { "attack": 0.01, "decay": 0.1, "sustain": 0.5, "release": 0.5 } }
    ],
    "connections": [
      { "from": "osc1", "to": "filter" },
      { "from": "osc2", "to": "filter" },
      // Modulation: LFO -> Gain (Depth) -> Osc1 Detune
      { "from": "lfo1", "to": "lfo_depth" },
      { "from": "lfo_depth", "to": "osc1.detune" },
      // Audio Chain
      { "from": "filter", "to": "vca" },
      // Envelope Control
      { "from": "env1", "to": "vca.gain" },
      // Final Output of Voice
      { "from": "vca", "to": "out" }
    ]
  },
  "global": {
    "delay": { "time": 0.3, "feedback": 0.4, "mix": 0.2 },
    "reverb": { "seconds": 2.0, "mix": 0.3 }
  }
}
```

## 5. Class Design (Ruby)

### `Synthesizer`
*   **Role**: Facade, Voice Manager, Global FX container.
*   **Members**:
    *   `@voice_definition`: The parsed patch structure.
    *   `@active_voices`: Hash `{ note_number => VoiceInstance }`.
    *   `@output_node`: Final GainNode of the global chain.
*   **Methods**:
    *   `note_on(note, velocity)`
    *   `note_off(note)`
    *   `connect(destination)`
    *   `load_patch(json)`

### `Voice`
*   **Role**: Manages the lifecycle of a single note's graph.
*   **Constructor**: `Voice.new(ctx, note, definition, output_bus)`
    *   Parses `definition[:nodes]` and creates wrappers.
    *   Parses `definition[:connections]` and links nodes/params.
    *   Handles "special" connections like `target: "out"`.
    *   Applies `note` frequency to oscillators marked as keyboard-tracking.

### `AudioNodeWrapper` (Base)
*   **Role**: Wraps `JS::Object`, manages connections.
*   **Methods**:
    *   `connect(target)`: Handles `AudioNode` vs `AudioParam` connections.
    *   `disconnect()`
    *   `param(name)`: Returns `AudioParamWrapper`.

## 6. Implementation Roadmap

1.  **Node Wrappers**: Create the `AudioNodeWrapper` hierarchy in `src/synthesizer/nodes.rb` (or similar).
2.  **Voice Factory**: Implement the logic to instantiate and connect nodes from the JSON definition.
3.  **Synthesizer Refactor**: Update `src/synthesizer.rb` to use the new Voice system and Global chain.
4.  **Preset Migration**: Update existing hardcoded presets to the new JSON format.
