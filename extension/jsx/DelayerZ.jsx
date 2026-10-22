// ============================================================
// DelayerZ - ExtendScript (JSX) Bridge for Adobe Animate
// Compatible with ExtendScript ES3
// v1.5 - Fix: clear stage selection before cut/paste to prevent blank layer bug
// v1.6 - Fix: normalize frame selection to animStartFrame before cut/paste loop
// v1.7 - Revert v1.6: multi-layer setSelectedFrames caused cutFrames to cut all layers at once
// ============================================================

// ---- zeploy usage helper (begin): an unchanged copy of examples/usage/zeploy-usage.jsfl
// from the zeploy repository. Counts DelayerZ use for the team's zeploy
// dashboard; writes nothing on PCs without zeploy. Do not edit.
// zeploy usage helper for Animate JSFL commands. Paste it at the top of the
// command (JSFL has no includes for commands) and leave it unchanged.
// Contract: docs/plugin-usage.md in the zeploy repository.
//
//   var usage = zeployUsageV1("DelayerZ.jsfl", "1.1.0");
//   usage.action("run");                          // the command was run
//   usage.track("run", function () { ... });       // ... with its duration
//   usage.error("run");                           // it failed
//
// It appends one line to %LOCALAPPDATA%\zeploy\usage\<plugin>.jsonl, and
// only on PCs where zeploy is installed. It never throws, never shows
// anything and never uses the network.

function zeployUsageV1(plugin, version) {
  var MAX_BYTES = 524288;

  function pad(n, width) {
    var s = String(n);
    while (s.length < (width || 2)) s = "0" + s;
    return s;
  }

  function iso(d) {
    return (
      d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) +
      "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) +
      "." + pad(d.getUTCMilliseconds(), 3) + "Z"
    );
  }

  function str(value) {
    var s = String(value);
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var code = s.charCodeAt(i);
      if (c === '"' || c === "\\") out += "\\" + c;
      else if (code < 32 || code > 126) {
        var hex = code.toString(16);
        while (hex.length < 4) hex = "0" + hex;
        out += "\\u" + hex;
      } else out += c;
    }
    return out + '"';
  }

  // fl.configURI is file:///C|/Users/<name>/AppData/Local/Adobe/Animate <version>/<language>/Configuration/
  function localAppDataUri() {
    var i = fl.configURI.toLowerCase().indexOf("/adobe/");
    return i > 0 ? fl.configURI.substring(0, i) : null;
  }

  function write(ev, name, ms) {
    try {
      var base = localAppDataUri();
      if (!base) return;
      var home = base + "/zeploy";
      if (!FLfile.exists(home)) return;
      var dir = home + "/usage";
      if (!FLfile.exists(dir) && !FLfile.createFolder(dir)) return;
      var file = dir + "/" + String(plugin).replace(/[^A-Za-z0-9._-]/g, "_") + ".jsonl";
      if (FLfile.exists(file) && FLfile.getSize(file) > MAX_BYTES) return;
      var line = '{"v":1,"t":' + str(iso(new Date())) + ',"plugin":' + str(plugin);
      if (version) line += ',"ver":' + str(version);
      line += ',"app":"animate","ev":' + str(ev);
      if (name) line += ',"name":' + str(name);
      if (typeof ms === "number" && ms >= 0) line += ',"ms":' + Math.round(ms);
      FLfile.write(file, line + "}\n", "append");
    } catch (e) {
      // Usage must never get in the way of the command.
    }
  }

  return {
    action: function (name, ms) {
      write("action", name, ms);
    },
    error: function (name) {
      write("error", name);
    },
    track: function (name, fn) {
      var start = new Date().getTime();
      var result;
      try {
        result = fn();
      } catch (e) {
        write("error", name);
        throw e;
      }
      write("action", name, new Date().getTime() - start);
      return result;
    },
  };
}
// ---- zeploy usage helper (end) ----

// --- Undo state (saved after a successful apply) ---
var _lastOp = null;

