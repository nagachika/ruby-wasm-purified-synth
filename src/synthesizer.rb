require "js"
require_relative "synthesizer/nodes"
require_relative "synthesizer/voice"

class Synthesizer
  # Parameters
  attr_accessor :osc_type       # "sine", "square", "sawtooth", "triangle", "noise"
  attr_accessor :filter_type    # "lowpass", "highpass", "bandpass", "notch"
  attr_accessor :cutoff         # Hz
  attr_accessor :resonance      # Q factor
  attr_accessor :attack, :decay, :sustain, :release # ADSR
  attr_accessor :lfo_on, :lfo_waveform, :lfo_rate, :lfo_depth

  # Effect Parameters
  attr_reader :delay_time, :delay_feedback, :delay_mix
  attr_reader :reverb_seconds, :reverb_mix

  attr_reader :master_gain, :analyser_node

  def initialize(ctx, enable_effects: true)
    @ctx = ctx
    @enable_effects = enable_effects

    # Defaults
    @delay_time_val = 0.3
    @delay_feedback_val = 0.4
    @delay_mix_val = 0.3
    @reverb_seconds_val = 2.0
    @reverb_mix_val = 0.3

    build_global_graph
    setup_default_params

    @active_voices = {}
    @noise_buffer = create_noise_buffer
  end

  def build_global_graph
    # --- Master Output ---
    @master_gain = GainNode.new(@ctx, gain: 0.5)

    if @enable_effects
      # --- Delay Effect ---
      @delay_node = DelayNode.new(@ctx, delay_time: @delay_time_val)
      @delay_feedback_gain = GainNode.new(@ctx, gain: @delay_feedback_val)
      @delay_wet_gain = GainNode.new(@ctx, gain: @delay_mix_val)
      @delay_dry_gain = GainNode.new(@ctx, gain: 1.0 - @delay_mix_val)
      @delay_output = GainNode.new(@ctx)

      # --- Reverb Effect ---
      @convolver = ConvolverNode.new(@ctx)
      @reverb_wet_gain = GainNode.new(@ctx, gain: @reverb_mix_val)
      @reverb_dry_gain = GainNode.new(@ctx, gain: 1.0 - @reverb_mix_val)
      @reverb_output = GainNode.new(@ctx)

      # --- Routing Chain ---
      # Input to Global Graph is @master_gain (Voices connect here)

      # 1. Delay Block
      @master_gain.connect(@delay_node)
      @master_gain.connect(@delay_dry_gain)

      @delay_node.connect(@delay_feedback_gain)
      @delay_feedback_gain.connect(@delay_node)

      @delay_node.connect(@delay_wet_gain)
      @delay_wet_gain.connect(@delay_output)
      @delay_dry_gain.connect(@delay_output)

      # 2. Reverb Block
      @delay_output.connect(@convolver)
      @delay_output.connect(@reverb_dry_gain)

      @convolver.connect(@reverb_wet_gain)
      @reverb_wet_gain.connect(@reverb_output)
      @reverb_dry_gain.connect(@reverb_output)

      # 3. Final Analysis & Output
      @analyser_node = AnalyserNode.new(@ctx)
      @analyser_node.fft_size = 2048

      # Reverb Output -> Analyser
      @reverb_output.connect(@analyser_node)

      update_reverb_buffer
    else
      # Minimal graph
      @analyser_node = AnalyserNode.new(@ctx)
      @master_gain.connect(@analyser_node)
    end
  end

  def connect(destination)
    @analyser_node.connect(destination)
  end

  def connect_to_destination_with_compressor
    # Create a dedicated compressor for standalone usage
    comp = DynamicsCompressorNode.new(@ctx)
    comp.threshold.value = -24.0
    comp.knee.value = 30.0
    comp.ratio.value = 12.0
    comp.attack.value = 0.003
    comp.release.value = 0.25

    @analyser_node.connect(comp)
    comp.connect(@ctx[:destination])

    # Return comp so we can keep track if needed, though mostly fire-and-forget for simple usage
    comp
  end

  def setup_default_params
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
  end

  def close
    @analyser_node.disconnect
    @active_voices.values.each(&:stop_immediately)
    @active_voices.clear
  end

  def create_noise_buffer
    rate = @ctx[:sampleRate].to_f
    length = rate.to_i # 1 second of noise

    # Using raw JS for buffer creation as before
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

  # Custom setters
  def delay_time=(val)
    @delay_time_val = val.to_f
    @delay_node.delay_time.value = @delay_time_val if @delay_node
  end

  def delay_feedback=(val)
    @delay_feedback_val = val.to_f
    @delay_feedback_gain.gain.value = @delay_feedback_val if @delay_feedback_gain
  end

  def delay_mix=(val)
    @delay_mix_val = val.to_f
    @delay_wet_gain.gain.value = @delay_mix_val if @delay_wet_gain
    @delay_dry_gain.gain.value = 1.0 - @delay_mix_val if @delay_dry_gain
  end

  def reverb_seconds=(val)
    @reverb_seconds_val = val.to_f
    update_reverb_buffer if @enable_effects
  end

  def reverb_mix=(val)
    @reverb_mix_val = val.to_f
    @reverb_wet_gain.gain.value = @reverb_mix_val if @reverb_wet_gain
    @reverb_dry_gain.gain.value = 1.0 - @reverb_mix_val if @reverb_dry_gain
  end

  def volume=(val)
    @master_gain.gain.value = val.to_f * 0.5
  end

  def update_reverb_buffer
    return unless @enable_effects
    rate = @ctx[:sampleRate].to_f
    length = (rate * @reverb_seconds_val).to_i

    JS.eval(<<~JAVASCRIPT)
      const ctx = window.audioCtx;
      const length = #{length};
      const seconds = #{@reverb_seconds_val};
      const decay = 2.0;
      const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

      for (let c = 0; c < 2; c++) {
        const channelData = buffer.getChannelData(c);
        for (let i = 0; i < length; i++) {
          channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
        }
      }
      window._tempReverbBuffer = buffer;
    JAVASCRIPT

    @convolver.buffer = JS.global[:_tempReverbBuffer]
  end

    def freq_to_note(freq)
      (69 + 12 * Math.log2(freq / 440.0)).round
    end

    def current_patch
      {
        nodes: [
          { id: "vco", type: @osc_type == "noise" ? "Noise" : "Oscillator", freq_track: true, params: { type: @osc_type } },
          { id: "vcf", type: "BiquadFilter", params: { type: @filter_type, frequency: @cutoff, q: @resonance } },
          { id: "vca", type: "Gain", params: { gain: 0.0 } },
          { id: "env", type: "ADSR", params: { attack: @attack, decay: @decay, sustain: @sustain, release: @release } },
          @lfo_on ? { id: "lfo", type: "Oscillator", params: { type: @lfo_waveform, frequency: @lfo_rate } } : nil,
          @lfo_on ? { id: "lfo_gain", type: "Gain", params: { gain: @lfo_depth } } : nil
        ].compact,
        connections: [
          { from: "vco", to: "vcf" },
          { from: "vcf", to: "vca" },
          { from: "vca", to: "out" },
          { from: "env", to: "vca.gain" },
          @lfo_on ? { from: "lfo", to: "lfo_gain" } : nil,
          @lfo_on ? { from: "lfo_gain", to: "vcf.frequency" } : nil
        ].compact
      }
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

      note_num = freq_to_note(freq)
      voice = Voice.new(@ctx, note_num, current_patch, self)
      @active_voices[freq] = voice
      voice.start(@ctx[:currentTime].to_f)
    end

    def note_off(freq)
      voice = @active_voices[freq]
      if voice
        voice.stop(@ctx[:currentTime].to_f)
        @active_voices.delete(freq)
      end
    end

    def schedule_note(freq, start_time, duration, velocity: 0.8)
      note_num = freq_to_note(freq)
      voice = Voice.new(@ctx, note_num, current_patch, self)
      voice.start(start_time, velocity: velocity)
      voice.stop(start_time + duration)
    end
  # --- Preset Management ---

  def export_settings
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
      %|"delay_time": #{@delay_time_val}|,
      %|"delay_feedback": #{@delay_feedback_val}|,
      %|"delay_mix": #{@delay_mix_val}|,
      %|"reverb_seconds": #{@reverb_seconds_val}|,
      %|"reverb_mix": #{@reverb_mix_val}|
    ]
    "{#{settings.join(',')}}"
  end

  def import_settings(json_str)
    data = JS.eval("return JSON.parse('#{json_str}')")

    self.osc_type = data[:osc_type].to_s
    self.filter_type = data[:filter_type].to_s
    self.cutoff = data[:cutoff].to_f
    self.resonance = data[:resonance].to_f

    self.attack = data[:attack].to_f
    self.decay = data[:decay].to_f
    self.sustain = data[:sustain].to_f
    self.release = data[:release].to_f

    self.lfo_on = data[:lfo_on] == true
    self.lfo_waveform = data[:lfo_waveform].to_s
    self.lfo_rate = data[:lfo_rate].to_f
    self.lfo_depth = data[:lfo_depth].to_f

    if @enable_effects
      self.delay_time = data[:delay_time].to_f
      self.delay_feedback = data[:delay_feedback].to_f
      self.delay_mix = data[:delay_mix].to_f

      self.reverb_seconds = data[:reverb_seconds].to_f
      self.reverb_mix = data[:reverb_mix].to_f
    end
  end
end
