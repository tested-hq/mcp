# close-patch

Close uncovered patch lines by writing tests next to the existing suite.
Do not guess the test file. Do not stub coverage. Loop until `check` is green.

## Sequence

1. `get_uncovered_diff` — once, at the start. Note every file + range.
2. `map_uncovered_to_test` — the colocate / `*.test.*` / `__tests__` file each range belongs in (`existing: true` means write there).
3. `write_and_verify` — write the **complete** test file (keep existing cases) and re-run coverage. Prefer this over a separate write + diff.
4. `check` — patch / project thresholds from `.tested.yaml`. If it fails, read `write_and_verify` stderr / remaining ranges and repeat from step 3 (at most a handful of times). Call `get_uncovered_diff` at most once more to confirm closure.

Stop when `check.overall` is `pass` or the remaining ranges are outside the files you were asked to cover.
