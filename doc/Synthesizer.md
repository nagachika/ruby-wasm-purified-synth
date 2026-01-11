# Modular Synthesizer Architecture

This document defines the node architecture and the JSON schema used to construct the synthesizer patch.

## JSON Patch Schema

The `Synthesizer` and `Voice` classes expect a patch definition in the following JSON format:

```json
{
  "nodes": [
    {
      "id": "unique_string_id",
      "type": "NodeType",
      "params": {
        "param_name": "value"
      },
      "freq_track": boolean  // Optional: If true, this node's frequency tracks the note pitch (for Oscillators)
    }
  ],
  "connections": [
    {
      "from": "source_node_id",
      "to": "target_node_id"       // Connect to the node's main input
    },
    {
      "from": "source_node_id",
      "to": "target_node_id.param" // Connect to a specific parameter
    }
  ]
}
```

### Special Connection Targets
- `"out"`: connecting to `"to": "out"` routes the signal to the Voice's main output (usually triggering the ADSR release phase properly).

## Available Nodes

### Source Nodes

#### `Oscillator`
Standard periodic waveform generator.
- **Init Params:**
  - `type`: `"sine"`, `"square"`, `"sawtooth"`, `"triangle"`
  - `frequency`: Base frequency (Hz). Ignored if `freq_track: true`.
- **Audio Params (Inputs):**
  - `frequency`: Modulation of frequency (Hz).
  - `detune`: Detuning in cents.

#### `Noise`
White noise generator.
- **Init Params:** None.
- **Audio Params (Inputs):** None.

#### `Constant`
Outputs a constant DC value. Useful for control signals or offsets.
- **Init Params:**
  - `offset`: The constant value.
- **Audio Params (Inputs):**
  - `offset`: Modulate the constant value.

### Processor Nodes

#### `BiquadFilter`
Standard multi-mode filter.
- **Init Params:**
  - `type`: `"lowpass"`, `"highpass"`, `"bandpass"`, `"notch"`, `"peaking"`, `"allpass"`, `"lowshelf"`, `"highshelf"`
  - `frequency`: Cutoff frequency (Hz).
  - `q`: Q factor / Resonance.
- **Audio Params (Inputs):**
  - `frequency`: Cutoff modulation.
  - `detune`: Cutoff detuning.
  - `Q`: Resonance modulation.
  - `gain`: Gain (used for peaking/shelf filters).

#### `CombFilter`
A custom filter utilizing delay and feedback.
- **Init Params:**
  - `frequency`: Frequency of the comb notches (Hz).
  - `q`: Feedback amount (0.0 to ~0.95).
- **Audio Params (Inputs):**
  - `frequency`: Modulates delay time (inverse of frequency).
  - `q` / `resonance`: Modulates feedback gain.

#### `Gain`
Amplifies or attenuates the signal.
- **Init Params:**
  - `gain`: Initial gain value (default 1.0).
- **Audio Params (Inputs):**
  - `gain`: Amplitude modulation (AM).

#### `ADSR`
Envelope generator. Note: In this architecture, ADSR is treated as a signal source that outputs 0->1->0 values, usually connected to a `Gain` node's gain parameter.
- **Init Params:**
  - `attack`: Time in seconds.
  - `decay`: Time in seconds.
  - `sustain`: Level (0.0 - 1.0).
  - `release`: Time in seconds.
- **Audio Params (Inputs):** None.