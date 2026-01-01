require "js"

class Voice
  def initialize(ctx, freq, synth_params)
    @ctx = ctx
    @params = synth_params
    @now = @ctx[:currentTime].to_f

    # --- VCO (Oscillator) ---
    @vco = @ctx.call(:createOscillator)
    @vco[:type] = @params.osc_type
    @vco[:frequency][:value] = freq

    # --- VCF (Filter) ---
    @vcf = @ctx.call(:createBiquadFilter)
    @vcf[:type] = @params.filter_type
    @vcf[:frequency][:value] = @params.cutoff
    @vcf[:Q][:value] = @params.resonance

    # --- VCA (Amplifier) ---
    @vca = @ctx.call(:createGain)
    @vca[:gain][:value] = 0.0 # Initial silence

    # --- LFO (Low Frequency Oscillator) ---
    if @params.lfo_on
      @lfo = @ctx.call(:createOscillator)
      @lfo[:type] = @params.lfo_waveform
      @lfo[:frequency][:value] = @params.lfo_rate

      @lfo_gain = @ctx.call(:createGain)
      @lfo_gain[:gain][:value] = @params.lfo_depth

      @lfo.connect(@lfo_gain)
      @lfo_gain.connect(@vcf[:frequency])
      @lfo.start(@now)
    end

    # Connections: VCO -> VCF -> VCA -> Master Gain
    @vco.connect(@vcf)
    @vcf.connect(@vca)
    @vca.connect(@params.master_gain)
  end

  def start
    t = @now
    attack = @params.attack
    decay = @params.decay
    sustain = @params.sustain

    # Web Audio API ramp quirk workaround
    min_val = 0.001

    gain_param = @vca[:gain]
    gain_param.cancelScheduledValues(t)
    gain_param.setValueAtTime(min_val, t)

    # Attack
    gain_param.linearRampToValueAtTime(1.0, t + attack)

    # Decay
    sus_val = (sustain <= 0) ? min_val : sustain
    gain_param.exponentialRampToValueAtTime(sus_val, t + attack + decay)

    @vco.start(t)
  end

  def stop
    now = @ctx[:currentTime].to_f
    release = @params.release
    min_val = 0.001

    gain_param = @vca[:gain]
    gain_param.cancelScheduledValues(now)

    # Current value for smooth release
    current_gain = gain_param[:value].to_f
    gain_param.setValueAtTime(current_gain, now)

    # Release
    gain_param.exponentialRampToValueAtTime(min_val, now + release)

    # Stop oscillators
    stop_time = now + release + 0.1
    @vco.stop(stop_time)
    @lfo.stop(stop_time) if @lfo
  end
end

class Synthesizer
  # Parameters
  attr_accessor :osc_type       # "sine", "square", "sawtooth", "triangle"
  attr_accessor :filter_type    # "lowpass", "highpass", "bandpass", "notch"
  attr_accessor :cutoff         # Hz
  attr_accessor :resonance      # Q factor
  attr_accessor :attack, :decay, :sustain, :release # ADSR
  attr_accessor :lfo_on, :lfo_waveform, :lfo_rate, :lfo_depth

  attr_reader :master_gain, :analyser_node

  def initialize(ctx)
    @ctx = ctx

    # --- Master Output & Analysis ---
    @master_gain = @ctx.call(:createGain)
    @master_gain[:gain][:value] = 0.5

    @analyser_node = @ctx.call(:createAnalyser)
    @analyser_node[:fftSize] = 2048

    @master_gain.connect(@analyser_node)
    @analyser_node.connect(@ctx[:destination])

    # Default presets
    @osc_type = "sawtooth"
    @filter_type = "lowpass"
    @cutoff = 2000.0
    @resonance = 5.0

    @attack = 0.1
    @decay = 0.2
    @sustain = 0.5
    @release = 0.5

    @lfo_on = true
    @lfo_waveform = "sine"
    @lfo_rate = 5.0
    @lfo_depth = 500.0

    @active_voices = {}
  end

  def note_on(note_number)
    return if @ctx.typeof == "undefined"

    if @ctx[:state] == "suspended"
      @ctx.call(:resume)
    end

    # Stop existing voice for this note if any
    if @active_voices[note_number]
      @active_voices[note_number].stop
    end

    freq = 440.0 * (2.0 ** ((note_number - 69) / 12.0))

    voice = Voice.new(@ctx, freq, self)
    @active_voices[note_number] = voice
    voice.start
  end

  def note_off(note_number)
    voice = @active_voices[note_number]
    if voice
      voice.stop
      @active_voices.delete(note_number)
    end
  end
end