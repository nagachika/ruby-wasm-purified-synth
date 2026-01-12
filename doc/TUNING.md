# Just Intonation Lattice Tuning System

This synthesizer uses a unique microtonal tuning system based on Just Intonation (JI) lattices, rather than the standard 12-Tone Equal Temperament (12-TET).

## Core Concept: Dimensions of Harmony

The pitch of every note is calculated relative to a **Root Frequency** (e.g., 261.63 Hz for C4) using simple integer ratios derived from the harmonic series.

A note's frequency is defined by combining five "dimensions" (prime limits):

$$ F = R \times 2^a \times \left(\frac{3}{2}\right)^b \times \left(\frac{5}{4}\right)^c \times \left(\frac{7}{4}\right)^d \times \left(\frac{11}{4}\right)^e $$

Where:
*   **$R$**: Root Frequency (User configurable).
*   **$a$**: **Octave** (1st Harmonic / 2). Shifts the pitch up/down by octaves.
*   **$b$**: **Perfect Fifth** (3rd Harmonic / 1.5). The "X-axis" of the lattice.
*   **$c$**: **Major Third** (5th Harmonic / 1.25). A possible "Y-axis".
*   **$d$**: **Harmonic Seventh** (7th Harmonic / 1.75). A possible "Y-axis".
*   **$e$**: **11th Harmonic** (2.75). A possible "Y-axis".

By combining these ratios, you can construct chords that are perfectly consonant (beat-free) in ways impossible on a standard piano.

## Visualizing the Lattice

The **Chord Editor** allows you to construct chords visually on a 2D slice of this multi-dimensional lattice.

### The Grid UI

The grid interface represents a musical space:

*   **X-Axis (Horizontal)**: Represents the **3rd Harmonic dimension ($b$)**.
    *   Center (0): The Root.
    *   Right (+1): A Perfect Fifth above (3/2).
    *   Left (-1): A Perfect Fifth below (2/3).
    *   Range: -3 to +3.

*   **Y-Axis (Vertical)**: Represents one of the higher dimensions ($c$, $d$, or $e$), selectable via the dropdown menu.
    *   **3rd Dim (5/4)**: Classic Just Intonation Major Thirds.
    *   **4th Dim (7/4)**: Harmonic Sevenths (Bluesy/Barbershop consonance).
    *   **5th Dim (11/4)**: 11th Harmonics (Neutral/Exotic intervals).
    *   Range: -2 to +2.

### Creating Chords

1.  **Toggle Cells**: Click any cell in the grid to add a note at that harmonic coordinate. Clicking again removes it.
    *   Example: Clicking (X=0, Y=1) with "3rd Dim" selected adds a pure Major Third ratio (5/4) relative to the root.
2.  **Octave Indicators**:
    *   **0**: The note is in the base octave.
    *   **↑1**: The note is shifted up by 1 octave.
    *   **↓2**: The note is shifted down by 2 octaves.
    *   *(Note: Currently, notes are created at octave 0 by default)*.

### Example: A Just Major Triad

To build a pure C Major chord (if Root is C):
1.  Select **3rd Dim (5/4)** for the Y-Axis.
2.  Click **(0, 0)**: The Root (C).
3.  Click **(0, 1)**: The Major Third (E, 5/4 ratio).
4.  Click **(1, 0)**: The Perfect Fifth (G, 3/2 ratio).

This creates a triad with perfect integer ratios (4:5:6), sounding smoother and more resonant than a standard equal-tempered chord.
