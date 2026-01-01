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

  # Effect Parameters
  attr_accessor :delay_time, :delay_feedback, :delay_mix
  attr_accessor :reverb_seconds, :reverb_mix

  attr_reader :master_gain, :analyser_node

  def initialize(ctx)
    @ctx = ctx

    # --- Master Output ---
    @master_gain = @ctx.call(:createGain)
    @master_gain[:gain][:value] = 0.5

    # --- Delay Effect ---
    @delay_node = @ctx.call(:createDelay)
    @delay_feedback_gain = @ctx.call(:createGain)
    @delay_wet_gain = @ctx.call(:createGain)
    @delay_dry_gain = @ctx.call(:createGain)
    @delay_output = @ctx.call(:createGain) # Combine Wet/Dry

    # --- Reverb Effect ---
    @convolver = @ctx.call(:createConvolver)
    @reverb_wet_gain = @ctx.call(:createGain)
    @reverb_dry_gain = @ctx.call(:createGain)
    @reverb_output = @ctx.call(:createGain) # Combine Wet/Dry

    # Defaults
    @delay_time = 0.3
    @delay_feedback = 0.4
    @delay_mix = 0.3 

    @reverb_seconds = 2.0
    @reverb_mix = 0.3

    # Setup Delay Nodes
    @delay_node[:delayTime][:value] = @delay_time
    @delay_feedback_gain[:gain][:value] = @delay_feedback
    @delay_wet_gain[:gain][:value] = @delay_mix
    @delay_dry_gain[:gain][:value] = 1.0 - @delay_mix

    # Setup Reverb IR
    update_reverb_buffer

    @reverb_wet_gain[:gain][:value] = @reverb_mix
    @reverb_dry_gain[:gain][:value] = 1.0 - @reverb_mix

    # --- Routing Chain ---
    
    # 1. Delay Block
    # Input: @master_gain
    @master_gain.connect(@delay_node)
    @master_gain.connect(@delay_dry_gain)

    # Feedback Loop
    @delay_node.connect(@delay_feedback_gain)
    @delay_feedback_gain.connect(@delay_node)

    # Output Mixing
    @delay_node.connect(@delay_wet_gain)
    @delay_wet_gain.connect(@delay_output)
    @delay_dry_gain.connect(@delay_output)

    # 2. Reverb Block
    # Input: @delay_output
    @delay_output.connect(@convolver)
    @delay_output.connect(@reverb_dry_gain)

    # Output Mixing
    @convolver.connect(@reverb_wet_gain)
    @reverb_wet_gain.connect(@reverb_output)
    @reverb_dry_gain.connect(@reverb_output)

    # 3. Final Analysis & Output
    @analyser_node = @ctx.call(:createAnalyser)
    @analyser_node[:fftSize] = 2048

    @reverb_output.connect(@analyser_node)
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

  # Custom setters to update audio nodes immediately
  def delay_time=(val)
    @delay_time = val.to_f
    @delay_node[:delayTime][:value] = @delay_time
  end

  def delay_feedback=(val)
    @delay_feedback = val.to_f
    @delay_feedback_gain[:gain][:value] = @delay_feedback
  end

  def delay_mix=(val)
    @delay_mix = val.to_f
    # Constant power panning or linear crossfade
    @delay_wet_gain[:gain][:value] = @delay_mix
    @delay_dry_gain[:gain][:value] = 1.0 - @delay_mix
  end

  def reverb_seconds=(val)
    @reverb_seconds = val.to_f
    update_reverb_buffer
  end

  def reverb_mix=(val)
    @reverb_mix = val.to_f
    @reverb_wet_gain[:gain][:value] = @reverb_mix
    @reverb_dry_gain[:gain][:value] = 1.0 - @reverb_mix
  end

  def update_reverb_buffer
    rate = @ctx[:sampleRate].to_f
    length = (rate * @reverb_seconds).to_i

    # Generate impulse response buffer using JavaScript for performance.
    # Ruby loops over large arrays can be slow when crossing the WASM boundary frequently.
    JS.eval(<<~JAVASCRIPT)
      const ctx = window.audioCtx;
      const length = #{length};
      const seconds = #{@reverb_seconds};
      const decay = 2.0;
      const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
      
      for (let c = 0; c < 2; c++) {
        const channelData = buffer.getChannelData(c);
        for (let i = 0; i < length; i++) {
          // Simple exponential decay noise
          channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
        }
      }
      // Store it temporarily to retrieve
      window._tempReverbBuffer = buffer;
    JAVASCRIPT

    # Assign the buffer from the temporary JS global
    @convolver[:buffer] = JS.global[:_tempReverbBuffer]
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