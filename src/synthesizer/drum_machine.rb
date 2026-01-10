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
    s.osc_type = "sine"
    s.filter_type = "lowpass"
    s.cutoff = 100.0
    s.resonance = 0.0
    s.attack = 0.01
    s.decay = 0.2
    s.sustain = 0.0
    s.release = 0.1
    s.lfo_on = false
    s.volume = 1.5
    s.connect(@master_gain)
    s
  end

  def create_snare
    s = Synthesizer.new(@ctx, enable_effects: false)
    s.osc_type = "triangle"
    # Actually snare needs noise. But our synth has simple osc.
    # Let's use high frequency triangle + noise if we could mix, but we can't in current Synth.
    # We'll stick to 'noise' osc type if available or Triangle with envelope.
    # Wait, Synth supports "noise" osc_type!
    s.osc_type = "noise"
    s.filter_type = "bandpass"
    s.cutoff = 1000.0
    s.resonance = 2.0
    s.attack = 0.01
    s.decay = 0.15
    s.sustain = 0.0
    s.release = 0.1
    s.lfo_on = false
    s.volume = 0.8
    s.connect(@master_gain)
    s
  end

  def create_hihat
    s = Synthesizer.new(@ctx, enable_effects: false)
    s.osc_type = "noise"
    s.filter_type = "highpass"
    s.cutoff = 5000.0
    s.resonance = 0.0
    s.attack = 0.01
    s.decay = 0.05
    s.sustain = 0.0
    s.release = 0.05
    s.lfo_on = false
    s.volume = 0.6
    s.connect(@master_gain)
    s
  end

  def create_openhat
    s = Synthesizer.new(@ctx, enable_effects: false)
    s.osc_type = "noise"
    s.filter_type = "highpass"
    s.cutoff = 4000.0
    s.resonance = 0.0
    s.attack = 0.02
    s.decay = 0.3
    s.sustain = 0.0
    s.release = 0.1
    s.lfo_on = false
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
           when "Kick" then 60.0
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
