# DelayerZ

Stagger animations across layers in Adobe Animate with one click.

- **Version:** 1.7.6
- **Host:** Adobe Animate 2021 or newer (Windows)
- **Ships as:** a dockable CEP panel (Delay, Movement and Swap tools) and a Commands menu script

## About

DelayerZ is a small productivity tool for Adobe Animate that removes one of the most repetitive jobs in motion design: offsetting the same animation across many layers so that each one starts a few frames after the previous one. This effect is usually called a stagger, a cascade, or a delay. Doing it by hand means selecting the frames of every layer, dragging them to the right, counting frames, and repeating the process until the timeline looks like a staircase. With six layers that is tedious. With thirty layers it is a real waste of time, and one wrong drag ruins the rhythm of the whole sequence.

DelayerZ does all of that work for you. You select the starting keyframe on two or more layers, type how many frames each layer should wait, choose an order, and press Apply. The tool cuts and pastes the frames of every layer to its new position, cleans up the empty keyframes that Animate leaves behind, and extends the shorter layers so that every layer ends on the same frame. The playhead goes back to where it was, so you can keep working without losing your place.

Three ordering modes are available. Bottom to Top starts with the lowest layer and moves upward. Top to Bottom does the opposite. Random shuffles the layers for a more organic, less mechanical feel, which is great for particles, confetti, icons, or text that should not appear in a strict sequence.

DelayerZ comes in two forms that share the same logic. The CEP panel lives inside Animate as a normal dockable window with a delay field, the three order options, an Apply button, and an Undo button. The panel Undo reverses the entire operation in one step, while the regular Ctrl+Z still undoes it one action at a time. The second form is a JSFL command that appears in the Commands menu. It opens a small dialog with the same options, and because it is a regular command you can assign a keyboard shortcut to it for instant access.

Locked and hidden layers are skipped on purpose, so you can protect any layer you do not want to move. A Windows installer copies the panel and the command to the right folders and enables unsigned extensions for you, so setup takes less than a minute.

## Video tutorials

### 1. CEP panel

Select the first keyframe on at least 2 layers, set the frame delay and the layer order, then press **Apply**. The panel **Undo** button reverses the whole operation at once, while **Ctrl+Z** undoes it step by step.

<!-- Replace with the GitHub attachment URL for docs/videos/cep-panel-tutorial.mp4 (drag the file into the README editor on github.com) -->


https://github.com/user-attachments/assets/bc4cc7fd-b4d9-4137-b6f9-341aa94fc2ff


### 2. Commands menu and keyboard shortcut

Run DelayerZ from **Commands > DelayerZ**, pick the options in the dialog, and add a shortcut in **Edit > Keyboard Shortcuts** (search for "DelayerZ") for faster access.

<!-- Replace with the GitHub attachment URL for docs/videos/jsx-tutorial.mp4 (drag the file into the README editor on github.com) -->


https://github.com/user-attachments/assets/c65d4140-fff8-4dfc-bdbb-df289a4a35e7



## Installation

1. Unzip `DelayerZ-v1.7.6.zip`. It contains the `DelayerZ` folder, `install.bat` and `operator.ps1`.
2. Double click `install.bat` and accept the administrator prompt.
3. If Animate is open, the installer asks whether to close it.
4. Start Animate and open **Window > Extensions > DelayerZ**.

### What the installer does

- Copies the panel to `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\DelayerZ` (or `%APPDATA%\Adobe\CEP\extensions\DelayerZ` if the system folder does not exist).
- Copies `DelayerZ.jsfl` to every `%LOCALAPPDATA%\Adobe\Animate <version>\<locale>\Configuration\Commands` folder it finds.
- Sets `PlayerDebugMode = 1` under `HKCU\Software\Adobe\CSXS.9` to `CSXS.13`, which Animate needs to load unsigned panels.

## Usage

### Delay

Open **Delay** from the icon rail on the left of the panel (staggered bars):

