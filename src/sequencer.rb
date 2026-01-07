require "js"

# Structure to hold lattice coordinates
# a: 1st dim (2.0) - Octave
# b: 2nd dim (3.0/2.0) - X axis
# c: 3rd dim (5.0/4.0) - Y axis candidate
# d: 4th dim (7.0/8.0) - Y axis candidate
# e: 5th dim (11.0/4.0) - Y axis candidate
NoteCoord = Struct.new(:a, :b, :c, :d, :e) do
  def to_json_object
    { a: a, b: b, c: c, d: d, e: e }
  end
end

Block = Struct.new(:start_step, :length, :notes, :chord_name) do
  def to_json_object
    {
      start: start_step,
      length: length,
      notes: notes.map(&:to_json_object),
      chord_name: chord_name
    }
  end
end

class Track
  attr_accessor :blocks, :synth, :mute, :preset_name, :solo
  attr_reader :volume

  def initialize(synth)
    @synth = synth
    @blocks = []
    @mute = false
    @solo = false
    @preset_name = ""
    @volume = 1.0
  end

  def volume=(val)
    @volume = val.to_f
    @synth.volume = @volume
  end

  def add_block(start_step, length)
    block = Block.new(start_step, length, [], "")
    @blocks << block
    block
  end

  def remove_block_at(start_step)
    @blocks.reject! { |b| b.start_step == start_step }
  end

  def find_block_at(step)
    @blocks.find { |b| b.start_step <= step && (b.start_step + b.length) > step }
  end
end

