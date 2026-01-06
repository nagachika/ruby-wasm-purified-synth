require_relative "audio_node_wrapper"

class OscillatorNode < AudioNodeWrapper
  def initialize(ctx, type: "sine", frequency: 440.0)
    native = ctx.call(:createOscillator)
    super(ctx, native)
    self.type = type
    self.frequency.value = frequency
  end

  def type=(val)
    @native_node[:type] = val.to_s
  end

  def frequency
    @frequency ||= param(:frequency)
  end

  def detune
    @detune ||= param(:detune)
  end

  def start(time = 0)
    @native_node.call(:start, time.to_f)
  end

  def stop(time = 0)
    @native_node.call(:stop, time.to_f)
  end
end

class GainNode < AudioNodeWrapper
  def initialize(ctx, gain: 1.0)
    native = ctx.call(:createGain)
    super(ctx, native)
    self.gain.value = gain
  end

  def gain
    @gain ||= param(:gain)
  end
end

class BiquadFilterNode < AudioNodeWrapper
  def initialize(ctx, type: "lowpass", frequency: 350.0, q: 1.0)
    native = ctx.call(:createBiquadFilter)
    super(ctx, native)
    self.type = type
    self.frequency.value = frequency
    self.Q.value = q
  end

  def type=(val)
    @native_node[:type] = val.to_s
  end

  def frequency
    @frequency ||= param(:frequency)
  end

  def detune
    @detune ||= param(:detune)
  end

  def Q
    @Q ||= param(:Q)
  end

  def gain
    # Only used for peaking/shelf filters
    @gain ||= param(:gain)
  end
end

class DelayNode < AudioNodeWrapper
  def initialize(ctx, delay_time: 0.0)
    native = ctx.call(:createDelay, 5.0) # Max delay time 5s
    super(ctx, native)
    self.delay_time.value = delay_time
  end

  def delay_time
    @delay_time ||= param(:delayTime)
  end
end

class ConvolverNode < AudioNodeWrapper
  def initialize(ctx)
    native = ctx.call(:createConvolver)
    super(ctx, native)
  end

  def buffer=(buffer)
    @native_node[:buffer] = buffer
  end

  def normalize=(val)
    @native_node[:normalize] = val
  end
end

class DynamicsCompressorNode < AudioNodeWrapper
  def initialize(ctx)
    native = ctx.call(:createDynamicsCompressor)
    super(ctx, native)
  end

  def threshold
    @threshold ||= param(:threshold)
  end

  def knee
    @knee ||= param(:knee)
  end

  def ratio
    @ratio ||= param(:ratio)
  end

  def attack
    @attack ||= param(:attack)
  end

  def release
    @release ||= param(:release)
  end
end

class NoiseNode < AudioNodeWrapper
  def initialize(ctx, buffer)
    native = ctx.call(:createBufferSource)
    super(ctx, native)
    @native_node[:buffer] = buffer
    @native_node[:loop] = true
  end

  def start(time = 0)
    @native_node.call(:start, time.to_f)
  end

  def stop(time = 0)
    @native_node.call(:stop, time.to_f)
  end
end

class ConstantSourceNode < AudioNodeWrapper
  def initialize(ctx, offset: 1.0)
    native = ctx.call(:createConstantSource)
    super(ctx, native)
    self.offset.value = offset
  end

  def offset
    @offset ||= param(:offset)
  end

  def start(time = 0)
    @native_node.call(:start, time.to_f)
  end

  def stop(time = 0)
    @native_node.call(:stop, time.to_f)
  end
end

class AnalyserNode < AudioNodeWrapper
  def initialize(ctx)
    native = ctx.call(:createAnalyser)
    super(ctx, native)
  end

  def fft_size=(size)
    @native_node[:fftSize] = size
  end
end
