# Context: Adobe Animate "Create Transition" automation (JSFL / CEP)

## Who / what
Albert runs Zeus Animation Studio (2D/3D animation, Malang, Indonesia). He wants to automate a repetitive, error-prone Adobe Animate workflow for his animators. Target tool: a JSFL command, optionally wrapped in a CEP panel later.

## The manual workflow being automated (as described by Albert)
Characters are rigged with Animate's built-in Bone tool. Each movement is its own **looping animation inside its own symbol** (one symbol per movement). To blend movement A (character1) into movement B (character2):

1. character1's animation lives inside symbol1 on the main timeline.
2. Outside the symbol, create a keyframe for the transition (30-60 frames, varies by movement and workflow).
3. Select the first keyframe and duplicate the symbol (`character1_COPY`) so the transition can be edited separately from the original animation.
4. Create another keyframe N frames later.
5. Paste character2 into a temporary new layer (only so the symbol can be selected and its name copied; the layer is deleted afterward).
6. Move the playhead to keyframe 2 and use Find and Replace: Search = Symbol, Find = `character1_COPY`, Replace = `character2`, option = Current Frame. This swaps the instance on that keyframe to character2.
7. Edit inside `character1_COPY`: **re-pose the bones** so its pose matches the first frame of character2.

Pain points: too many steps, easy to make mistakes (wrong selection, typos, forgetting to delete the temp layer).

## Confirmed answers from Albert
- Most assets are looping movements, one symbol per movement.
- Rig uses the **Bone tool** (not Asset Warp).
- Step 7 is re-posing bones to match character2's first frame.
- The temp layer in step 5 is only for selecting/copying the symbol name, so a library dropdown can replace it.
- Transition length depends on the movement and workflow, so it must be a user input (remember last value; presets possible later).
- New idea from Albert: instead of always starting at the first keyframe, he moves the **playhead to a specific frame** and selects the instance, so the transition can begin anywhere in character1's loop.

## Agreed design: "Create Transition" command
Inputs: playhead frame P, one selected symbol instance (character1), target symbol name (character2, chosen from a library dropdown), transition length N.

Steps:
1. Validate: exactly one selected element, it is a symbol instance, and warn otherwise.
2. Insert a keyframe at P if none exists (original animation before P untouched).
3. Duplicate the symbol as `character1_COPY` (never overwrite an existing name; unique suffix if needed) and swap the instance at P to the copy.
4. Compute the copy's start pose so it matches what character1 shows at P. Because character1 loops, use something like `innerFrame = (firstFrame + (P - keyframeStart)) % symbolLength` and set the copy's first frame (or hold a single frame) accordingly, so there is no pop at the cut.
5. Insert a keyframe at P + N and swap that instance to character2 with `swapElement`.
6. Preserve position, transform and loop settings across swaps.
7. Re-pose (step 7 of the manual workflow) is the hard part, see below.

Edge cases to handle: no selection or multiple selection, non-symbol selection, P on the span's last frame, P + N beyond the layer's end, an existing keyframe between P and P + N (ask before overwriting).

## Step 7 (re-pose) plan, unverified
- **Option A (preferred if it works):** if both symbols share the same armature, copy character2's first pose frame (`timeline.copyFrames`) and paste it (`pasteFrames`) into the right frame of the copy's armature layer. Albert then only fine-tunes.
- **Option B:** read and write bone values directly through script. JSFL support for bones is limited, so this may not be possible.
- First delivery should automate everything except step 7 if neither option works, and leave step 7 to the animator.

## JSFL APIs expected to be useful (verify against the real Animate version)
`fl.getDocumentDOM()`, `document.getTimeline()`, `timeline.currentFrame` (0-based), `timeline.insertKeyframe()`, `timeline.copyFrames()` / `pasteFrames()`, `document.selection`, `document.swapElement(name)`, `document.library.duplicateItem(name)`, `document.library.editItem(name)`, `document.exitEditMode()`, `library.addItemToDocument()`, instance properties `firstFrame`, `loop` ("loop" / "play once" / "single frame"), `symbolType` ("graphic" / "movie clip"), `libraryItem.name`. Frame control (firstFrame/loop) only applies to **Graphic** symbols, not Movie Clips.

## Current status
- Written and delivered: `inspect_rig.jsfl`, a **read-only** probe. It reports the selected instance's instanceType, symbolType, firstFrame, loop mode, the keyframe span at the playhead, and then enters the symbol and lists its layers (names, layerType, frame counts, keyframes), flagging armature-like layers. It exits edit mode afterward and changes nothing.
- **The probe has not been run yet.** Nothing about how the rig reports itself in JSFL is confirmed.
- Albert asked to continue in Claude Code, where the JSFL can be tested against his open Animate.

## Open questions for Albert
1. Are the movement symbols **Graphic** or **Movie Clip**? (Graphic gives control of first frame and loop; Movie Clip would need another approach.)
2. After the transition ends at P + N, should character2 keep looping from its first frame?
3. Is the transition a classic tween between the two keyframes, or does the inner timeline of the copy carry the transition?
4. Do character1 and character2 use exactly the same bones, or are some movements rigged differently?
5. When re-posing the copy, is the target the last frame of the transition so it ends exactly on character2's first frame, and does the copy keep its own loop in the earlier frames?

## Next steps
1. Run `inspect_rig.jsfl` in Albert's Animate and review the Output panel result (layer types, loop/firstFrame behavior, whether the armature appears as a distinct layer type).
2. Test Option A for the pose copy on a real pair of symbols.
3. Write `create_transition.jsfl` (v0.1: steps 1-6 automated, re-pose either automated or left manual depending on step 2).
4. Wrap it in a CEP panel: library dropdown for character2, remembered N, naming options, optional presets.

## Notes on collaboration
Albert may have Animate open with his rig. Screenshots only show the UI, not the object model, so script output from the probe is the more reliable source of truth. He previously confused JSFL with After Effects' `.jsx`; for Animate, scripts are `.jsfl` and panels are CEP extensions.
