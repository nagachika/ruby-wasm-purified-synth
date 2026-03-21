require "js"
require_relative "synthesizer/nodes"

class EffectsChain
  attr_reader :input_node, :output_node
  attr_reader :delay_time, :delay_feedback, :delay_mix
  attr_reader :reverb_seconds, :reverb_mix

  def initialize(ctx)
    @ctx = ctx

    # Defaults
    @delay_time = 0.3
    @delay_feedback = 0.4
    @delay_mix = 0.3
    @reverb_seconds = 2.0
    @reverb_mix = 0.3

    build_graph
  end

  def build_graph
    @input_node = GainNode.new(@ctx)
    @output_node = GainNode.new(@ctx)

    # --- Delay Effect ---
    @delay_node = DelayNode.new(@ctx, delay_time: @delay_time)
    @delay_feedback_gain = GainNode.new(@ctx, gain: @delay_feedback)
    @delay_wet_gain = GainNode.new(@ctx, gain: @delay_mix)
    @delay_dry_gain = GainNode.new(@ctx, gain: 1.0 - @delay_mix)
    @delay_output = GainNode.new(@ctx)

    # --- Reverb Effect ---
    @convolver = ConvolverNode.new(@ctx)
    @reverb_wet_gain = GainNode.new(@ctx, gain: @reverb_mix)
    @reverb_dry_gain = GainNode.new(@ctx, gain: 1.0 - @reverb_mix)
    @reverb_output = GainNode.new(@ctx)

    # --- Routing Chain ---

    # 1. Delay Block
    @input_node.connect(@delay_node)
    @input_node.connect(@delay_dry_gain)

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

    # 3. Final Output
    @reverb_output.connect(@output_node)

    update_reverb_buffer
  end

  def connect(destination)
    @output_node.connect(destination)
  end

  def disconnect(destination = nil)
    if destination
      @output_node.disconnect(destination)
    else
      @output_node.disconnect
    end
  end

  # Parameter Setters

  def delay_time=(val)
    @delay_time = val.to_f
    @delay_node.delay_time.value = @delay_time if @delay_node
  end

  def delay_feedback=(val)
    @delay_feedback = val.to_f
    @delay_feedback_gain.gain.value = @delay_feedback if @delay_feedback_gain
  end

  def delay_mix=(val)
    @delay_mix = val.to_f
    @delay_wet_gain.gain.value = @delay_mix if @delay_wet_gain
    @delay_dry_gain.gain.value = 1.0 - @delay_mix if @delay_dry_gain
  end

  def reverb_seconds=(val)
    @reverb_seconds = val.to_f
    update_reverb_buffer
  end

  def reverb_mix=(val)
    @reverb_mix = val.to_f
    @reverb_wet_gain.gain.value = @reverb_mix if @reverb_wet_gain
    @reverb_dry_gain.gain.value = 1.0 - @reverb_mix if @reverb_dry_gain
  end

  def update_reverb_buffer
    rate = @ctx[:sampleRate].to_f
    length = (rate * @reverb_seconds).to_i

    JS.eval(<<~JAVASCRIPT)
      const ctx = window.audioCtx;
      const length = #{length};
      const seconds = #{@reverb_seconds};
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
end