1. In the timeline, select the starting keyframe on 2 or more layers (drag across the layers, or click the layer headers).
2. Set **Delay (frames)**, the frames between each layer: drag the number left or right, click it to type, or use **−** / **+**.
3. Choose **Start from**: Bottom, Top, or Random.
4. Click **Apply**.

Messages (done, or why it could not run) go to the log. Open it with the log button (list icon) at the bottom of the icon rail; the panel version shows at the top of the log. A red dot on the log button means an error came in while the log was closed; it goes when the log opens.

Notes:

- Locked or hidden layers are not moved.
- The panel Undo works once per Apply, in the document and timeline where Apply ran. It refuses to run if layers were added, removed or moved after Apply, to protect your timeline.
- When the animation starts after frame 1, empty keyframes left by the move are cleared automatically.

### Movement

**Movement** (walking figure in the icon rail) changes a character from one movement (Graphic symbol) to another, with a transition copy you re-pose by hand.

1. Pick the two movements with the tiles at the top. Each tile shows a preview of the frame it picked.
   - **Source** (the current movement): select its instance on stage (or the symbol in the Library), then click the Source tile.
   - **Target** (the new movement): select it the same way, then click the Target tile.
   - Or select both instances on stage and click either tile: the one that already runs before the playhead becomes the Source.
2. Set the **Transition duration** in frames (drag the number, or click it to type).
3. Put the playhead where the new movement should start and click **Change Movement**.
   - The panel finds the Source instance at the playhead, so no selection is needed. With two instances of it there, select the one to change. Without a Source, select the current movement instance at the playhead.
   - The current movement is duplicated as `<name>_COPY` and fills the frames before the playhead, on its own layer. The new movement starts at the playhead, on a layer below it.
   - If the current movement runs in a classic tween, the copy stays in that tween on the same layer instead, so the motion keeps going.
   - Both layers show as outlines, and every layer except the new movement's is locked. Move the new movement, and set its first frame in **Properties > Looping** if needed, until it lines up with the copy.
4. Click **Continue** (red). The locks from step 3 go (your own locked layers stay locked). The copy keeps its extra frame over the new movement, and opens on that frame (the playhead). The new movement stays an outline under it. Re-pose the copy to match the outline.
5. Click **Done** (green). The panel leaves the copy, takes its extra frame off (the copy ends one frame before the new movement again), turns the outlines off and puts the playhead on the first frame of the transition. The Source and Target tiles empty.

While Continue or Done waits, only that button and **Cancel** under it work; the Source and Target tiles, the length and the Delay tool are off.

- **Cancel** before Continue puts everything back as it was before Change Movement (layers, locks, and the `_COPY` symbol is deleted). A hidden `TF_BACKUP` guide layer holds the original layer until then.
- **Cancel** before Done works like Done (the transition stays), but keeps the Source and Target.

Notes:

- Keyframes between the start of the transition and the playhead stop it; keyframes on those two frames are fine.
- Undoing step 1 (Ctrl+Z) turns the button back to **Change Movement**.
- Continue only works in the timeline where Change Movement ran.
- Previews are PNGs in `%LOCALAPPDATA%\Temp\DelayerZ`; ones older than a week are deleted at the next pick.

### Swap

**Swap** (two arrows in the icon rail) replaces one part inside a character with a part of another character, for example the chest of `WALK 08` with the chest of `DEMO 01`.

1. **Source** (left): select the character the new part comes from, on stage (or its symbol in the Library), and click its pipette.
2. **Target** (right): select the character to change the same way and click its pipette.
3. Both characters' parts show in one box that scrolls as one: Source parts on the left, Target parts on the right, and matching parts on the same row (`CHEST` next to `CHEST copy`, `HAND L DEMO 01` next to `HAND L DEMO 02`). Click a Source part (the new part): the Target part on its row is picked with it. Click another Target part to replace that one instead.
4. Click **Swap**. Inside the Target, the picked part becomes the Source part, on every keyframe of its layer. The Target list reads again afterwards.

Notes:

