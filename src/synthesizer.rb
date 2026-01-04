require "js"

class Voice
  def initialize(ctx, freq, synth_params, start_time, duration)
    @ctx = ctx
    @params = synth_params
    @start_time = start_time
    @stop_time = start_time + duration

    # --- VCO (Oscillator or Noise) ---
    if @params.osc_type == "noise"
      @vco = @ctx.call(:createBufferSource)
      @vco[:buffer] = @params.noise_buffer
      @vco[:loop] = true
    else
      @vco = @ctx.call(:createOscillator)
      @vco[:type] = @params.osc_type
      @vco[:frequency][:value] = freq
    end

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
      @lfo.start(@start_time)
      @lfo.stop(@stop_time + @params.release + 0.1)
    end

    # Connections: VCO -> VCF -> VCA -> Master Gain
    @vco.connect(@vcf)
    @vcf.connect(@vca)
    @vca.connect(@params.master_gain)
  end

  def start
    t = @start_time
    attack = @params.attack
    decay = @params.decay
    sustain = @params.sustain
    release = @params.release

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

    # Scheduled Release (Note Off)
    # Since we know duration, we can schedule the release phase immediately
    release_start = @stop_time
    gain_param.setValueAtTime(sus_val, release_start)
    gain_param.exponentialRampToValueAtTime(min_val, release_start + release)

    @vco.start(t)
    @vco.stop(release_start + release + 0.1)
  end

  # For manual stop (keyboard play), we might override or ignore if scheduled
  def stop_immediately
    now = @ctx[:currentTime].to_f
    release = @params.release
    min_val = 0.001

    gain_param = @vca[:gain]
    gain_param.cancelScheduledValues(now)
    current_gain = gain_param[:value].to_f
    gain_param.setValueAtTime(current_gain, now)
    gain_param.exponentialRampToValueAtTime(min_val, now + release)

    stop_t = now + release + 0.1
    @vco.stop(stop_t)
    @lfo.stop(stop_t) if @lfo
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
    @noise_buffer = create_noise_buffer
  end

  def close
    # Disconnect from destination to stop sound and allow GC
    if @analyser_node
      @analyser_node.disconnect
    end
    # Also stop any active voices
    @active_voices.values.each(&:stop_immediately)
    @active_voices.clear
  end

  def create_noise_buffer
    rate = @ctx[:sampleRate].to_f
    length = rate.to_i # 1 second of noise
    buffer = @ctx.call(:createBuffer, 1, length, rate)

    JS.eval(<<~JAVASCRIPT)
      const buffer = window._tempNoiseBuffer = window.audioCtx.createBuffer(1, #{length}, window.audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < #{length}; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    JAVASCRIPT
    JS.global[:_tempNoiseBuffer]
  end

  attr_reader :noise_buffer

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

  def volume=(val)
    # Default gain was 0.5, so 1.0 volume maps to 0.5
    @master_gain[:gain][:value] = val.to_f * 0.5
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

  def note_on(freq)
    return if @ctx.typeof == "undefined"

    if @ctx[:state] == "suspended"
      @ctx.call(:resume)
    end

    # Stop existing voice for this frequency if any
    if @active_voices[freq]
      @active_voices[freq].stop_immediately
    end

    voice = Voice.new(@ctx, freq, self, @ctx[:currentTime].to_f, 1000.0)
    @active_voices[freq] = voice
    voice.start
  end

  def note_off(freq)
    voice = @active_voices[freq]
    if voice
      voice.stop_immediately
      @active_voices.delete(freq)
    end
  end

  def schedule_note(freq, start_time, duration)
    # Fire and forget voice for sequencer
    voice = Voice.new(@ctx, freq, self, start_time, duration)
    voice.start
  end

  # --- Preset Management ---

  def export_settings
    # Create a JSON string manually to avoid dependency on 'json' gem if not present
    # Using %|| syntax to avoid quote escaping hell
    settings = [
      %|"osc_type": "#{@osc_type}"|,
      %|"filter_type": "#{@filter_type}"|,
      %|"cutoff": #{@cutoff}|,
      %|"resonance": #{@resonance}|,
      %|"attack": #{@attack}|,
      %|"decay": #{@decay}|,
      %|"sustain": #{@sustain}|,
      %|"release": #{@release}|,
      %|"lfo_on": #{@lfo_on}|,
      %|"lfo_waveform": "#{@lfo_waveform}"|,
      %|"lfo_rate": #{@lfo_rate}|,
      %|"lfo_depth": #{@lfo_depth}|,
      %|"delay_time": #{@delay_time}|,
      %|"delay_feedback": #{@delay_feedback}|,
      %|"delay_mix": #{@delay_mix}|,
      %|"reverb_seconds": #{@reverb_seconds}|,
      %|"reverb_mix": #{@reverb_mix}|
    ]
    "{#{settings.join(',')}}"
  end

  def import_settings(json_str)
    # Parse JSON using JavaScript engine
    data = JS.eval("return JSON.parse('#{json_str}')")

    # Update attributes and AudioNodes via setters
    self.osc_type = data[:osc_type].to_s
    self.filter_type = data[:filter_type].to_s
    self.cutoff = data[:cutoff].to_f
    self.resonance = data[:resonance].to_f

    self.attack = data[:attack].to_f
    self.decay = data[:decay].to_f
    self.sustain = data[:sustain].to_f
    self.release = data[:release].to_f

    self.lfo_on = data[:lfo_on] == true # JS boolean to Ruby boolean
    self.lfo_waveform = data[:lfo_waveform].to_s
    self.lfo_rate = data[:lfo_rate].to_f
    self.lfo_depth = data[:lfo_depth].to_f

    self.delay_time = data[:delay_time].to_f
    self.delay_feedback = data[:delay_feedback].to_f
    self.delay_mix = data[:delay_mix].to_f

    self.reverb_seconds = data[:reverb_seconds].to_f
    self.reverb_mix = data[:reverb_mix].to_f
  end
end