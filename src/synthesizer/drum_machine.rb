require "js"
require_relative "../synthesizer"

class DrumMachine
  attr_reader :instruments, :master_gain, :analyser_node

  def initialize(ctx)
    @ctx = ctx
    @master_gain = GainNode.new(@ctx, gain: 0.8)

    # Common FX for Drum Bus (optional, keep it simple for now)
    @compressor = DynamicsCompressorNode.new(@ctx)
    @compressor.threshold.value = -18.0
    @compressor.ratio.value = 4.0
    @master_gain.connect(@compressor)

    @analyser_node = AnalyserNode.new(@ctx)
    @compressor.connect(@analyser_node)

    @instruments = {}
    setup_instruments
  end

  def setup_instruments
    # Create lightweight synthesizers (no heavy effects) for each drum part
    @instruments["Kick"] = create_kick
    @instruments["Snare"] = create_snare
    @instruments["HiHat"] = create_hihat
    @instruments["OpenHat"] = create_openhat
  end

  def create_kick
    s = Synthesizer.new(@ctx, enable_effects: false)
    s.custom_patch = {
      nodes: [
        { id: "vco", type: "Oscillator", freq_track: true, params: { type: "triangle" } },
        { id: "vcf", type: "BiquadFilter", params: { type: "lowpass", frequency: 100.0, q: 0.0 } },
        { id: "vca", type: "Gain", params: { gain: 0.0 } },
        { id: "env", type: "ADSR", params: { attack: 0.01, decay: 0.2, sustain: 0.0, release: 0.1 } }
      ],
      connections: [
        { from: "vco", to: "vcf" },
        { from: "vcf", to: "vca" },
        { from: "vca", to: "out" },
        { from: "env", to: "vca.gain" }
      ]
    }
    s.volume = 1.5
    s.connect(@master_gain)
    s
  end

  def create_snare
    s = Synthesizer.new(@ctx, enable_effects: false)
    s.custom_patch = {
      nodes: [
        { id: "vco", type: "Noise", params: { type: "white" } },
        { id: "vcf", type: "BiquadFilter", params: { type: "bandpass", frequency: 1000.0, q: 2.0 } },
        { id: "vca", type: "Gain", params: { gain: 0.0 } },
        { id: "env", type: "ADSR", params: { attack: 0.01, decay: 0.15, sustain: 0.0, release: 0.1 } }
      ],
      connections: [
        { from: "vco", to: "vcf" },
        { from: "vcf", to: "vca" },
        { from: "vca", to: "out" },
        { from: "env", to: "vca.gain" }
      ]
    }
    s.volume = 0.8
    s.connect(@master_gain)
    s
  end

  def create_hihat
    s = Synthesizer.new(@ctx, enable_effects: false)
    s.custom_patch = {
      nodes: [
        { id: "vco", type: "Noise", params: { type: "white" } },
        { id: "vcf", type: "BiquadFilter", params: { type: "highpass", frequency: 5000.0, q: 0.0 } },
        { id: "vca", type: "Gain", params: { gain: 0.0 } },
        { id: "env", type: "ADSR", params: { attack: 0.01, decay: 0.05, sustain: 0.0, release: 0.05 } }
      ],
      connections: [
        { from: "vco", to: "vcf" },
        { from: "vcf", to: "vca" },
        { from: "vca", to: "out" },
        { from: "env", to: "vca.gain" }
      ]
    }
    s.volume = 0.6
    s.connect(@master_gain)
    s
  end

  def create_openhat
    s = Synthesizer.new(@ctx, enable_effects: false)
    s.custom_patch = {
      nodes: [
        { id: "vco", type: "Noise", params: { type: "white" } },
        { id: "vcf", type: "BiquadFilter", params: { type: "highpass", frequency: 4000.0, q: 0.0 } },
        { id: "vca", type: "Gain", params: { gain: 0.0 } },
        { id: "env", type: "ADSR", params: { attack: 0.02, decay: 0.3, sustain: 0.0, release: 0.1 } }
      ],
      connections: [
        { from: "vco", to: "vcf" },
        { from: "vcf", to: "vca" },
        { from: "vca", to: "out" },
        { from: "env", to: "vca.gain" }
      ]
    }
    s.volume = 0.6
    s.connect(@master_gain)
    s
  end

  def connect(destination)
    @analyser_node.connect(destination)
  end

  def volume=(val)
    @master_gain.gain.value = val.to_f
  end

  def trigger(instrument_name, time, velocity = 0.8)
    synth = @instruments[instrument_name]
    return unless synth

    # Trigger with a fixed pitch appropriate for the instrument
    freq = case instrument_name
           when "Kick" then 80.0
           when "Snare" then 200.0
           when "HiHat", "OpenHat" then 1000.0
           else 440.0
           end

    # Duration based on decay/release roughly
    duration = 0.5
    synth.schedule_note(freq, time, duration, velocity: velocity)
  end

  def close
    @instruments.values.each(&:close)
    @master_gain.disconnect
    @analyser_node.disconnect
  end
end
