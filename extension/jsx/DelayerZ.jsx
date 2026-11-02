// ============================================================
// DelayerZ - ExtendScript (JSX) Bridge for Adobe Animate
// Compatible with ExtendScript ES3
// v1.5 - Fix: clear stage selection before cut/paste to prevent blank layer bug
// v1.6 - Fix: normalize frame selection to animStartFrame before cut/paste loop
// v1.7 - Revert v1.6: multi-layer setSelectedFrames caused cutFrames to cut all layers at once
// Panel 1.6.0 - Change Movement (tf* functions at the end of this file)
// Panel 1.7.0 - Animate 2021 and newer
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

// --- Usage for zeploy: one "apply" or "undo" per completed operation, one
// "movement" per Change Movement (step 1), and an error when one fails unexpectedly. Validation messages ("select at
// least 2 layers") are not counted. Keep the version in step with
// CSXS/manifest.xml (npm run package checks it).
var delayerzUsage = zeployUsageV1("com.zeus.delayerz", "1.7.0");

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

// ============================================================
// Change Movement (from the Temp Feature prototype)
// Character1 to character2 at the playhead, with a transition copy over the
// N frames before it. One panel button runs the three steps:
//
// tfPickSymbol()                         selected symbol for the Target
// tfCreateTransition(target, n, loop)    step 1: copy, swaps, layers; line-up view
// tfContinueTransition()                 step 2: ghost, enter the copy for the re-pose
// tfFinishTransition()                   step 3: leave the copy, delete the ghost
// tfClearGhost()                         delete the TF_GHOST guide layer(s)
// tfHasGhost()                           "1" when a ghost layer exists
// tfPanelState()                         ghost flag + pending step 2 flag, e.g. "01"
//
// Frame numbers are 0-based in JSFL and 1-based in every message.
// ============================================================

// --- HELPER: last part of a library path ("Movements/run" -> "run") ---
function tfShortName(path) {
    var parts = String(path).split("/");
    return parts[parts.length - 1];
}

// --- HELPER: folder part of a library path ("Movements/run" -> "Movements/") ---
function tfFolderOf(path) {
    var i = String(path).lastIndexOf("/");
    return i === -1 ? "" : path.substring(0, i + 1);
}

// --- HELPER: library item by full path, or null ---
function tfFindItem(lib, path) {
    var items = lib.items;
    for (var i = 0; i < items.length; i++) {
        if (items[i].name === path) return items[i];
    }
    return null;
}

// --- HELPER: is frame f a keyframe on this layer ---
function tfIsKeyframe(layer, f) {
    return f < layer.frameCount && layer.frames[f].startFrame === f;
}

