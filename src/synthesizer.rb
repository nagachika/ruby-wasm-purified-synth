require "js"

class Voice
  def initialize(ctx, freq, start_time)
    @osc = ctx.createOscillator()
    @gain = ctx.createGain()

    @osc[:type] = "triangle"
    @osc[:frequency][:value] = freq

    @osc.connect(@gain)
    @gain.connect(ctx[:destination])

    @osc.start(start_time)
    @gain[:gain].setValueAtTime(0.2, start_time)
    @gain[:gain].exponentialRampToValueAtTime(0.001, start_time + 1.0)
    @osc.stop(start_time + 1.0)
  end
end

class Synthesizer
  def initialize(ctx)
    @ctx = ctx
  end

  def play_note(note_number)
    freq = 440.0 * (2.0 ** ((note_number - 69) / 12.0))
    now = @ctx[:currentTime].to_f
    Voice.new(@ctx, freq, now)
  end
end

def play_demo
  ctx = JS.eval("return window.audioCtx;")
  synth = Synthesizer.new(ctx)
  synth.play_note(60) # C4
  puts "Played note 60 from src/synthesizer.rb"
end
