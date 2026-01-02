require "js"

# Structure to hold lattice coordinates
# a: 1st dim (2.0) - Octave
# b: 2nd dim (3.0/2.0) - X axis
# c: 3rd dim (5.0/4.0) - Y axis candidate
# d: 4th dim (7.0/8.0) - Y axis candidate
# e: 5th dim (11.0/4.0) - Y axis candidate
NoteCoord = Struct.new(:a, :b, :c, :d, :e) do
  def to_json_object
    # Convert to a basic hash/object for JS consumption
    { a: a, b: b, c: c, d: d, e: e }
  end
end

class Sequencer
  attr_accessor :bpm
  attr_accessor :root_freq
  attr_accessor :y_axis_dim # 3, 4, or 5
  
  attr_reader :is_playing, :current_step

  def initialize(synth, ctx)
    @synth = synth
    @ctx = ctx
    @bpm = 120
    @root_freq = 261.63 # C4
    @y_axis_dim = 3 # Default to 5-limit (3rd dim)
    
    # @steps[index] is an Array of NoteCoord objects
    @steps = Array.new(16) { [] } 
    
    @is_playing = false
    @current_step = 0
    @next_note_time = 0.0
    @schedule_ahead_time = 0.1
    @lookahead_ms = 25.0
  end

  # Toggle a note at specific lattice coordinates (b, y_val)
  # y_val corresponds to the dimension specified by @y_axis_dim
  def toggle_note(step_index, b, y_val)
    step = @steps[step_index]
    
    # Target coordinates
    t_c = (@y_axis_dim == 3) ? y_val : 0
    t_d = (@y_axis_dim == 4) ? y_val : 0
    t_e = (@y_axis_dim == 5) ? y_val : 0
    
    # Find existing note with matching X(b) and Y(current dim) coordinates
    # We ignore Octave(a) for existence check to allow toggling the "cell"
    # Actually, if multiple octaves exist in the same cell, how do we handle toggle?
    # User requirement: "Rectangular selection".
    # Simplification: Toggling a cell creates a note with a=0 if none exists.
    # If notes exist in that cell, it removes ALL of them (or just the latest?).
    # Let's say it removes all notes in that cell. 
    
    existing_indices = []
    step.each_with_index do |note, idx|
      match = (note.b == b)
      match &&= (note.c == t_c) if @y_axis_dim == 3
      match &&= (note.d == t_d) if @y_axis_dim == 4
      match &&= (note.e == t_e) if @y_axis_dim == 5
      existing_indices << idx if match
    end

    if existing_indices.any?
      # Remove in reverse order
      existing_indices.reverse_each { |i| step.delete_at(i) }
    else
      # Add new note with a=0
      new_note = NoteCoord.new(0, b, t_c, t_d, t_e)
      step << new_note
    end
  end

  # Change octave (a) for notes in a specific cell
  def shift_octave(step_index, b, y_val, delta)
    step = @steps[step_index]
    
    t_c = (@y_axis_dim == 3) ? y_val : 0
    t_d = (@y_axis_dim == 4) ? y_val : 0
    t_e = (@y_axis_dim == 5) ? y_val : 0
    
    step.each do |note|
      match = (note.b == b)
      match &&= (note.c == t_c) if @y_axis_dim == 3
      match &&= (note.d == t_d) if @y_axis_dim == 4
      match &&= (note.e == t_e) if @y_axis_dim == 5
      
      if match
        note.a += delta
      end
    end
  end

  # Return notes for a step to JS for rendering
  # Returns JSON string
  def get_step_notes_json(step_index)
    notes = @steps[step_index].map do |n|
      n.to_json_object
    end
    # Simple JSON construction
    json_items = notes.map do |n|
      %|{ "a": #{n[:a]}, "b": #{n[:b]}, "c": #{n[:c]}, "d": #{n[:d]}, "e": #{n[:e]} }|
    end
    "[#{json_items.join(',')}]"
  end

  def start
    return if @is_playing
    @is_playing = true
    @current_step = 0
    @next_note_time = @ctx[:currentTime].to_f + 0.1
    
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
  end

  def scheduler
    while @next_note_time < @ctx[:currentTime].to_f + @schedule_ahead_time
      schedule_step(@current_step, @next_note_time)
      advance_step
    end
  end

  def schedule_step(step_index, time)
    notes = @steps[step_index]
    
    if notes && !notes.empty?
      seconds_per_beat = 60.0 / @bpm
      step_duration = seconds_per_beat / 4.0
      
      notes.each do |note|
        freq = calculate_freq(note)
        @synth.schedule_note(freq, time, step_duration * 0.8)
      end
    end
    
    JS.global.call(:updatePlayhead, step_index)
  end
  
  def calculate_freq(note)
    # F = R * (2^a) * ((3/2)^b) * ((5/4)^c) * ((7/8)^d) * ((11/4)^e)
    f = @root_freq * (2.0 ** note.a)
    f *= (1.5 ** note.b)
    f *= (1.25 ** note.c)
    f *= (0.875 ** note.d)
    f *= (2.75 ** note.e)
    f
  end

  def advance_step
    seconds_per_beat = 60.0 / @bpm
    @next_note_time += 0.25 * seconds_per_beat
    @current_step += 1
    @current_step = 0 if @current_step == 16
  end
end