// --- HELPER: same element, found again by symbol and position ---
// JSFL hands out new wrapper objects, so === between two reads is unreliable.
function tfSameElement(a, b) {
    return a.elementType === b.elementType &&
        a.libraryItem && b.libraryItem &&
        a.libraryItem.name === b.libraryItem.name &&
        Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

// --- HELPER: layer index and element index of the selected element at frame f ---
function tfLocate(tl, el, f) {
    // Element.layer exists in recent Animate versions; check it first.
    var preferred = -1;
    try {
        for (var p = 0; p < tl.layerCount; p++) {
            if (el.layer && tl.layers[p].name === el.layer.name) { preferred = p; break; }
        }
    } catch (e) { }

    var order = [];
    if (preferred !== -1) order.push(preferred);
    for (var li = 0; li < tl.layerCount; li++) if (li !== preferred) order.push(li);

    for (var o = 0; o < order.length; o++) {
        var layer = tl.layers[order[o]];
        if (f >= layer.frameCount) continue;
        var els = layer.frames[f].elements;
        for (var k = 0; k < els.length; k++) {
            if (tfSameElement(els[k], el)) return { layer: order[o], index: k };
        }
    }
    return null;
}

// --- HELPER: inner frame a graphic instance shows, `offset` frames after its keyframe ---
// Unverified for "lastFrame" ranges: the loop is taken over the whole symbol.
function tfInnerFrame(firstFrame, loop, offset, length) {
    if (length < 1) return 0;
    switch (loop) {
        case "single frame":
            return firstFrame;
        case "play once":
            return Math.min(firstFrame + offset, length - 1);
        case "play once reverse":
            return Math.max(firstFrame - offset, 0);
        case "loop reverse":
            return (((firstFrame - offset) % length) + length) % length;
        default: // "loop"
            return (firstFrame + offset) % length;
    }
}

// --- HELPER: unique "<name>_COPY", "<name>_COPY2", ... inside the same folder ---
function tfUniqueCopyName(lib, path) {
    var folder = tfFolderOf(path);
    var base = tfShortName(path) + "_COPY";
    var name = base;
    var n = 2;
    while (lib.itemExists(folder + name)) {
        name = base + n;
        n++;
    }
    return name;
}

// --- HELPER: make layer idx current, so frame commands act on it alone ---
function tfUseLayer(tl, idx) {
    tl.setSelectedLayers(idx, true);
    tl.currentLayer = idx;
}

// --- HELPER: Distribute to Layers on the selected element, return the new layer ---
// Animate adds the layer right below the current one, named after the symbol,
// and leaves a blank keyframe where the element was.
function tfDistribute(dom, tl, layerName) {
    var before = tl.currentLayer;
    dom.distributeToLayers();
    if (tl.layers[tl.currentLayer].name === layerName) return tl.currentLayer;
    for (var i = before + 1; i < tl.layerCount; i++) {
        if (tl.layers[i].name === layerName) return i;
    }
    return before + 1;
}

// --- Ghost: character2's first pose on a guide layer, shown while re-posing ---
var TF_GHOST_NAME = "TF_GHOST";
var TF_GHOST_ALPHA = 30;
var TF_GHOST_RED = 0xFF0000;
var TF_GHOST_TINT = 50;

// --- HELPER: delete every ghost layer of a timeline, return how many ---
function tfRemoveGhostLayers(tl) {
    var removed = 0;
    for (var i = tl.layerCount - 1; i >= 0; i--) {
        if (tl.layers[i].name === TF_GHOST_NAME && tl.layers[i].layerType === "guide") {
            tl.layers[i].locked = false;
            tl.deleteLayer(i);
            removed++;
        }
    }
    return removed;
}

// --- HELPER: P of the transition under a ghost layer, or -1 ---
// The ghost sits on End - 1, directly above the copy layer. P is the first
// keyframe of the copy's run there (in a tween the copy has keyframes at P
// and End - 1).
function tfGhostTransitionStart(tl) {
    for (var i = 0; i < tl.layerCount - 1; i++) {
        var g = tl.layers[i];
        if (g.name !== TF_GHOST_NAME || g.layerType !== "guide") continue;
        for (var f = 0; f < g.frameCount; f++) {
            if (g.frames[f].startFrame !== f || !g.frames[f].elements.length) continue;
            var copy = tl.layers[i + 1];
            if (f >= copy.frameCount || !copy.frames[f].elements.length) return -1;
            var start = copy.frames[f].startFrame;
            var name = tfItemNameAt(copy, start);
            while (start > 0 && name && tfItemNameAt(copy, start - 1) === name) start = copy.frames[start - 1].startFrame;
            return start;
        }
    }
    return -1;
}

// --- HELPER: library name of the one instance at frame f of a layer, or "" ---
function tfItemNameAt(layer, f) {
    var els = layer.frames[f].elements;
    return els.length === 1 && els[0].libraryItem ? els[0].libraryItem.name : "";
}

// --- HELPER: guide layer above layer li with character2 on frame f, faded ---
// Copies the matrix and first frame of `source` (character2 at P + N, as the
// animator lined it up), so the ghost shows exactly where and how character2
// starts. Returns the ghost layer index.
function tfAddGhost(dom, tl, li, f, targetName, source) {
    var sourceFirst = source.firstFrame;
    tl.setSelectedLayers(li, true);
    tl.currentLayer = li;
    var g = tl.addNewLayer(TF_GHOST_NAME, "guide", true);
    var ghost = tl.layers[g];

    // One blank keyframe span holding only frame f (one call for f and f + 1)
    if (ghost.frameCount <= f) tl.insertFrames(f - ghost.frameCount + 1, false, ghost.frameCount - 1);
    tl.convertToBlankKeyframes(f, Math.min(f + 2, tl.layers[g].frameCount));

    tl.currentLayer = g;
    tl.currentFrame = f;
    dom.selectNone();
    dom.library.addItemToDocument({ x: source.x, y: source.y }, targetName);
    var el = tl.layers[g].frames[f].elements[0];
    el.matrix = source.matrix;
    el.firstFrame = sourceFirst;
    el.loop = "single frame";
    // Faded red: Advanced color keeps the alpha and adds a 50% red tint.
    // Set directly (no selection, ~0 ms); the selection route is a fallback
    // in case Animate ignores the direct write.
    tfTintRed(el);
    if (tl.layers[g].frames[f].elements[0].colorMode !== "advanced") {
        dom.selectNone();
        dom.selection = [tl.layers[g].frames[f].elements[0]];
        dom.setInstanceAlpha(TF_GHOST_ALPHA);
        tfTintRed(dom.selection[0]);
        if (dom.selection[0].colorMode !== "advanced") dom.setInstanceTint(TF_GHOST_RED, TF_GHOST_TINT);
        dom.selectNone();
    }

    // Wireframe in red: outline view uses the layer color
    tl.layers[g].color = "#FF0000";
    tl.layers[g].outline = true;
    tl.layers[g].locked = true;
    return g;
}

// --- HELPER: Advanced color effect, alpha TF_GHOST_ALPHA plus a red tint ---
function tfTintRed(el) {
    var keep = (100 - TF_GHOST_TINT);
    el.colorMode = "advanced";
    el.colorAlphaPercent = TF_GHOST_ALPHA;
    el.colorAlphaAmount = 0;
    el.colorRedPercent = keep;
    el.colorGreenPercent = keep;
    el.colorBluePercent = keep;
    el.colorRedAmount = Math.round(255 * TF_GHOST_TINT / 100);
    el.colorGreenAmount = 0;
    el.colorBlueAmount = 0;
}

// --- HELPER: select one element at frame f of layer li, return the selection ---
// Moving the playhead redraws the stage (the slow part of a swap), so it
// only moves when it has to.
function tfSelectElement(dom, tl, li, f, index) {
    if (tl.currentLayer !== li) tfUseLayer(tl, li);
    if (tl.currentFrame !== f) tl.currentFrame = f;
    dom.selectNone();
    dom.selection = [tl.layers[li].frames[f].elements[index]];
    return dom.selection;
}

// --- HELPER: swap an instance's symbol without selecting it ---
// Same result as swapElement (transform kept), but no playhead move or selection.
function tfSwap(el, item, firstFrame, loop) {
    el.libraryItem = item;
    el.firstFrame = firstFrame;
    el.loop = loop;
}

/**
 * Library path of the selected Graphic symbol: one instance on stage first,
 * otherwise one item selected in the Library panel.
 * @returns {string} - "OK: <path>" or "ERROR: ..."
 */
function tfPickSymbol() {
    var dom = fl.getDocumentDOM();
    if (!dom) return "ERROR: No document open.";

    var sel = dom.selection;
    if (sel.length === 1 && sel[0].elementType === "instance" && sel[0].instanceType === "symbol") {
        if (sel[0].symbolType !== "graphic") return "ERROR: The selected symbol is a " + sel[0].symbolType + ", not a Graphic.";
        return "OK: " + sel[0].libraryItem.name;
    }
    if (sel.length > 1) return "ERROR: Select one symbol instance to pick (selected: " + sel.length + ").";

    var items = dom.library.getSelectedItems();
    if (items.length === 1) {
        if (items[0].itemType !== "graphic") return "ERROR: \"" + items[0].name + "\" is a " + items[0].itemType + ", not a Graphic symbol.";
        return "OK: " + items[0].name;
    }
    return "ERROR: Select one Graphic symbol on stage or in the Library, then Pick.";
}

/**
 * Create Transition, step 1: copy, swaps and layers, then the line-up view
 * (copy held one frame over character2, both as outlines). Continue does step 2.
 * @param {string} targetName  - library path of character2
 * @param {number} length      - transition length N in frames
 * @param {string} copyLoop    - "loop" | "play once" for the copy
 * @returns {string}           - "OK: ..." or "ERROR: ..."
 */
function tfCreateTransition(targetName, length, copyLoop) {
    var usageStart = new Date().getTime();
    try {
        var dom = fl.getDocumentDOM();
        if (!dom) return "ERROR: No document open.";
        var tl = dom.getTimeline();
        var lib = dom.library;
        var N = parseInt(length, 10);
        if (isNaN(N) || N < 1) return "ERROR: Length must be 1 frame or more.";
        if (copyLoop !== "play once") copyLoop = "loop";

        // --- 1. Validate the selection ---
        var sel = dom.selection;
        if (sel.length !== 1) return "ERROR: Select exactly one character instance (selected: " + sel.length + ").";
        var el = sel[0];
        if (el.elementType !== "instance" || el.instanceType !== "symbol") return "ERROR: The selection is not a symbol instance.";
        if (el.symbolType !== "graphic") return "ERROR: The selected symbol is a " + el.symbolType + ". Only Graphic symbols have frame control.";

        var target = tfFindItem(lib, targetName);
        if (!target) return "ERROR: Symbol \"" + targetName + "\" is not in the library.";
        if (target.itemType !== "graphic") return "ERROR: \"" + targetName + "\" is not a Graphic symbol.";

        // The playhead is where character2 starts; the transition runs the N frames before it.
        var End = tl.currentFrame;
        var P = End - N;
        if (P < 0) return "ERROR: The transition needs " + N + " frames before the playhead. Move the playhead to frame " + (N + 1) + " or later, or shorten the length.";

        // The old ghost goes first; deleting layers can drop the selection,
        // so the instance is found again from a snapshot.
        var snap = { elementType: el.elementType, libraryItem: { name: el.libraryItem.name }, x: el.x, y: el.y, layer: null };
        try { snap.layer = { name: el.layer.name }; } catch (e) { }
        if (tfRemoveGhostLayers(tl)) tl.currentFrame = End;
        el = snap;

        var loc = tfLocate(tl, el, End);
        if (!loc) return "ERROR: The selected instance is not on the frame under the playhead. Click the instance again at the playhead.";
        var li = loc.layer;
        var layer = tl.layers[li];
        if (layer.locked) return "ERROR: Layer \"" + layer.name + "\" is locked.";
        if (!layer.visible) return "ERROR: Layer \"" + layer.name + "\" is hidden.";

        var span = layer.frames[P];
        if (span.tweenType === "motion object" || layer.frames[End].tweenType === "motion object") {
            return "ERROR: The transition (" + (P + 1) + "-" + (End + 1) + ") is in a motion tween. Not supported yet.";
        }

        // --- Edge case: keyframes inside the transition (P and End may be keyframes) ---
        var blocked = [];
        for (var f = P + 1; f < End; f++) {
            if (tfIsKeyframe(layer, f)) blocked.push(f + 1);
        }
        if (blocked.length) {
            return "ERROR: Keyframe at frame " + blocked.join(", ") + " is inside the transition (" + (P + 1) + "-" + (End + 1) + "). Clear it or shorten the length.";
        }

        // --- character1 at P: the selected instance, or the one instance of P's span
        // when the animator keyed End ---
        var endKeyed = tfIsKeyframe(layer, End);
        var pIndex = loc.index;
        if (endKeyed) {
            var pEls = span.elements;
            if (pEls.length !== 1) return "ERROR: Frame " + (P + 1) + " on layer \"" + layer.name + "\" needs exactly one character instance (found: " + pEls.length + ").";
            pIndex = 0;
        }
        var pEl = span.elements[pIndex];
        if (!pEl || pEl.elementType !== "instance" || pEl.symbolType !== "graphic") {
            return "ERROR: No Graphic character instance at frame " + (P + 1) + " on layer \"" + layer.name + "\".";
        }
        var sourceItem = pEl.libraryItem;
        var sourceName = sourceItem.name;
        if (targetName === sourceName) return "ERROR: The target is the same symbol as the character at frame " + (P + 1) + ".";

        // Pose shown at P, computed before anything changes
        var symbolLength = sourceItem.timeline.frameCount;
        var innerAtP = tfInnerFrame(pEl.firstFrame, pEl.loop, P - span.startFrame, symbolLength);
        var innerAtEnd = tfInnerFrame(innerAtP, copyLoop, N - 1, symbolLength);
        var endSpan = layer.frames[End];
        var spanStop = endSpan.startFrame + endSpan.duration; // first frame after character1's span at End

        // --- Tween mode: character1 moves in a classic tween through P (or into P) ---
        // The copy then stays on character1's layer, so the tween keeps running
        // with the copy: keyframes at P and End - 1 (both take the copy) cut it
        // where the transition starts and ends. Distributing the copy would
        // leave a blank keyframe at P and break the tween before it.
        var tweenMode = span.tweenType === "motion" || (P > 0 && layer.frames[P - 1].tweenType === "motion");
        var lastCopy = End - 1; // last frame of the copy

        // --- 1. Keyframe at End (skipped when keyed), swap to character2 from its frame 1 ---
        tfUseLayer(tl, li);
        if (!endKeyed) tl.insertKeyframe(End);
        tfSwap(tl.layers[li].frames[End].elements[loc.index], target, 0, "loop");

        // --- 2. Keyframe at P (skipped when keyed); in a tween also at End - 1 ---
        if (span.startFrame !== P) {
            tl.insertKeyframe(P);
        }
        if (tweenMode && lastCopy > P) tl.insertKeyframe(lastCopy);

        // --- 3. Duplicate the symbol and swap the instance at P ---
        var copyName = tfUniqueCopyName(lib, sourceName);
        var copyPath = tfFolderOf(sourceName) + copyName;
        lib.selectNone();
        if (!lib.duplicateItem(sourceName)) return "ERROR: Could not duplicate \"" + sourceName + "\".";
        var dup = lib.getSelectedItems();
        if (dup.length !== 1) return "ERROR: Duplicate of \"" + sourceName + "\" not found in the library.";
        lib.selectItem(dup[0].name);
        if (!lib.renameItem(copyName)) return "ERROR: Could not rename \"" + dup[0].name + "\" to \"" + copyName + "\".";
        var copyItem = tfFindItem(lib, copyPath);
        tfSwap(tl.layers[li].frames[P].elements[pIndex], copyItem, innerAtP, copyLoop);
        if (tweenMode && lastCopy > P) tfSwap(tl.layers[li].frames[lastCopy].elements[pIndex], copyItem, innerAtEnd, copyLoop);

        // --- 4. Distribute to Layers (Ctrl+Shift+D): character2 first, then the copy ---
        // Each new layer goes right below character1's layer, so distributing
        // character2 first leaves the order character1, copy, character2.
        // End on character1's layer becomes blank.
        tfSelectElement(dom, tl, li, End, loc.index);
        var targetLi = tfDistribute(dom, tl, tfShortName(targetName));

        var copyLi = li;
        if (tweenMode) {
            // The copy's tween stops at End - 1; End is blank, so no tween runs into it
            tl.layers[li].frames[lastCopy].tweenType = "none";
            tl.layers[li].frames[End].tweenType = "none";
        } else {
            tfSelectElement(dom, tl, li, P, pIndex);
            copyLi = tfDistribute(dom, tl, copyName);
            if (copyLi <= targetLi) targetLi++;
        }
        // character2 stops where character1's span stopped, before any later keyframe of character1
        if (spanStop < tl.layers[targetLi].frameCount && !tfIsKeyframe(tl.layers[targetLi], spanStop)) {
            tfUseLayer(tl, targetLi);
            tl.insertBlankKeyframe(spanStop);
        }

        // character1's layer: one blank span from P (End's extra blank keyframe goes)
        if (!tweenMode && tfIsKeyframe(tl.layers[li], End) && tl.layers[li].frames[End].elements.length === 0) {
            tfUseLayer(tl, li);
            tl.clearKeyframes(End, End + 1);
        }

        // --- Edge case: copy layer ends before End ---
        var copyLayer = tl.layers[copyLi];
        if (End > copyLayer.frameCount - 1) {
            tfUseLayer(tl, copyLi);
            tl.insertFrames(End - (copyLayer.frameCount - 1), false, copyLayer.frameCount - 1);
        }

        // --- Line-up view: the copy stays one more frame, over character2 ---
        // The swap keeps the anchor point, but assets can sit differently
        // inside their symbols. Both layers show as outlines, so the animator
        // moves character2 until it matches the copy, then clicks Continue.
        tfUseLayer(tl, copyLi);
        if (tfIsKeyframe(tl.layers[copyLi], End)) tl.clearKeyframes(End, End + 1);
        var blankAfter = End + 1 < tl.layers[copyLi].frameCount && !tfIsKeyframe(tl.layers[copyLi], End + 1);
        if (blankAfter) tl.insertBlankKeyframe(End + 1);
        tl.layers[copyLi].outline = true;
        tl.layers[targetLi].outline = true;
        tfSelectElement(dom, tl, targetLi, End, 0);
        // Only character2 moves; the copy is the reference. Continue unlocks it.
        tl.layers[copyLi].locked = true;
        tfSavePending(dom, [tl.name, copyPath, targetName, End, innerAtEnd, blankAfter ? 1 : 0]);
        delayerzUsage.action("movement", new Date().getTime() - usageStart);

        var copyWhere = tweenMode ? "Copy " + copyName + " in the tween on layer " + tl.layers[copyLi].name : "Layer " + copyName;
        return "OK: Step 1 of 2. " + copyWhere + ": frames " + (P + 1) + "-" + End + " (" + copyLoop + ", from inner frame " + (innerAtP + 1) +
            "). Layer " + tfShortName(targetName) + ": from frame " + (End + 1) + ". Line up " + tfShortName(targetName) +
            " at frame " + (End + 1) + " with the copy (both shown as outlines): move it, and set its first frame in Properties > Looping if needed. Then click Continue.";
    } catch (e) {
        delayerzUsage.error("movement");
        return "ERROR: " + e;
    }
}

// --- Pending step 2, kept in the document so it survives a panel reload ---
// Fields: timeline name, copy path, character2 path, End, inner frame at End - 1,
// and 1 when step 1 added the blank keyframe at End + 1.
var TF_PENDING = "tfPendingTransition";

function tfSavePending(dom, fields) {
    if (dom.documentHasData(TF_PENDING)) dom.removeDataFromDocument(TF_PENDING);
    dom.addDataToDocument(TF_PENDING, "string", fields.join("\n"));
}

function tfReadPending(dom) {
    try {
        if (!dom.documentHasData(TF_PENDING)) return null;
        var p = String(dom.getDataFromDocument(TF_PENDING)).split("\n");
        if (p.length < 6) return null;
        return { timeline: p[0], copyPath: p[1], targetName: p[2], end: parseInt(p[3], 10),
            innerAtEnd: parseInt(p[4], 10), blankAfter: p[5] === "1" };
    } catch (e) {
        return null;
    }
}

function tfClearPending(dom) {
    try {
        if (dom.documentHasData(TF_PENDING)) dom.removeDataFromDocument(TF_PENDING);
    } catch (e) { }
}

// --- HELPER: copy layer and character2 layer of the pending transition, or null ---
// Found by what sits at End: the copy (held one extra frame) and character2's keyframe.
// Other layers can hold character2 at End too (the animator's own layer of it),
// so character2's layer is the nearest match below the copy, where step 1 put it.
function tfFindPendingLayers(tl, pend) {
    var copyLi = -1;
    var targets = [];
    for (var i = 0; i < tl.layerCount; i++) {
        var layer = tl.layers[i];
        if (pend.end >= layer.frameCount) continue;
        var els = layer.frames[pend.end].elements;
        if (els.length !== 1 || els[0].elementType !== "instance" || !els[0].libraryItem) continue;
        var name = els[0].libraryItem.name;
        if (name === pend.copyPath && copyLi === -1) copyLi = i;
        else if (name === pend.targetName && tfIsKeyframe(layer, pend.end)) targets.push(i);
    }
    if (copyLi === -1 || !targets.length) return null;
    var targetLi = targets[0];
    for (var t = 0; t < targets.length; t++) {
        if (targets[t] > copyLi) { targetLi = targets[t]; break; }
    }
    return { copy: copyLi, target: targetLi };
}

/**
 * Create Transition, step 2 (after the line-up): the copy ends at End - 1
 * again, the ghost goes on, and the copy opens for the re-pose.
 * @returns {string} - "OK: ..." or "ERROR: ..."
 */
function tfContinueTransition() {
    try {
        var dom = fl.getDocumentDOM();
        if (!dom) return "ERROR: No document open.";
        var pend = tfReadPending(dom);
        if (!pend) return "ERROR: Nothing to continue. Click Change Movement first.";
        var tl = dom.getTimeline();
        if (tl.name !== pend.timeline) return "ERROR: Go back to the timeline \"" + pend.timeline + "\" to continue.";
        var found = tfFindPendingLayers(tl, pend);
        if (!found) {
            tfClearPending(dom);
            return "ERROR: The transition layers are not at frame " + (pend.end + 1) + " any more. Click Change Movement to start again.";
        }

        var End = pend.end;
        var copyLi = found.copy;
        var targetName = pend.targetName;
        var copyName = tfShortName(pend.copyPath);
        var innerAtEnd = pend.innerAtEnd;
        // Step 1 locked the copy (and the animator may lock character2); these frame edits need them unlocked.
        tl.layers[copyLi].locked = false;
        tl.layers[found.target].locked = false;

        // --- Copy back to frames P..End-1: End is blank again ---
        tfUseLayer(tl, copyLi);
        if (pend.blankAfter && tfIsKeyframe(tl.layers[copyLi], End + 1)) tl.clearKeyframes(End + 1, End + 2);
        tl.insertBlankKeyframe(End);
        tl.layers[copyLi].outline = false;
        tl.layers[found.target].outline = false;
        tfClearPending(dom);

        // --- Hand over for the re-pose ---
        // Ghost of character2 (where and on the first frame the animator chose)
        // one frame before it starts. Animate's scripting cannot switch the
        // real onion skin on, so this stands in for it.
        var targetEl = tl.layers[found.target].frames[End].elements[0];
        var targetFirst = targetEl.firstFrame;
        var ghostNote = " Ghost on layer " + TF_GHOST_NAME + ".";
        var layerCountBefore = tl.layerCount;
        try {
            tfAddGhost(dom, tl, copyLi, End - 1, targetName, targetEl);
        } catch (e) {
            ghostNote = " Ghost failed: " + e + ".";
            tfRemoveGhostLayers(tl);
        }
        // The ghost is added directly above the copy layer, which pushes it down one
        if (tl.layerCount > layerCountBefore) copyLi++;

        // Last frame of the copy, one frame before character2
        tfSelectElement(dom, tl, copyLi, End - 1, 0);

        // Edit the copy in place, on the inner frame shown at End - 1
        try {
            dom.enterEditMode("inPlace");
        } catch (e) {
            return "OK: Step 2 of 2. Could not enter " + copyName + ": " + e + ". Re-pose inner frame " + (innerAtEnd + 1) + " to match " +
                tfShortName(targetName) + " frame " + (targetFirst + 1) + "." + ghostNote;
        }
        dom.getTimeline().currentFrame = innerAtEnd;

        // The animator re-poses the bones
        return "OK: Step 2 of 2. Now inside " + copyName + ", frame " + (innerAtEnd + 1) + ": re-pose to match the ghost of " +
            tfShortName(targetName) + " frame " + (targetFirst + 1) + "." + ghostNote;
    } catch (e) {
        delayerzUsage.error("movement");
        return "ERROR: " + e;
    }
}

/**
 * Panel state: ghost flag, then pending step 2 flag ("10" = ghost, no step 2).
 * A pending step 2 whose layers are gone from its timeline (undo) is dropped.
 * @returns {string}
 */
function tfPanelState() {
    var dom = fl.getDocumentDOM();
    if (!dom) return "00";
    var pending = "0";
    var pend = tfReadPending(dom);
    if (pend) {
        var tl = dom.getTimeline();
        if (tl.name !== pend.timeline || tfFindPendingLayers(tl, pend)) pending = "1";
        else tfClearPending(dom);
    }
    return tfHasGhost() + pending;
}

/**
 * Delete the ghost layers in every scene and in the timeline being edited.
 * @returns {string} - "OK: ..." or "ERROR: ..."
 */
function tfClearGhost() {
    try {
        var dom = fl.getDocumentDOM();
        if (!dom) return "ERROR: No document open.";
        var removed = 0;
        var timelines = [];
        for (var s = 0; s < dom.timelines.length; s++) timelines.push(dom.timelines[s]);
        timelines.push(dom.getTimeline());
        var at = "";
        for (var t = 0; t < timelines.length; t++) {
            var tl = timelines[t];
            // Deleting a layer sends the playhead to frame 1; it goes back to P instead
            var P = tfGhostTransitionStart(tl);
            var n = tfRemoveGhostLayers(tl);
            removed += n;
            if (n && P !== -1) {
                try {
                    tl.currentFrame = P;
                    at = " Playhead at frame " + (P + 1) + ".";
                } catch (e) { }
            }
        }
        return removed ? "OK: Ghost removed." + at : "INFO: No ghost layer found.";
    } catch (e) {
        return "ERROR: Could not remove the ghost: " + e + ". Exit the symbol and try again.";
    }
}

/**
 * Finish (after the re-pose): leave the copy, back to the timeline with the
 * ghost, then delete the ghost (the playhead goes to P).
 * @returns {string} - "OK: ..." or "ERROR: ..."
 */
function tfFinishTransition() {
    try {
        var dom = fl.getDocumentDOM();
        if (!dom) return "ERROR: No document open.";
        // Exit one level at a time until the ghost's timeline is open, or nothing changes
        for (var i = 0; i < 10 && !tfTimelineHasGhost(dom.getTimeline()); i++) {
            var before = dom.getTimeline().name;
            dom.exitEditMode();
            if (dom.getTimeline().name === before) break;
        }
        return tfClearGhost().replace("OK: Ghost removed.", "OK: Transition finished, ghost removed.");
    } catch (e) {
        delayerzUsage.error("movement");
        return "ERROR: " + e;
    }
}

// --- HELPER: does this timeline have a ghost layer ---
function tfTimelineHasGhost(tl) {
    for (var i = 0; i < tl.layerCount; i++) {
        if (tl.layers[i].name === TF_GHOST_NAME && tl.layers[i].layerType === "guide") return true;
    }
    return false;
}

/**
 * Whether a ghost layer exists in any scene or in the timeline being edited.
 * @returns {string} - "1" or "0"
 */
function tfHasGhost() {
    var dom = fl.getDocumentDOM();
    if (!dom) return "0";
    var timelines = [dom.getTimeline()];
    for (var s = 0; s < dom.timelines.length; s++) timelines.push(dom.timelines[s]);
    for (var t = 0; t < timelines.length; t++) {
        var tl = timelines[t];
        for (var i = 0; i < tl.layerCount; i++) {
            if (tl.layers[i].name === TF_GHOST_NAME && tl.layers[i].layerType === "guide") return "1";
        }
    }
    return "0";
}
