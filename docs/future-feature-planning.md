# Future Feature Planning

This document tracks approved future-direction notes that are intentionally not implemented yet.

## Manual Future Puzzle Presets

Planned behavior:

- Add an admin/manual path to set a puzzle for a future date.
- Even if a future date has a pre-set puzzle in storage, the date picker must not show dates later than server-calculated "today".
- `rotate-daily` must not overwrite a manually pre-set puzzle when that date arrives.

Open design questions:

- Difficulty for manual presets:
  - Use stored/manual difficulty metadata as-is.
  - Or recompute difficulty from puzzle anchors at read/rotate time.
- Ensure leaderboard and UI difficulty display remain consistent regardless of how manual difficulty is sourced.

## Puzzle Title Placeholder (Future UI)

Planned behavior:

- In both 2D and 3D board modes, reserve the center area inside the hexagon for an optional puzzle title.
- Titles will usually be absent for normal daily generation, but should be supported for manually added/preset puzzles.
