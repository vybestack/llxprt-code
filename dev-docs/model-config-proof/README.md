# Model Config Screen — TUI Harness Proof (Issue #125)

This directory contains the TUI harness proof artifacts for the Model Config Screen
implemented in PR #2753. The proof was captured using `scripts/tmux-harness.js` with
the script `scripts/tmux-script.model-config-proof.json`.

## Scenario

1. Launch LLxprt with `--profile-load zai` (z.ai Anthropic-compatible provider)
2. Type `/model` (no args — per issue #125 this opens the model browser, not a direct switch)
3. Press `Down` then `Enter` to select `claude-haiku-4-5` from the Models dialog
4. Verify the **Model Configuration** dialog appears (the new feature from PR #2753)
5. Press `Enter` to enter edit mode on `temperature`
6. Press `Ctrl-U` to clear the existing value, type `2`, press `Enter` to save
7. Verify the new value `2` is shown for `temperature`
8. Press `Escape` to close the config dialog and return to the main view

## Artifacts

| File                         | Description                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-models-dialog-open.txt`  | Models dialog with 17 models, `claude-fable-5` selected                                                                                                            |
| `02-model-config-dialog.txt` | **Model Configuration** dialog appears after selecting `claude-haiku-4-5` — shows 6 model params + 5 model behavior settings, `temperature=1` from the zai profile |
| `03-edit-mode.txt`           | Edit mode for `temperature` — shows `Edit temperature (Enter=save Esc=cancel)` prompt with the value `1` in the text input                                         |
| `04-after-edit-save.txt`     | After saving `temperature=2` — the value updates to `2` and the dialog returns to list mode                                                                        |
| `05-after-close.txt`         | After `Escape` — the config dialog closes, returns to the main view with `claude-haiku-4-5` as the active model                                                    |
| `tmux-script.json`           | The tmux harness script used to generate this proof                                                                                                                |

## Reproduction

```bash
node scripts/tmux-harness.js --script scripts/tmux-script.model-config-proof.json
```

## Key observations from the proof

- **AC: `/model` with no args opens browser, selecting a model opens config screen**
  The Models dialog appears (`01-models-dialog-open.txt`) and after selecting
  `claude-haiku-4-5` the Model Configuration dialog appears
  (`02-model-config-dialog.txt`).

- **AC: Config screen shows current provider/model and editable settings**
  Header reads `anthropic / claude-haiku-4-5`. Model Parameters section shows
  `temperature=1` (inherited from the zai profile) and `max_tokens`, `top_p`,
  `top_k`, `frequency_penalty`, `presence_penalty` all `(not set)`. Model
  Behavior section shows `context-limit=200000` (from zai profile) and
  `reasoning.enabled`, `reasoning.effort`, `streaming`, `prompt-caching` as
  `(not set)`.

- **AC: Edit mode works**
  Pressing Enter on `temperature` enters edit mode with the prompt
  `Edit temperature (Enter=save Esc=cancel)` and the current value `1` in the
  text input (`03-edit-mode.txt`).

- **AC: Saving updates the displayed value**
  After clearing the input (`Ctrl-U`), typing `2`, and pressing `Enter`, the
  temperature field shows `2` (`04-after-edit-save.txt`).

- **AC: Escape closes the dialog and returns to main view**
  Pressing `Escape` from list mode closes the config dialog. The main view
  returns with the model switch message `Active model is 'claude-haiku-4-5'
for provider 'anthropic'` visible in scrollback
  (`05-after-close.txt`).
