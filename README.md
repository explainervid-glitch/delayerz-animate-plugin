# DelayerZ

Stagger animations across layers in Adobe Animate with one click.

- **Version:** 1.3.0
- **Host:** Adobe Animate 2024 or newer (Windows)
- **Ships as:** a dockable CEP panel and a Commands menu script

## About

DelayerZ is a small productivity tool for Adobe Animate that removes one of the most repetitive jobs in motion design: offsetting the same animation across many layers so that each one starts a few frames after the previous one. This effect is usually called a stagger, a cascade, or a delay. Doing it by hand means selecting the frames of every layer, dragging them to the right, counting frames, and repeating the process until the timeline looks like a staircase. With six layers that is tedious. With thirty layers it is a real waste of time, and one wrong drag ruins the rhythm of the whole sequence.

DelayerZ does all of that work for you. You select the starting keyframe on two or more layers, type how many frames each layer should wait, choose an order, and press Apply. The tool cuts and pastes the frames of every layer to its new position, cleans up the empty keyframes that Animate leaves behind, and extends the shorter layers so that every layer ends on the same frame. The playhead goes back to where it was, so you can keep working without losing your place.

Three ordering modes are available. Bottom to Top starts with the lowest layer and moves upward. Top to Bottom does the opposite. Random shuffles the layers for a more organic, less mechanical feel, which is great for particles, confetti, icons, or text that should not appear in a strict sequence.

DelayerZ comes in two forms that share the same logic. The CEP panel lives inside Animate as a normal dockable window with a delay field, the three order options, an Apply button, and an Undo button. The panel Undo reverses the entire operation in one step, while the regular Ctrl+Z still undoes it one action at a time. The second form is a JSFL command that appears in the Commands menu. It opens a small dialog with the same options, and because it is a regular command you can assign a keyboard shortcut to it for instant access.

Locked and hidden layers are skipped on purpose, so you can protect any layer you do not want to move. A Windows installer copies the panel and the command to the right folders and enables unsigned extensions for you, so setup takes less than a minute.

## Video tutorials

### 1. CEP panel

Select the first keyframe on at least 2 layers, set the frame delay and the layer order, then press **Apply**. The panel **Undo** button reverses the whole operation at once, while **Ctrl+Z** undoes it step by step.

<video src="docs/videos/cep-panel-tutorial.mp4" controls width="100%"></video>

[Watch cep-panel-tutorial.mp4](docs/videos/cep-panel-tutorial.mp4) (28 seconds)

### 2. Commands menu and keyboard shortcut

Run DelayerZ from **Commands > DelayerZ**, pick the options in the dialog, and add a shortcut in **Edit > Keyboard Shortcuts** (search for "DelayerZ") for faster access.

<video src="docs/videos/jsx-tutorial.mp4" controls width="100%"></video>

[Watch jsx-tutorial.mp4](docs/videos/jsx-tutorial.mp4) (42 seconds)

## Installation

1. Unzip `DelayerZ-v1.3.0.zip`. It contains the `DelayerZ` folder, `install.bat` and `operator.ps1`.
2. Double click `install.bat` and accept the administrator prompt.
3. If Animate is open, the installer asks whether to close it.
4. Start Animate and open **Window > Extensions > DelayerZ**.

### What the installer does

- Copies the panel to `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\DelayerZ` (or `%APPDATA%\Adobe\CEP\extensions\DelayerZ` if the system folder does not exist).
- Copies `DelayerZ.jsfl` to every `%LOCALAPPDATA%\Adobe\Animate <version>\<locale>\Configuration\Commands` folder it finds.
- Sets `PlayerDebugMode = 1` under `HKCU\Software\Adobe\CSXS.9` to `CSXS.13`, which Animate needs to load unsigned panels.

## Usage

1. In the timeline, select the starting keyframe on 2 or more layers (drag across the layers, or click the layer headers).
2. Enter the **Frame Delay** (frames between each layer).
3. Choose the **Layer Order**: Bottom to Top, Top to Bottom, or Random.
4. Click **Apply**.

Notes:

- Locked or hidden layers are not moved.
- The panel Undo works once per Apply. It refuses to run if layers were added or removed after Apply, to protect your timeline.
- When the animation starts after frame 1, empty keyframes left by the move are cleared automatically.

## Project structure

```
proj_DelayerZ/
  extension/              CEP extension (installed as "DelayerZ")
    CSXS/manifest.xml     Extension manifest (host FLPR, Animate 2024+)
    DelayerZ.html         Panel UI
    css/style.css         Panel styles
    js/main.js            Panel logic, talks to the JSX bridge
    js/CSInterface.js     Adobe CEP library
    jsx/DelayerZ.jsx      Stagger and undo logic (runs inside Animate)
    jsfl/DelayerZ.jsfl    Stand-alone Commands menu version
  installer/
    install.bat           Launcher
    operator.ps1          Installer logic
  scripts/
    package.js            Builds the release zip (npm run package)
  docs/
    videos/               Tutorial videos
  package.json
  README.md
```

## Building the installer package

Requirements: Windows and Node.js 18 or newer. No npm dependencies.

```bash
npm run package
```

Output: `dist/DelayerZ-v<version>.zip`, containing `DelayerZ/`, `install.bat` and `operator.ps1`.

To release a new version, update `version` in `package.json` and `ExtensionBundleVersion` in `extension/CSXS/manifest.xml` (the build stops if they differ), plus the label in `extension/DelayerZ.html` and `$AppVersion` in `installer/operator.ps1`.

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
