require "js"
require_relative "synthesizer/drum_machine"

# Structure to hold lattice coordinates
# a: 1st dim (2.0) - Octave
# b: 2nd dim (3.0/2.0) - X axis
# c: 3rd dim (5.0/4.0) - Y axis candidate
# d: 4th dim (7.0/4.0) - Y axis candidate
# e: 5th dim (11.0/4.0) - Y axis candidate
NoteCoord = Struct.new(:a, :b, :c, :d, :e) do
  def to_json_object
    { a: a, b: b, c: c, d: d, e: e }
  end
end

class Arpeggiator
  attr_accessor :enabled, :mode, :division, :octaves

  def initialize
    @enabled = false
    @mode = :up
    @division = 1 # 1 step = 1/32 note
    @octaves = 1
  end

  def to_json_object
    { enabled: @enabled, mode: @mode, division: @division, octaves: @octaves }
  end
end

Block = Struct.new(:start_step, :length, :notes, :chord_name, :pattern_id) do
  def to_json_object
    {
      start: start_step,
      length: length,
      notes: notes.map(&:to_json_object),
      chord_name: chord_name,
      pattern_id: pattern_id
    }
  end
end

RhythmPattern = Struct.new(:id, :name, :steps, :events) do
  # events: Hash { instrument_name => { step_index => velocity(0.0..1.0) } }
  def to_json_object
    {
      id: id,
      name: name,
      steps: steps,
      events: events
    }
  end
end

