// ============================================================
// DelayerZ - ExtendScript (JSX) Bridge for Adobe Animate
// Compatible with ExtendScript ES3
// v1.5 - Fix: clear stage selection before cut/paste to prevent blank layer bug
// v1.6 - Fix: normalize frame selection to animStartFrame before cut/paste loop
// v1.7 - Revert v1.6: multi-layer setSelectedFrames caused cutFrames to cut all layers at once
// ============================================================

// --- Undo state (saved after a successful apply) ---
var _lastOp = null;

// --- HELPER: Array.indexOf replacement (not available in ES3) ---
function arrContains(arr, val) {
    for (var x = 0; x < arr.length; x++) {
        if (arr[x] === val) return true;
    }
    return false;
}

/**
 * Main function - called from the panel via evalScript()
 * @param {number} delayVal  - frame delay amount
 * @param {string} mode      - "normal" | "inverted" | "random"
 * @returns {string}         - "OK: ..." or "ERROR: ..."
 */
function applyDelayerZ(delayVal, mode) {
    try {

        var doc = fl.getDocumentDOM();
        if (!doc) return "ERROR: No document is open.";

        var tl = doc.getTimeline();

        // --- 1. SAVE INITIAL FRAME POSITION ---
        var originalFramePos = tl.currentFrame;
        var animStartFrame = tl.currentFrame;

        // --- 2. DETECT TARGET LAYERS (three-priority strategy) ---
        //
        // Priority 1 - tl.getSelectedFrames()
        //   Triggered by: double-clicking the frame ruler, or manually dragging
        //   a frame selection across layers in the timeline.
        //   Returns a flat array of triplets: [layerIdx, startFrame, endFrame, ...]
        //   This is the most explicit signal - the user literally selected frames
        //   on specific layers. Extract unique layer indices from the triplets.
        //
        // Priority 2 - doc.selection (stage objects)
        //   Triggered by: clicking or drag-selecting elements on the stage.
        //   We resolve each element back to its parent layer.
        //   This is used instead of tl.layers[i].selected because stage selection
        //   can set .selected = true on collateral layers (guide, mask, folder
        //   layers that are affiliated), causing extra layers to be picked up and
        //   inflating the stagger delay.
        //
        // Priority 3 - tl.layers[i].selected (layer header click)
        //   Triggered by: clicking layer name/header in the timeline panel.
        //   Used only when neither of the above produced any results.

        var targetLayers = [];
        var i, j;
        var selectedFrames = tl.getSelectedFrames();

        // --- Priority 1: frame ruler / timeline frame selection ---
        if (selectedFrames && selectedFrames.length >= 3) {
            // triplet layout: [layerIdx, start, end,  layerIdx, start, end, ...]
            for (i = 0; i < selectedFrames.length; i += 3) {
                var fLayerIdx = selectedFrames[i];
                if (!arrContains(targetLayers, fLayerIdx)) {
                    targetLayers.push(fLayerIdx);
                }
            }
        }

        // --- Priority 2: stage object selection (temporarily disabled) ---
        // Selecting elements directly from the stage causes cutFrames() to
        // behave unexpectedly even after clearing doc.selection. Disabled
        // until a reliable workaround is found.
        // if (targetLayers.length === 0 && doc.selection && doc.selection.length > 0) {
        //     for (i = 0; i < doc.selection.length; i++) {
        //         var layerObj = doc.selection[i].layer;
        //         for (j = 0; j < tl.layers.length; j++) {
        //             if (tl.layers[j] === layerObj) {
        //                 if (!arrContains(targetLayers, j)) {
        //                     targetLayers.push(j);
        //                 }
        //                 break;
        //             }
        //         }
        //     }
        // }

        // --- Priority 3: layer header selection ---
        if (targetLayers.length === 0) {
            for (i = 0; i < tl.layers.length; i++) {
                if (tl.layers[i].selected) {
                    targetLayers.push(i);
                }
            }
        }

        if (targetLayers.length < 2) {
            return "ERROR: Select at least 2 layers in the timeline.";
        }

        // Clear stage selection before any cut/paste operations.
        // If elements are still selected on stage when cutFrames() is called,
        // Animate may route the operation to the object clipboard instead of
        // the frame clipboard -- causing pasteFrames() to paste nothing (blank).
        doc.selection = [];

        // --- 3. VALIDATE DELAY ---
        var absDelay = Math.abs(parseInt(delayVal, 10));
        if (isNaN(absDelay) || absDelay < 1) {
            return "ERROR: Invalid delay value (minimum 1).";
        }

        // --- 4. DETERMINE LAYER ORDER ---
        var orderedLayers = [];
        for (i = 0; i < targetLayers.length; i++) {
            orderedLayers.push(targetLayers[i]);
        }

        // Bubble sort ascending
        var swapped, tmpSort;
        do {
            swapped = false;
            for (i = 0; i < orderedLayers.length - 1; i++) {
                if (orderedLayers[i] > orderedLayers[i + 1]) {
                    tmpSort = orderedLayers[i];
                    orderedLayers[i] = orderedLayers[i + 1];
                    orderedLayers[i + 1] = tmpSort;
                    swapped = true;
                }
            }
        } while (swapped);

        if (mode === "normal") {
            var reversed = [];
            for (i = orderedLayers.length - 1; i >= 0; i--) {
                reversed.push(orderedLayers[i]);
            }
            orderedLayers = reversed;
        } else if (mode === "random") {
            var rTemp;
            for (i = orderedLayers.length - 1; i > 0; i--) {
                j = Math.floor(Math.random() * (i + 1));
                rTemp = orderedLayers[i];
                orderedLayers[i] = orderedLayers[j];
                orderedLayers[j] = rTemp;
            }
        }
        // "inverted" -> ascending order is already correct

        // --- 5. SAVE ORIGINAL LENGTHS BEFORE SHIFTING (for undo) ---
        var originalLengths = [];
        for (i = 0; i < orderedLayers.length; i++) {
            originalLengths.push(tl.layers[orderedLayers[i]].frames.length);
        }

        // --- 6. APPLY FRAME SHIFTS ---
        var layerIdx, layer, shiftAmount, originalEnd, f, fr;

        for (i = 0; i < orderedLayers.length; i++) {
            layerIdx = orderedLayers[i];
            layer = tl.layers[layerIdx];
            shiftAmount = i * absDelay;
            originalEnd = layer.frames.length;

            tl.currentLayer = layerIdx;

            if (shiftAmount > 0 && !layer.locked && layer.visible) {
                tl.setSelectedFrames(animStartFrame, originalEnd);
                tl.cutFrames();
                tl.setSelectedFrames(animStartFrame + shiftAmount, animStartFrame + shiftAmount);
                tl.pasteFrames();
            }
        }

        // --- 6b. CLEANUP: remove blank keyframe artifacts left by cutFrames ---
        //
        // Why clearKeyframes instead of removeFrames?
        // - removeFrames -> deletes the frame SLOT -> content shifts left -> stagger lost
        // - clearKeyframes -> removes only the KEYFRAME MARKER, slot remains
        //   -> the span from the previous frame fills the gap naturally
        //   -> stagger is preserved, blank keyframe artifact is gone
        //
        // Undo logic does not need to be updated since frame slots are unchanged.
        //
        // EXCEPTION: if the animation starts at frame 1 (index 0), blank keyframes
        // at the beginning of the timeline are natural and harmless -- skip cleanup.
        if (animStartFrame > 0) {
            for (i = 0; i < orderedLayers.length; i++) {
                layerIdx = orderedLayers[i];
                layer = tl.layers[layerIdx];
                shiftAmount = i * absDelay;

                if (shiftAmount === 0 || layer.locked || !layer.visible) continue;

                tl.currentLayer = layerIdx;

                // Scan from animStartFrame to end of gap (animStartFrame + shiftAmount - 1).
                // cutFrames() leaves a blank keyframe at every keyframe position within
                // the cut range. This loop clears all blank keyframes inside that gap.
                for (f = animStartFrame; f < animStartFrame + shiftAmount; f++) {
                    if (f >= layer.frames.length) break;
                    fr = layer.frames[f];

                    // Blank keyframe conditions:
                    // 1. fr.startFrame === f  -> this frame is a span head (not a span tail)
                    // 2. fr.elements.length === 0 -> no objects inside
                    // 3. fr.tweenType === "none" -> not part of a classic tween
                    if (fr.startFrame === f &&
                        fr.elements.length === 0 &&
                        fr.tweenType === "none") {
                        tl.clearKeyframes(f, f + 1);
                    }
                }
            }
        }

        // --- 7. ALIGNMENT: equalize length of all target layers ---
        var finalMaxFrame = 0;
        var k, m, checkLayer, targetIdx, layerToFix, currentLen;

        for (k = 0; k < targetLayers.length; k++) {
            checkLayer = tl.layers[targetLayers[k]];
            if (checkLayer.frames.length > finalMaxFrame) {
                finalMaxFrame = checkLayer.frames.length;
            }
        }

        for (m = 0; m < targetLayers.length; m++) {
            targetIdx = targetLayers[m];
            layerToFix = tl.layers[targetIdx];
            currentLen = layerToFix.frames.length;

            if (currentLen < finalMaxFrame && !layerToFix.locked) {
                tl.currentLayer = targetIdx;
                tl.insertFrames(finalMaxFrame - currentLen, false, currentLen);
            }
        }

        // --- 8. SAVE STATE FOR UNDO ---
        _lastOp = {
            orderedLayers: orderedLayers,
            delay: absDelay,
            startFrame: animStartFrame,
            originalLengths: originalLengths,
            layerCount: tl.layers.length  // snapshot for stale-state detection on undo
        };

        // --- 9. RETURN TO INITIAL FRAME POSITION ---
        tl.currentFrame = originalFramePos;

        return "OK: Stagger applied to " + targetLayers.length + " layers.";

    } catch (err) {
        return "ERROR: " + err.toString();
    }
}