// --- Usage for zeploy: one "apply" or "undo" per completed operation, and
// an error when one fails unexpectedly. Validation messages ("select at
// least 2 layers") are not counted. Keep the version in step with
// CSXS/manifest.xml (npm run package checks it).
var delayerzUsage = zeployUsageV1("com.zeus.delayerz", "1.5.0");

// --- HELPER: Array.indexOf replacement (not available in ES3) ---
function arrContains(arr, val) {
    for (var x = 0; x < arr.length; x++) {
        if (arr[x] === val) return true;
    }
    return false;
}

// --- HELPER: drop folder and camera layers (no frames to move) ---
function filterMovableLayers(tl, indices) {
    var kept = [];
    for (var x = 0; x < indices.length; x++) {
        var type = tl.layers[indices[x]].layerType;
        if (type !== "folder" && type !== "camera") kept.push(indices[x]);
    }
    return kept;
}

/**
 * Main function - called from the panel via evalScript()
 * @param {number} delayVal  - frame delay amount
 * @param {string} mode      - "normal" | "inverted" | "random"
 * @returns {string}         - "OK: ..." or "ERROR: ..."
 */
function applyDelayerZ(delayVal, mode) {
    var usageStart = new Date().getTime();
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

        // Folder and camera layers are dropped before counting, so a selected
        // folder header does not count as one of the 2 layers.
        targetLayers = filterMovableLayers(tl, targetLayers);

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

        // --- 5. PLAN THE SHIFTS AND CHECK THEM BEFORE MOVING ANYTHING ---
        // shifts[i] is how far orderedLayers[i] moves: 0 for the first layer
        // and for locked or hidden layers, which are left alone. Undo uses
        // this record, not the layers' locked/hidden state at Undo time.
        //
        // A layer that moves must have frames at or after the playhead.
        // Otherwise its cut range is empty, cutFrames() cuts nothing, and
        // pasteFrames() pastes the previous layer's frames from the clipboard.
        var layerIdx, layer, shiftAmount, originalEnd, f, fr;
        var shifts = [];
        var originalLengths = [];

        for (i = 0; i < orderedLayers.length; i++) {
            layer = tl.layers[orderedLayers[i]];
            shifts.push(layer.locked || !layer.visible ? 0 : i * absDelay);
            originalLengths.push(layer.frames.length);

            if (shifts[i] > 0 && animStartFrame >= layer.frames.length) {
                return "ERROR: \"" + layer.name + "\" has no frames at or after frame " +
                    (animStartFrame + 1) + ". Move the playhead or deselect that layer.";
            }
        }

        // --- 6. APPLY FRAME SHIFTS ---
        for (i = 0; i < orderedLayers.length; i++) {
            layerIdx = orderedLayers[i];
            layer = tl.layers[layerIdx];
            shiftAmount = shifts[i];
            originalEnd = layer.frames.length;

            tl.currentLayer = layerIdx;

            if (shiftAmount > 0) {
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
                shiftAmount = shifts[i];

                if (shiftAmount === 0) continue;

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
        // Where Apply ran (document + timeline), and per layer: its name (to
        // detect reordering), how far it moved, and its length before and
        // after Apply (a longer endLen means the alignment step extended it).
        var layerRecords = [];
        for (i = 0; i < orderedLayers.length; i++) {
            layer = tl.layers[orderedLayers[i]];
            layerRecords.push({
                index: orderedLayers[i],
                name: layer.name,
                shift: shifts[i],
                origLen: originalLengths[i],
                endLen: layer.frames.length
            });
        }

        _lastOp = {
            docId: doc.id,
            docName: doc.name,
            timelineName: tl.name,
            startFrame: animStartFrame,
            layerCount: tl.layers.length,  // snapshot for stale-state detection on undo
            layers: layerRecords
        };

        // --- 9. RETURN TO INITIAL FRAME POSITION ---
        tl.currentFrame = originalFramePos;

        delayerzUsage.action("apply", new Date().getTime() - usageStart);
        return "OK: Stagger applied to " + targetLayers.length + " layers.";

    } catch (err) {
        delayerzUsage.error("apply");
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

    var usageStart = new Date().getTime();
    try {
        var doc = fl.getDocumentDOM();
        if (!doc) return "ERROR: No document is open.";

        var tl = doc.getTimeline();
        var op = _lastOp;
        var i, rec, layer, currentLen;

        // All checks run before the first frame moves, so a refused Undo
        // never leaves the timeline half restored.

        // --- CHECK 1: same document and timeline as Apply ---
        // The undo state is shared by every open document and symbol. Keep it,
        // so Undo works once the user switches back.
        if (doc.id !== op.docId || tl.name !== op.timelineName) {
            return "ERROR: Undo only works where Apply ran: switch back to \"" +
                op.docName + "\" > \"" + op.timelineName + "\".";
        }

        // --- CHECK 2: no layers added, removed or reordered ---
        // The record stores layers by position; a changed position would
        // point Undo at a different layer.
        if (tl.layers.length !== op.layerCount) {
            _lastOp = null;
            return "ERROR: Layers were added or removed since Apply. Undo with Ctrl+Z.";
        }
        for (i = 0; i < op.layers.length; i++) {
            rec = op.layers[i];
            if (tl.layers[rec.index].name !== rec.name) {
                _lastOp = null;
                return "ERROR: Layers were moved since Apply. Undo with Ctrl+Z.";
            }
        }

        // --- CHECK 3: every layer Apply changed can be restored ---
        // Only layers Apply moved (shift > 0) or extended (endLen > origLen)
        // are restored, whatever their locked/hidden state is now.
        for (i = 0; i < op.layers.length; i++) {
            rec = op.layers[i];
            if (rec.shift === 0 && rec.endLen <= rec.origLen) continue;
            layer = tl.layers[rec.index];

            if (layer.locked || (rec.shift > 0 && !layer.visible)) {
                return "ERROR: Unlock and show layer \"" + rec.name + "\", then click Undo again.";
            }

            // An empty or inverted range here means the layer was edited after
            // Apply (often a native Ctrl+Z that partly reverted the stagger).
            currentLen = layer.frames.length;
            if (rec.shift > 0 && op.startFrame + rec.shift >= currentLen) {
                _lastOp = null;
                return "ERROR: Frame range out of bounds on layer \"" + rec.name + "\" (expected content at frame " + (op.startFrame + rec.shift) + ", layer has " + currentLen + " frames). Timeline was modified after Apply. Undo aborted.";
            }
        }

        // --- RESTORE ---
        // Process in reverse: start from the LAST layer (largest shift) down to the first.
        for (i = op.layers.length - 1; i >= 0; i--) {
            rec = op.layers[i];
            if (rec.shift === 0 && rec.endLen <= rec.origLen) continue;
            layer = tl.layers[rec.index];

            tl.currentLayer = rec.index;

            if (rec.shift > 0) {
                // Cut from the shifted position to the end of the layer,
                // then paste back at the original position.
                tl.setSelectedFrames(op.startFrame + rec.shift, layer.frames.length);
                tl.cutFrames();
                tl.setSelectedFrames(op.startFrame, op.startFrame);
                tl.pasteFrames();
            }

            // Trim any extra frames (leftover from alignment or paste) back to original length
            currentLen = layer.frames.length;
            if (currentLen > rec.origLen) {
                tl.removeFrames(rec.origLen, currentLen);
            }
        }

        // Return playhead to the frame where Apply was triggered
        tl.currentFrame = op.startFrame;

        // Clear undo state (undo can only be performed once per apply)
        _lastOp = null;

        delayerzUsage.action("undo", new Date().getTime() - usageStart);
        return "OK: Undo successful. All layers restored to their original positions.";

    } catch (err) {
        // Always clear stale state on unexpected errors so the Undo button
        // doesn't stay enabled and trigger a second broken undo attempt.
        _lastOp = null;
        delayerzUsage.error("undo");
        return "ERROR: " + err.toString();
    }
}

/**
 * Tells the panel whether there is an Apply to undo, so the Undo button
 * follows the real state (a refused Undo or a rejected Apply keeps it).
 * @returns {string} - "1" or "0"
 */
function canUndoDelayerZ() {
    return _lastOp ? "1" : "0";
}