- Rows run head to toe (left arm and leg before the right ones). Parts match by the most leading words in common on the same side (L/R); a part with no match gets a row of its own. Hover a part for its full name and layer.
- Position, transform, color effect, first frame and looping of the Target part stay; only the symbol changes.
- The swap edits the Target symbol, so every instance of it changes.
- Only the first level inside each character is listed; parts inside parts are not.
- Two parts with the same name (in different Library folders) show their folder in the list.
- Both characters stay picked when the panel reopens. In another document, each list shows why it cannot be read.

## Usage reporting

DelayerZ counts how often it is used, for the team's zeploy dashboard. Each
time a stagger is applied from the panel ("apply"), undone from the panel
("undo"), or applied from the Commands menu ("command"), a Change Movement is started
("movement"), or a part is swapped ("swap"), it appends one line
to `%LOCALAPPDATA%\zeploy\usage\com.zeus.delayerz.jsonl`; an unexpected
error in apply, undo, a Change Movement step or a swap is counted as an error. The zeploy agent sends daily
totals to the admin app and deletes the file.

- Only the plugin id, version, the event name and how long it took are
  written: no file, layer or user names.
- Nothing is written on a PC without zeploy (no `%LOCALAPPDATA%\zeploy`
  folder), and nothing is ever sent over the network by DelayerZ itself.
- Cancelled dialogs and messages such as "select at least 2 layers" are not
  counted.

The code is zeploy's JSFL helper (`zeployUsageV1`), pasted unchanged at the
top of `jsx/DelayerZ.jsx` and `jsfl/DelayerZ.jsfl` between the "zeploy
usage helper" markers. The contract is `docs/plugin-usage.md` in the zeploy
repository.

## Installing with zeploy

`zeploy.json` lets the zeploy admin app install DelayerZ the way
`install.bat` does: the panel as `CEP\extensions\DelayerZ` and
`DelayerZ.jsfl` in every Animate `Configuration\Commands` folder. Add this
project folder under **Add package** in zeploy.

## Project structure

```
proj_DelayerZ/
  extension/              CEP extension (installed as "DelayerZ")
    CSXS/manifest.xml     Extension manifest (host FLPR, Animate 2021+)
    DelayerZ.html         Panel UI (icon rail: Delay, Movement and Swap)
    css/style.css         Panel styles
    fonts/                IBM Plex Sans 400 + 600 (bundled, OFL.txt licence)
    js/main.js            Panel logic, talks to the JSX bridge
    js/CSInterface.js     Adobe CEP library
    jsx/DelayerZ.jsx      Stagger, undo, Change Movement and Swap logic (runs inside Animate)
    jsfl/DelayerZ.jsfl    Stand-alone Commands menu version
  installer/
    install.bat           Launcher
    operator.ps1          Installer logic
  scripts/
    package.js            Builds the release zip (npm run package)
  docs/
    videos/               Tutorial videos
  package.json
  zeploy.json             How zeploy installs it
  README.md
```

## Building the installer package

Requirements: Windows and Node.js 18 or newer. No npm dependencies.

```bash
npm run package
```

Output: `dist/DelayerZ-v<version>.zip`, containing `DelayerZ/`, `install.bat` and `operator.ps1`.

To release a new version, update `version` in `package.json` and `ExtensionBundleVersion` in `extension/CSXS/manifest.xml` (the build stops if they differ), plus the label in `extension/DelayerZ.html`, `$AppVersion` in `installer/operator.ps1`, `version` in `zeploy.json`, and the version in the `zeployUsageV1(...)` lines of `extension/jsx/DelayerZ.jsx` and `extension/jsfl/DelayerZ.jsfl` (the build also checks the last two).

```bash
npm run clean
```

removes `dist/`.

## Development tips

- Run `installer/install.bat` straight from the repository to install the current `extension/` folder.
- Running the installer from a mapped network drive can fail after the administrator prompt, because elevated processes do not see mapped drives. Copy the project or the unzipped package to a local disk first.
- After editing panel files, close and reopen the panel (or restart Animate) to reload them.

## Credits

Made by Zeus, 2026.