class Sequencer
  attr_accessor :bpm
  attr_accessor :root_freq
  attr_accessor :y_axis_dim # 3, 4, or 5

  attr_reader :is_playing, :current_step, :tracks, :current_track_index, :total_steps

  def initialize(ctx)
    @ctx = ctx
    @bpm = 120
    @root_freq = 261.63 # C4
    @y_axis_dim = 3

    @total_steps = 128 # Default 4 bars (32 steps * 4)

    # --- Master Bus ---
    @master_gain = GainNode.new(@ctx, gain: 1.0)
    @compressor = DynamicsCompressorNode.new(@ctx)
    @compressor.threshold.value = -24.0
    @compressor.knee.value = 30.0
    @compressor.ratio.value = 12.0
    @compressor.attack.value = 0.003
    @compressor.release.value = 0.25

    @master_gain.connect(@compressor)
    @compressor.connect(@ctx[:destination])

    @tracks = []
    add_track # Add initial track

    @is_playing = false
    @current_step = 0
    @next_note_time = 0.0
    @schedule_ahead_time = 0.1
    @lookahead_ms = 25.0
  end

  def total_bars=(bars)
    @total_steps = bars.to_i * 32
  end

  def total_bars
    @total_steps / 32
  end

  def add_track
    synth = Synthesizer.new(@ctx)
    # Connect Synth output to Sequencer Master Bus
    synth.connect(@master_gain)
    
    track = Track.new(synth)
    @tracks << track
    select_track(@tracks.length - 1)
    track
  end

  def remove_track(index)
    return if @tracks.length <= 1 # Keep at least one track
    return if index < 0 || index >= @tracks.length

    track = @tracks.delete_at(index)
    track.synth.close

    # Adjust selection if necessary
    if @current_track_index >= @tracks.length
      @current_track_index = @tracks.length - 1
    end
  end

  def select_track(index)
    if index >= 0 && index < @tracks.length
      @current_track_index = index
      # Update global $synth reference for UI
      $synth = current_track.synth
      # Update global analyser for Visualizer
      JS.global[:synthAnalyser] = current_track.synth.analyser_node.native_node
    end
  end

  def current_track
    @tracks[@current_track_index]
  end

  # --- Block Management ---

  # Create a new block or merge into existing
  def add_or_update_block(track_index, start_step, length)
    track = @tracks[track_index]
    return unless track

    # Remove overlapping blocks? Or allow overlap?
    # For now, let's remove overlaps for simplicity in this mono-timbral-per-track context
    # actually let's just push it. Overlaps are fine for polyphony.

    # Check if a block starts exactly here to update it?
    existing = track.blocks.find { |b| b.start_step == start_step }
    if existing
      existing.length = length
    else
      track.add_block(start_step, length)
    end
  end

  def remove_block(track_index, start_step)
    track = @tracks[track_index]
    return unless track
    track.remove_block_at(start_step)
  end

  # Used by Lattice Editor to edit specific block
  def get_block_notes_json(track_index, start_step)
    track = @tracks[track_index]
    return "[]" unless track

    block = track.blocks.find { |b| b.start_step == start_step }
    return "[]" unless block

    json_items = block.notes.map do |n|
      %|{ "a": #{n[:a]}, "b": #{n[:b]}, "c": #{n[:c]}, "d": #{n[:d]}, "e": #{n[:e]} }|
    end
    "[#{json_items.join(',')}]"
  end

  # Update notes in a block from Lattice Editor
  def update_block_notes(track_index, start_step, notes_json_str)
    track = @tracks[track_index]
    return unless track

    block = track.blocks.find { |b| b.start_step == start_step }
    return unless block

    # Clear existing
    block.notes.clear

    # Parse JSON string from JS
    js_notes = JS.global[:JSON].call(:parse, notes_json_str)

    # Iterate JS Array using index
    len = js_notes[:length].to_i
    len.times do |i|
       n = js_notes[i]
       # JS objects to Ruby structs
       new_note = NoteCoord.new(
         n[:a].to_f,
         n[:b].to_f,
         n[:c].to_f,
         n[:d].to_f,
         n[:e].to_f
       )
       block.notes << new_note
    end
  end

  # Helper for Lattice Editor logic (reusing existing toggling logic but on Block)
  def toggle_note_in_block(track_index, start_step, b, y_val)
    track = @tracks[track_index]
    return unless track
    block = track.blocks.find { |b| b.start_step == start_step }
    return unless block

    t_c = (@y_axis_dim == 3) ? y_val : 0
    t_d = (@y_axis_dim == 4) ? y_val : 0
    t_e = (@y_axis_dim == 5) ? y_val : 0

    existing_indices = []
    block.notes.each_with_index do |note, idx|
      match = (note.b == b)
      match &&= (note.c == t_c) if @y_axis_dim == 3
      match &&= (note.d == t_d) if @y_axis_dim == 4
      match &&= (note.e == t_e) if @y_axis_dim == 5
      existing_indices << idx if match
    end

    if existing_indices.any?
      existing_indices.reverse_each { |i| block.notes.delete_at(i) }
    else
      new_note = NoteCoord.new(0, b, t_c, t_d, t_e)
      block.notes << new_note
    end
  end

  def shift_octave_in_block(track_index, start_step, b, y_val, delta)
    track = @tracks[track_index]
    return unless track
    block = track.blocks.find { |b| b.start_step == start_step }
    return unless block

    t_c = (@y_axis_dim == 3) ? y_val : 0
    t_d = (@y_axis_dim == 4) ? y_val : 0
    t_e = (@y_axis_dim == 5) ? y_val : 0

    block.notes.each do |note|
      match = (note.b == b)
      match &&= (note.c == t_c) if @y_axis_dim == 3
      match &&= (note.d == t_d) if @y_axis_dim == 4
      match &&= (note.e == t_e) if @y_axis_dim == 5

      if match
        note.a += delta
      end
    end
  end

  def shift_block_notes(track_index, start_step, dx, dy)
    track = @tracks[track_index]
    return false unless track
    block = track.blocks.find { |b| b.start_step == start_step }
    return false unless block
    return false if block.notes.empty?

    can_shift = block.notes.all? do |n|
      new_b = n.b + dx
      valid_x = new_b.between?(-3, 3)
      valid_y = true
      if @y_axis_dim == 3
        valid_y = (n.c + dy).between?(-2, 2)
      elsif @y_axis_dim == 4
        valid_y = (n.d + dy).between?(-2, 2)
      elsif @y_axis_dim == 5
        valid_y = (n.e + dy).between?(-2, 2)
      end
      valid_x && valid_y
    end

    return false unless can_shift

    block.notes.each do |n|
      n.b += dx
      if @y_axis_dim == 3
        n.c += dy
      elsif @y_axis_dim == 4
        n.d += dy
      elsif @y_axis_dim == 5
        n.e += dy
      end
    end
    true
  end

  def get_track_blocks_json(track_index)
    track = @tracks[track_index]
    return "[]" unless track

    # Manual JSON construction
    items = track.blocks.map do |b|
       # notes count is enough for rendering?
       # or maybe send if it has notes to color it
       %|{ "start": #{b.start_step}, "length": #{b.length}, "notes_count": #{b.notes.length} }|
    end
    "[#{items.join(',')}]"
  end

  # --- Playback ---

  def start
    return if @is_playing
    @is_playing = true
    # Don't reset current step if we want pause/resume behavior?
    # For now restart from 0
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
    # 1/32 measure resolution
    # 1 bar = 4 beats
    # 32 steps = 4 beats -> 1 step = 1/8 beat
    seconds_per_beat = 60.0 / @bpm
    step_duration_sec = seconds_per_beat / 8.0

    any_solo = @tracks.any?(&:solo)

    @tracks.each do |track|
      next if track.mute
      next if any_solo && !track.solo

      # Find blocks starting at this step
      blocks = track.blocks.select { |b| b.start_step == step_index }

      blocks.each do |block|
        next if block.notes.empty?

        duration = block.length * step_duration_sec
        # Slightly reduce for articulation? Or full legato?
        # User asked for connecting sections... full legato might be desired if butt-joined.
        # But let's keep 0.8 for articulation for now unless legato is explicitly requested
        # Actually, if we want "one long note", the block handles it.
        # Between blocks, articulation is good.
        play_duration = duration # * 0.95?

        block.notes.each do |note|
          freq = calculate_freq(note)
          track.synth.schedule_note(freq, time, play_duration)
        end
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
    # 1 step = 1/32 bar = 1/8 beat
    @next_note_time += (seconds_per_beat / 8.0)

    @current_step += 1
    # Loop at total_steps
    if @current_step >= @total_steps
      @current_step = 0
    end
  end
end
