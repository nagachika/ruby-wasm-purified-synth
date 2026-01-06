require_relative "nodes"
require_relative "adsr_envelope"

class Voice
  attr_reader :nodes, :envelopes

  # patch_def is currently a placeholder for future JSON configuration
  # synth_params is the legacy parameter object from Synthesizer class
  def initialize(ctx, note_number, synth_params, output_node)
    @ctx = ctx
    @note_number = note_number
    @params = synth_params
    @output_node = output_node # The Global Mixer/Effects input

    @nodes = {}
    @envelopes = []

    build_graph
  end

  def build_graph
    freq = note_number_to_freq(@note_number)

    # 1. VCO
    # Future: Parse from patch_def
    if @params.osc_type == "noise"
      osc = NoiseNode.new(@ctx, @params.noise_buffer)
    else
      osc = OscillatorNode.new(@ctx, type: @params.osc_type, frequency: freq)
    end
    @nodes[:vco] = osc

    # 2. VCF
    vcf = BiquadFilterNode.new(@ctx, type: @params.filter_type)
    vcf.frequency.value = @params.cutoff
    vcf.Q.value = @params.resonance
    @nodes[:vcf] = vcf

    # 3. VCA
    vca = GainNode.new(@ctx, gain: 0.0)
    @nodes[:vca] = vca

    # 4. Envelope (ADSR -> VCA Gain)
    env = ADSREnvelope.new(
      attack: @params.attack,
      decay: @params.decay,
      sustain: @params.sustain,
      release: @params.release
    )
    env.connect(vca.gain)
    @envelopes << env

    # 5. LFO
    if @params.lfo_on
      lfo = OscillatorNode.new(@ctx, type: @params.lfo_waveform, frequency: @params.lfo_rate)
      lfo_gain = GainNode.new(@ctx, gain: @params.lfo_depth)

      lfo.connect(lfo_gain)
      lfo_gain.connect(vcf.frequency) # LFO -> Cutoff

      @nodes[:lfo] = lfo
      @nodes[:lfo_gain] = lfo_gain
    end

    # Connections
    osc.connect(vcf)
    vcf.connect(vca)
    vca.connect(@output_node)
  end

  def start(time)
    t = time.to_f

    # Start Sources
    @nodes[:vco].start(t)
    @nodes[:lfo]&.start(t)

    # Trigger Envelopes
    @envelopes.each { |env| env.trigger(t) }
  end

  def stop(time)
    t = time.to_f

    # Release Envelopes
    @envelopes.each { |env| env.release_at(t) }

    # Schedule cleanup
    # Stop oscillators after release phase
    stop_time = t + @params.release + 0.1 # buffer
    @nodes[:vco].stop(stop_time)
    @nodes[:lfo]&.stop(stop_time)

    # Note: Actual node cleanup/disconnect happens when they are GC'd
    # or we can schedule a callback if we had a scheduler.
    # For now, Web Audio handles stopped nodes efficiently.
  end

  # Immediate stop (panic/cut)
  def stop_immediately
    now = @ctx[:currentTime].to_f
    @nodes[:vco].stop(now)
    @nodes[:lfo]&.stop(now)
    @nodes[:vca].disconnect
  end

  private

  def note_number_to_freq(note)
    440.0 * (2.0 ** ((note - 69) / 12.0))
  end
end