/**
 * Reverses the last applyDelayerZ operation as a SINGLE undo step.
 * Called from the panel via evalScript().
 * @returns {string} - "OK: ..." or "ERROR: ..."
 */
function undoDelayerZ() {
    if (!_lastOp) {
        return "ERROR: No DelayerZ operation to undo.";
    }

    try {
        var doc = fl.getDocumentDOM();
        if (!doc) return "ERROR: No document is open.";

        var tl = doc.getTimeline();
        var op = _lastOp;
        var i, layerIdx, layer, shiftAmount, origLen, currentLen;

        // --- GUARD 1: detect stale state ---
        // If the layer count changed since Apply, the stored indices may be
        // invalid or pointing to completely different layers. Abort safely.
        if (tl.layers.length !== op.layerCount) {
            _lastOp = null;
            return "ERROR: Timeline structure changed since Apply (layers were added or removed). Undo is not safe.";
        }

        // Process in reverse: start from the LAST layer (largest shift) down to the first.
        // This prevents frame position conflicts between layers during restoration.
        for (i = op.orderedLayers.length - 1; i >= 0; i--) {
            layerIdx = op.orderedLayers[i];
            shiftAmount = i * op.delay;
            origLen = op.originalLengths[i];

            // --- GUARD 2: layer index bounds check ---
            // The stored index may be out of range if layers were reordered/removed.
            if (layerIdx >= tl.layers.length) {
                _lastOp = null;
                return "ERROR: Layer index " + layerIdx + " is out of range. Timeline was modified after Apply. Undo aborted.";
            }

            layer = tl.layers[layerIdx];

            // --- GUARD 3: null layer check ---
            if (!layer) {
                _lastOp = null;
                return "ERROR: Could not access layer at index " + layerIdx + ". Undo aborted.";
            }

            tl.currentLayer = layerIdx;
            currentLen = layer.frames.length;

            if (!layer.locked && layer.visible) {

                if (shiftAmount > 0) {

                    // --- GUARD 4: invalid frame range check ---
                    // If startFrame + shiftAmount >= currentLen the selection range is
                    // empty or inverted -- setSelectedFrames would crash Animate.
                    // This typically happens when the user pressed native Ctrl+Z
                    // (partially reverting the stagger) before clicking Undo in the panel.
                    if (op.startFrame + shiftAmount >= currentLen) {
                        _lastOp = null;
                        return "ERROR: Frame range out of bounds on layer \"" + layer.name + "\" (expected content at frame " + (op.startFrame + shiftAmount) + ", layer has " + currentLen + " frames). Timeline was modified after Apply. Undo aborted.";
                    }

                    // Cut from the shifted position to the end of the layer,
                    // then paste back at the original position.
                    tl.setSelectedFrames(op.startFrame + shiftAmount, currentLen);
                    tl.cutFrames();
                    tl.setSelectedFrames(op.startFrame, op.startFrame);
                    tl.pasteFrames();
                }

                // Trim any extra frames (leftover from alignment or paste) back to original length
                currentLen = layer.frames.length;
                if (currentLen > origLen) {
                    tl.removeFrames(origLen, currentLen);
                }
            }
        }

        // Return playhead to the frame where Apply was triggered
        tl.currentFrame = op.startFrame;

        // Clear undo state (undo can only be performed once per apply)
        _lastOp = null;

        return "OK: Undo successful. All layers restored to their original positions.";

    } catch (err) {
        // Always clear stale state on unexpected errors so the Undo button
        // doesn't stay enabled and trigger a second broken undo attempt.
        _lastOp = null;
        return "ERROR: " + err.toString();
    }
}