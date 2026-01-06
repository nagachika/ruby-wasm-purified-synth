require "js"

# Wraps a native Web Audio API AudioParam
class AudioParamWrapper
  attr_reader :native_node

  def initialize(native_param)
    @native_node = native_param
  end

  def value=(val)
    @native_node[:value] = val.to_f
  end

  def value
    @native_node[:value].to_f
  end

  # Automations
  def set_value_at_time(value, time)
    @native_node.call(:setValueAtTime, value.to_f, time.to_f)
  end

  def linear_ramp_to_value_at_time(value, time)
    @native_node.call(:linearRampToValueAtTime, value.to_f, time.to_f)
  end

  def exponential_ramp_to_value_at_time(value, time)
    # Exponential ramp requires positive non-zero values
    val = value.to_f
    val = 0.0001 if val.abs < 0.0001
    @native_node.call(:exponentialRampToValueAtTime, val, time.to_f)
  end

  def cancel_scheduled_values(time)
    @native_node.call(:cancelScheduledValues, time.to_f)
  end
end

# Base wrapper for Web Audio API AudioNodes
class AudioNodeWrapper
  attr_reader :native_node, :ctx

  def initialize(ctx, native_node)
    @ctx = ctx
    @native_node = native_node
  end

  def connect(destination)
    if destination.is_a?(AudioNodeWrapper) || destination.is_a?(AudioParamWrapper)
      @native_node.connect(destination.native_node)
    elsif destination.is_a?(JS::Object)
      # Fallback for raw JS objects (like ctx.destination)
      @native_node.connect(destination)
    else
      raise ArgumentError, "Cannot connect to #{destination.class}"
    end
    self # Allow chaining
  end

  def disconnect
    @native_node.disconnect
  end

  # Helper to access parameters wrapped in AudioParamWrapper
  # Child classes should define specific parameter accessors
  def param(name)
    raw_param = @native_node[name]
    if raw_param.typeof == "undefined"
      raise ArgumentError, "AudioParam '#{name}' not found on #{@native_node[:constructor][:name]}"
    end
    AudioParamWrapper.new(raw_param)
  end
end
