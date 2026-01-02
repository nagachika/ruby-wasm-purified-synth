require "js"

class Sequencer
  attr_accessor :bpm, :steps
  attr_reader :is_playing, :current_step

  def initialize(synth, ctx)
    @synth = synth
    @ctx = ctx
    @bpm = 120
    @steps = Array.new(16) { nil } # Array of notes (e.g., 60) or nil
    @is_playing = false
    @current_step = 0
    @next_note_time = 0.0
    @schedule_ahead_time = 0.1 # seconds
    @lookahead_ms = 25.0 # milliseconds (interval for timer)
    @timer_id = nil
  end

  def toggle_step(index, freq)
    if @steps[index] == freq
      @steps[index] = nil
    else
      @steps[index] = freq
    end
  end

  def start
    return if @is_playing
    @is_playing = true
    @current_step = 0
    @next_note_time = @ctx[:currentTime].to_f + 0.1
    
    # Start the scheduling loop via JS setInterval
    # Use window.rubyVM.eval to trigger the Ruby method from JS.
    
    code = <<~JAVASCRIPT
      window._seqInterval = setInterval(() => {
        if (window.rubyVM) {
          window.rubyVM.eval("$sequencer.scheduler");
        }
      }, #{@lookahead_ms});
    JAVASCRIPT
    JS.eval(code)
  end

  def stop
    @is_playing = false
    JS.eval("clearInterval(window._seqInterval)")
    # Reset?
  end

  def scheduler
    while @next_note_time < @ctx[:currentTime].to_f + @schedule_ahead_time
      schedule_note(@current_step, @next_note_time)
      advance_step
    end
  end

  def schedule_note(step_index, time)
    freq = @steps[step_index]
    if freq
      # Play note for 1 step duration (minus a little for articulation)
      seconds_per_beat = 60.0 / @bpm
      # Assuming 16th notes (4 steps per beat)
      step_duration = seconds_per_beat / 4.0
      
      @synth.schedule_note(freq, time, step_duration * 0.8)
    end
    
    # Notify UI to update playhead (visual only)
    # Using requestAnimationFrame on JS side or just setting a variable?
    # Direct callback is easiest.
    JS.global.call(:updatePlayhead, step_index)
  end

  def advance_step
    seconds_per_beat = 60.0 / @bpm
    @next_note_time += 0.25 * seconds_per_beat # Add 16th note duration
    @current_step += 1
    @current_step = 0 if @current_step == 16
  end
end