class Track
  attr_accessor :blocks, :synth, :mute, :preset_name, :solo, :type
  attr_reader :volume, :arpeggiator

  def initialize(synth, type = :melodic)
    @synth = synth
    @type = type # :melodic or :rhythmic
    @blocks = []
    @mute = false
    @solo = false
    @preset_name = ""
    @volume = 1.0
    @arpeggiator = Arpeggiator.new
  end

  def volume=(val)
    @volume = val.to_f
    @synth.volume = @volume
  end

  def add_block(start_step, length, pattern_id = nil)
    block = Block.new(start_step, length, [], "", pattern_id)
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
  attr_accessor :swing_amount # 0.0 to 1.0 (0 = straight, >0 = swing)

  attr_reader :is_playing, :current_step, :tracks, :current_track_index, :total_steps
  attr_reader :patterns

  def initialize(ctx)
    @ctx = ctx
    @bpm = 120
    @root_freq = 261.63 # C4
    @swing_amount = 0.0

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
    @patterns = []

    # Initialize one melody track
    add_track

    # Initialize default pattern
    create_pattern("Pattern 1")

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
    synth.connect(@master_gain)

    track = Track.new(synth, :melodic)
    @tracks << track
    select_track(@tracks.length - 1)
    track
  end

  def add_rhythm_track
    drum_machine = DrumMachine.new(@ctx)
    drum_machine.connect(@master_gain)

    track = Track.new(drum_machine, :rhythmic)
    track.preset_name = "Drum Kit"
    @tracks << track
    select_track(@tracks.length - 1)
    track
  end

  def remove_track(index)
    return if @tracks.length <= 1 # Keep at least one track
    return if index < 0 || index >= @tracks.length

    track = @tracks.delete_at(index)
    track.synth.close

    if @current_track_index >= @tracks.length
      @current_track_index = @tracks.length - 1
    end
  end

  def select_track(index)
    if index >= 0 && index < @tracks.length
      @current_track_index = index
      $synth = current_track.synth
      # If rhythm track, $synth is DrumMachine, which might not match Synthesizer interface perfectly for UI
      # We will handle this in UI
      JS.global[:synthAnalyser] = current_track.synth.analyser_node.native_node
    end
  end

  def current_track
    @tracks[@current_track_index]
  end

  # --- Pattern Management ---

  def create_pattern(name = "New Pattern", steps = 16, id = nil)
    id ||= "p#{@patterns.length + 1}_#{Time.now.to_i}"
    # Initialize with velocity hash for each instrument
    events = {
      "Kick" => {}, "Snare" => {}, "HiHat" => {}, "OpenHat" => {}
    }
    pattern = RhythmPattern.new(id, name, steps, events)
    @patterns << pattern
    pattern
  end

  def delete_pattern(id)
    @patterns.reject! { |p| p.id == id }
    # Also remove references from blocks?
    @tracks.each do |t|
      next unless t.type == :rhythmic
      t.blocks.each do |b|
        if b.pattern_id == id
          # Reset to first available or nil
          b.pattern_id = @patterns.first&.id
        end
      end
    end
  end

  def get_pattern(id)
    @patterns.find { |p| p.id == id }
  end

  def get_pattern_name(id)
    p = get_pattern(id)
    p ? p.name : id
  end

  def get_patterns_json
    items = @patterns.map do |p|
      %|{ "id": "#{p.id}", "name": "#{p.name}", "steps": #{p.steps} }|
    end
    "[#{items.join(',')}]"
  end

  def export_patterns_json
    items = @patterns.map do |p|
      # events is { "Kick" => { 0 => 0.8, 4 => 0.8 }, ... }
      events_json_parts = p.events.map do |inst, data|
        steps_map = data.is_a?(Hash) ? data : {}
        # If legacy data (Array), convert to Hash
        if data.is_a?(Array)
          data.each { |s| steps_map[s] = 0.8 }
        end
        pairs = steps_map.map { |k, v| %|"#{k}": #{v}| }
        %|"#{inst}": { #{pairs.join(',')} }|
      end
      events_json = "{ #{events_json_parts.join(',')} }"

      %|{ "id": "#{p.id}", "name": "#{p.name}", "steps": #{p.steps}, "events": #{events_json} }|
    end
    "[#{items.join(',')}]"
  end

  def import_patterns_json(json)
    parsed = JS.global[:JSON].call(:parse, json)
    return unless parsed

    @patterns.clear

    length = parsed[:length].to_i
    length.times do |i|
      p_data = parsed[i]
      id = p_data[:id].to_s
      name = p_data[:name].to_s
      steps = p_data[:steps].to_i

      events = {}
      p_events = p_data[:events]

      # Iterate over instruments (Kick, Snare, etc.)
      # p_events is a JS Object. We can iterate keys if we use JS methods or known keys.
      ["Kick", "Snare", "HiHat", "OpenHat"].each do |inst|
        inst_events = p_events[inst]
        next if inst_events.typeof == "undefined"

        step_map = {}
        # inst_events is { "0": 0.8, "4": 0.8 }
        # We need to iterate over its keys.
        # JS::Object doesn't iterate easily in Ruby without helper or keys.
        # Use Object.keys
        keys = JS.global[:Object].call(:keys, inst_events)
        k_len = keys[:length].to_i
        k_len.times do |ki|
          step_key = keys[ki].to_s
          val = inst_events[step_key].to_f
          step_map[step_key.to_i] = val
        end
        events[inst] = step_map
      end

      pattern = RhythmPattern.new(id, name, steps, events)
      @patterns << pattern
    end

    # Ensure at least one pattern exists
    if @patterns.empty?
      create_pattern("Pattern 1")
    end
  end

  # --- Block Management ---

  def add_or_update_block(track_index, start_step, length, pattern_id = nil)
    track = @tracks[track_index]
    return unless track

    existing = track.blocks.find { |b| b.start_step == start_step }
    if existing
      existing.length = length
      existing.pattern_id = pattern_id if pattern_id
    else
      # If rhythm track and no pattern_id provided, use the first available pattern
      if track.type == :rhythmic && pattern_id.nil?
        pattern_id = @patterns.first&.id
      end
      track.add_block(start_step, length, pattern_id)
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

  def update_block_notes(track_index, start_step, notes_json_str)
    # ... (same as before, mostly for melodic) ...
    track = @tracks[track_index]
    return unless track
    return if track.type == :rhythmic # Rhythm blocks don't store notes this way

    block = track.blocks.find { |b| b.start_step == start_step }
    return unless block

    block.notes.clear
    js_notes = JS.global[:JSON].call(:parse, notes_json_str)
    len = js_notes[:length].to_i
    len.times do |i|
       n = js_notes[i]
       new_note = NoteCoord.new(n[:a].to_f, n[:b].to_f, n[:c].to_f, n[:d].to_f, n[:e].to_f)
       block.notes << new_note
    end
  end

  def update_block_notes_buffer(track_index, start_step, flat_array)
    track = @tracks[track_index]
    return unless track
    return if track.type == :rhythmic

    block = track.blocks.find { |b| b.start_step == start_step }
    return unless block

    block.notes.clear
    len = flat_array[:length].to_i
    count = len / 5
    count.times do |i|
       base = i * 5
       new_note = NoteCoord.new(
         flat_array[base].to_f, flat_array[base+1].to_f,
         flat_array[base+2].to_f, flat_array[base+3].to_f, flat_array[base+4].to_f
       )
       block.notes << new_note
    end
  end

  # Pattern Editor Integration
  def toggle_pattern_step(pattern_id, instrument, step, velocity = 0.8)
    pattern = get_pattern(pattern_id)
    return unless pattern

    steps_map = pattern.events[instrument] || {}
    if steps_map.has_key?(step)
      steps_map.delete(step)
    else
      steps_map[step] = velocity
    end
    pattern.events[instrument] = steps_map
  end

  def get_pattern_events_json(pattern_id)
    pattern = get_pattern(pattern_id)
    return "{}" unless pattern

    # Build JSON for events
    json_parts = pattern.events.map do |inst, data|
      steps_map = data.is_a?(Hash) ? data : {}

      # If legacy data (Array), convert to Hash
      if data.is_a?(Array)
        data.each { |s| steps_map[s] = 0.8 }
      end

      # steps_map is { index => velocity }
      pairs = steps_map.map { |k, v| %|"#{k}": #{v}| }
      %|"#{inst}": { #{pairs.join(',')} }|
    end
    "{#{json_parts.join(',')}}"
  end

  # ... (Helper methods for Lattice Editor omitted as they are specific to melodic blocks) ...

  def get_track_blocks_json(track_index)
    track = @tracks[track_index]
    return "[]" unless track

    items = track.blocks.map do |b|
       extra = ""
       if track.type == :rhythmic
         extra = %|, "pattern_id": "#{b.pattern_id}"|
       end
       %|{ "start": #{b.start_step}, "length": #{b.length}, "notes_count": #{b.notes.length}, "type": "#{track.type}"#{extra} }|
    end
    "[#{items.join(',')}]"
  end

  # --- Playback ---

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
    seconds_per_beat = 60.0 / @bpm
    step_duration_sec = seconds_per_beat / 8.0 # 1/32 note resolution base

    # Apply Swing
    # If step is even (0, 2, 4...), it's on grid.
    # If step is odd (1, 3, 5...), it's off grid (the 'and' of 16th note if 1 step = 1/16??)
    # Wait, resolution:
    # 1 bar = 32 steps.
    # 1 beat = 8 steps.
    # 1/16 note = 2 steps.
    # So even steps are 1/16 lines, odd steps are 1/32 intermediate?
    # Usually swing applies to 1/16 notes.
    # If our resolution is 32 steps per bar, that's 1/32 notes.
    # 1/16 note indices are: 0, 2, 4, 6...
    # The "off-beat" 1/16s are: 2, 6, 10... (wait, 0 is beat, 2 is next 1/16?)
    # 0 (1.1.1), 2 (1.1.2), 4 (1.1.3), 6 (1.1.4)
    # The swing usually delays the *second* 1/16th note of a pair.
    # Pair: (0, 2), (4, 6), ...
    # So indices 2, 6, 10... should be delayed.
    # Indices are step_index.
    # If step_index % 4 == 2, add swing offset.

    swing_offset = 0.0
    if (step_index % 4) == 2
      # Max swing (100%) ~= triplet feel.
      # 1/16 duration = step_duration_sec * 2
      # Triplet 1/16 = 2/3 of straight 1/16?
      # Let's just say swing_amount is percentage of 1/16 note duration to delay.
      # 0.5 swing might be heavy.
      swing_offset = (step_duration_sec * 2) * (@swing_amount * 0.33)
    end

    play_time = time + swing_offset

    any_solo = @tracks.any?(&:solo)

    @tracks.each do |track|
      next if track.mute
      next if any_solo && !track.solo

      if track.type == :melodic
        # If Arp is ON, we might need to schedule notes even if step_index is not block.start_step
        # but for this "shift start" implementation, we can schedule all notes of the block
        # at the block.start_step, just with different start times and durations.
        blocks = track.blocks.select { |b| b.start_step == step_index }
        blocks.each do |block|
          next if block.notes.empty?

          if track.arpeggiator.enabled
            block.notes.each_with_index do |note, idx|
              delay_steps = idx * track.arpeggiator.division
              # If the delay exceeds the block length, we could either clip it or let it play.
              # Let's clip it to block length for now.
              next if delay_steps >= block.length

              note_start_time = play_time + (delay_steps * step_duration_sec)
              note_duration = (block.length - delay_steps) * step_duration_sec
              freq = calculate_freq(note)
              track.synth.schedule_note(freq, note_start_time, note_duration)
            end
          else
            duration = block.length * step_duration_sec
            block.notes.each do |note|
              freq = calculate_freq(note)
              track.synth.schedule_note(freq, play_time, duration)
            end
          end
        end
      elsif track.type == :rhythmic
        # Find block covering this step
        block = track.find_block_at(step_index)
        next unless block && block.pattern_id

        pattern = get_pattern(block.pattern_id)
        next unless pattern

        # Calculate local step in pattern
        # Assume pattern loops if block is longer than pattern steps
        # Pattern resolution: 1/16 note (2 sequencer steps)
        # Sequencer resolution: 1/32 note
        local_step_abs = step_index - block.start_step
        pattern_seq_length = pattern.steps * 2
        local_pos = local_step_abs % pattern_seq_length

        if (local_pos % 2) == 0
          pattern_step_index = local_pos / 2

          pattern.events.each do |instrument, steps_map|
            if steps_map.has_key?(pattern_step_index)
              velocity = steps_map[pattern_step_index]
              track.synth.trigger(instrument, play_time, velocity)
            end
          end
        end
      end
    end

    JS.global.call(:updatePlayhead, step_index)
  end

  def set_arpeggiator_enabled(track_index, enabled)
    track = @tracks[track_index]
    if track && track.type == :melodic
      track.arpeggiator.enabled = (enabled == true || enabled == "true")
    end
  end

  def get_arpeggiator_status(track_index)
    track = @tracks[track_index]
    (track && track.type == :melodic && track.arpeggiator.enabled) ? true : false
  end

  def calculate_freq(note)
    # F = R * (2^a) * ((3/2)^b) * ((5/4)^c) * ((7/4)^d) * ((11/4)^e)
    f = @root_freq * (2.0 ** note.a)
    f *= (1.5 ** note.b)
    f *= (1.25 ** note.c)
    f *= (1.75 ** note.d)
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
