class ADSREnvelope
  attr_accessor :attack, :decay, :sustain, :release

  def initialize(attack: 0.1, decay: 0.1, sustain: 0.5, release: 0.1)
    @attack = attack
    @decay = decay
    @sustain = sustain
    @release = release
    @target_param = nil
  end

  def connect(param)
    @target_param = param
  end

  def trigger(time, velocity = 1.0)
    return unless @target_param

    t = time.to_f
    # Web Audio ramp quirks: target value for exponential ramp cannot be 0
    min_val = 0.001
    peak_val = [velocity.to_f, min_val].max

    @target_param.cancel_scheduled_values(t)
    @target_param.set_value_at_time(min_val, t)

    # Attack
    @target_param.linear_ramp_to_value_at_time(peak_val, t + @attack)

    # Decay
    sus_val = (@sustain * peak_val <= min_val) ? min_val : (@sustain * peak_val)
    @target_param.exponential_ramp_to_value_at_time(sus_val, t + @attack + @decay)
  end

  def release_at(time)
    return unless @target_param

    t = time.to_f
    min_val = 0.001

    @target_param.cancel_scheduled_values(t)

    # We need to capture the current value to ramp down smoothly from where we are
    # However, standard AudioParam doesn't easily give "value at scheduled time X".
    # A common workaround is to set the value at time T to the calculated curve value,
    # or just let the ramp start from the last scheduled point if strictly sequenced.
    # For interactive playing, explicit setValueAtTime is safer to avoid jumps.

    # Simple approach: Ramp from current sustain level (assuming we reached it)
    # If key is released during attack/decay, this might jump.
    # Proper solution requires 'setTargetAtTime' or tracking, but let's stick to simple ADSR for now.

    # Note: If we use setTargetAtTime, it's an exponential approach to target.
    # Here we use exponentialRamp which requires an event to start from.
    # To fix the "jump" artifact when releasing early, we would ideally read the current value,
    # but that requires 'ctx.currentTime' synchronous read which might be slight off scheduled time.

    # We will assume we are at Sustain level or rely on the engine to handle the curve interpolation
    # if we don't insert a setValueAtTime. But Web Audio REQUIRES a start point for ramps.

    # Safe approximation:
    @target_param.set_value_at_time(@target_param.value, t)
    @target_param.exponential_ramp_to_value_at_time(min_val, t + @release)
  end
end
