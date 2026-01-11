require "js"
require_relative "synthesizer/nodes"
require_relative "synthesizer/voice"

class Synthesizer
  # Parameters
  attr_accessor :custom_patch

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
    @custom_patch = default_patch

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

  def default_patch
    {
      nodes: [
        { id: "vco", type: "Oscillator", freq_track: true, params: { type: "sawtooth" } },
        { id: "vcf", type: "BiquadFilter", params: { type: "lowpass", frequency: 2000.0, q: 5.0 } },
        { id: "vca", type: "Gain", params: { gain: 0.0 } },
        { id: "env", type: "ADSR", params: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.5 } },
        { id: "lfo", type: "Oscillator", params: { type: "sine", frequency: 5.0 } },
        { id: "lfo_gain", type: "Gain", params: { gain: 500.0 } }
      ],
      connections: [
        { from: "vco", to: "vcf" },
        { from: "vcf", to: "vca" },
        { from: "vca", to: "out" },
        { from: "env", to: "vca.gain" },
        { from: "lfo", to: "lfo_gain" },
        { from: "lfo_gain", to: "vcf.frequency" }
      ]
    }
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
      voice = Voice.new(@ctx, note_num, @custom_patch, self)
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
      voice = Voice.new(@ctx, note_num, @custom_patch, self)
      voice.start(start_time, velocity: velocity)
      voice.stop(start_time + duration)
    end
  # --- Preset Management ---

  def import_patch(json_str)
    js_obj = JS.global[:JSON].call(:parse, json_str)
    @custom_patch = js_to_ruby(js_obj)
  end

  def export_patch
    # Convert ruby hash/arrays to JSON string via JS
    # Since we don't have a direct Ruby->JSON serializer without 'json' gem,
    # we can construct a JS object and stringify it.
    patch = @custom_patch
    js_obj = ruby_to_js(patch)
    JS.global[:JSON].call(:stringify, js_obj).to_s
  end

  private

  def ruby_to_js(obj)
    if obj.is_a?(Hash)
      js_obj = JS.global[:Object].new
      obj.each do |k, v|
        js_obj[k.to_s] = ruby_to_js(v)
      end
      js_obj
    elsif obj.is_a?(Array)
      js_arr = JS.global[:Array].new
      obj.each_with_index do |v, i|
        js_arr[i] = ruby_to_js(v)
      end
      js_arr
    else
      # Primitive
      obj
    end
  end

  def js_to_ruby(obj)
    return nil if obj.typeof == "undefined"
    return nil if JS.global.call(:String, obj).to_s == "null"

    case obj.typeof
    when "object"
      if obj.is_a?(JS::Object) && obj[:length].typeof == "number"
        # Array
        (0...obj[:length].to_i).map { |i| js_to_ruby(obj[i]) }
      else
        # Object/Hash
        hash = {}
        keys = JS.global[:Object].call(:keys, obj)
        (0...keys[:length].to_i).each do |i|
          key = keys[i]
          str_key = key.to_s
          hash[str_key.to_sym] = js_to_ruby(obj[str_key])
        end
        hash
      end
    when "boolean"
      obj.to_s == "true"
    when "number"
      obj.to_f
    when "string"
      obj.to_s
    else
      obj
    end
  end
end
