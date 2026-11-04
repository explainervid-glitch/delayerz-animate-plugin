// ============================================================
// DelayerZ - ExtendScript (JSX) Bridge for Adobe Animate
// Compatible with ExtendScript ES3
// v1.5 - Fix: clear stage selection before cut/paste to prevent blank layer bug
// v1.6 - Fix: normalize frame selection to animStartFrame before cut/paste loop
// v1.7 - Revert v1.6: multi-layer setSelectedFrames caused cutFrames to cut all layers at once
// Panel 1.6.0 - Change Movement (tf* functions at the end of this file)
// Panel 1.7.0 - Animate 2021 and newer
// Panel 1.7.1 - Change Movement keeps the copy in a classic tween; ghost follows the lined-up character2
// Panel 1.7.2 - Change Movement locks other layers during its steps; Cancel; "Done" button
// Panel 1.7.3 - Change Movement skips folder layers; panel state never shows an error dialog
// Panel 1.7.4 - Change Movement re-poses the copy on the playhead frame over the movement 2 outline; no ghost layer
// Panel 1.7.5 - Change Movement: Source and Target tiles with frame previews (emptied on Done); the Source is found at the playhead
// Panel 1.7.6 - Change Movement: Source and Target tiles side by side, no arrow
// Panel 1.8.0 - Swap tool (sw* functions at the end of this file); log button in the icon rail with an error dot
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
var delayerzUsage = zeployUsageV1("com.zeus.delayerz", "1.8.0");

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
// tfPickSymbol(slot)                     selected symbol for the Source or Target, with a thumbnail
// tfCreateTransition(target, n, loop)    step 1: copy, swaps, layers; line-up view
// tfContinueTransition()                 step 2: enter the copy on the playhead for the re-pose
// tfFinishTransition()                   step 3: leave the copy, take its extra frame off
// tfCancelTransition()                   undo step 1 (from a backup layer), or stop step 2
// tfPanelState()                         re-pose flag + line-up flag, e.g. "01"
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
// Bounds use frames.length: a folder with layers inside reports a frameCount
// but has no frames.
function tfIsKeyframe(layer, f) {
    return f < layer.frames.length && layer.frames[f].startFrame === f;
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
        if (f >= layer.frames.length) continue;
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

// --- Ghost guide layer of DelayerZ 1.7.3 and older; step 1 deletes any left over ---
var TF_GHOST_NAME = "TF_GHOST";

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

// --- HELPER: library name of the one instance at frame f of a layer, or "" ---
function tfItemNameAt(layer, f) {
    var els = layer.frames[f].elements;
    return els.length === 1 && els[0].libraryItem ? els[0].libraryItem.name : "";
}

// --- HELPER: P, the first frame of the copy's run through frame f ---
// In a tween the copy has keyframes at P and End - 1, so the run walks back
// over keyframes with the same symbol.
function tfCopyStart(layer, f) {
    var start = layer.frames[f].startFrame;
    var name = tfItemNameAt(layer, start);
    while (start > 0 && name && tfItemNameAt(layer, start - 1) === name) start = layer.frames[start - 1].startFrame;
    return start;
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

// --- HELPER: does this instance's symbol already run on its layer the frame before f ---
// That marks character1; character2 starts at the playhead.
function tfRunsBefore(tl, el, f) {
    if (f < 1) return false;
    var loc = tfLocate(tl, el, f);
    if (!loc) return false;
    var layer = tl.layers[loc.layer];
    return f - 1 < layer.frames.length && tfItemNameAt(layer, f - 1) === el.libraryItem.name;
}

// --- Thumbnails for the panel: PNGs in %LOCALAPPDATA%\Temp\DelayerZ ---
function tfThumbFolder() {
    var i = fl.configURI.toLowerCase().indexOf("/adobe/");
    return fl.configURI.substring(0, i) + "/Temp/DelayerZ/";
}

// --- HELPER: frame f (0-based) of a symbol as a PNG, return its file URL for the panel, or "" ---
// exportToPNGSequence writes <name>NNNN.png for frame f + 1 and the frame
// after; only the first stays. Thumbnails older than a week go (the panel
// moves the Target's thumbnail to the Source after Done, so the newest stay).
var TF_THUMB_DAYS = 7;

function tfThumb(item, f, slot) {
    try {
        var dir = tfThumbFolder();
        if (!FLfile.exists(dir)) FLfile.createFolder(dir);
        var now = new Date().getTime();
        var files = FLfile.listFolder(dir, "files");
        for (var k = 0; k < files.length; k++) {
            var made = parseInt(files[k].split("_")[1], 10); // <slot>_<ms>_NNNN.png
            if (!isNaN(made) && now - made > TF_THUMB_DAYS * 86400000) FLfile.remove(dir + files[k]);
        }
        var base = slot + "_" + now + "_";
        item.exportToPNGSequence(dir + base + ".png", f + 1, f + 1);
        var out = [];
        files = FLfile.listFolder(dir, "files");
        for (var m = 0; m < files.length; m++) {
            if (files[m].indexOf(base) === 0) out.push(files[m]);
        }
        if (!out.length) return "";
        out.sort();
        for (var r = 1; r < out.length; r++) FLfile.remove(dir + out[r]);
        // "file:///C|/..." is Animate's form; the panel's browser needs "file:///C:/..."
        return (dir + out[0]).replace("|", ":");
    } catch (e) {
        return "";
    }
}

// --- HELPER: inner frame an instance shows at the playhead ---
function tfShownFrame(tl, el) {
    var f = tl.currentFrame;
    var loc = tfLocate(tl, el, f);
    var offset = loc ? f - tl.layers[loc.layer].frames[f].startFrame : 0;
    return tfInnerFrame(el.firstFrame, el.loop, offset, el.libraryItem.timeline.frameCount);
}

// --- HELPER: one pick result line, "slot<TAB>path<TAB>thumbnail URL" ---
function tfPickLine(slot, item, f) {
    return slot + "\t" + item.name + "\t" + tfThumb(item, f, slot);
}

/**
 * Pick for the Source (character1) or Target (character2) slot: one instance
 * on stage first, otherwise one item selected in the Library. Two instances
 * on stage fill both slots: the one already running before the playhead is
 * the Source; otherwise Animate's selection order decides. Each pick comes
 * with a thumbnail of the frame it shows (frame 1 for a Library item).
 * @param {string} slot - "source" | "target"
 * @returns {string} - "OK: " + one line per slot ("slot\tpath\tthumbnail URL"), or "ERROR: ..."
 */
function tfPickSymbol(slot) {
    var dom = fl.getDocumentDOM();
    if (!dom) return "ERROR: No document open.";
    if (slot !== "source") slot = "target";
    var tl = dom.getTimeline();

    var sel = dom.selection;
    if (sel.length === 1 && sel[0].elementType === "instance" && sel[0].instanceType === "symbol") {
        if (sel[0].symbolType !== "graphic") return "ERROR: The selected symbol is a " + sel[0].symbolType + ", not a Graphic.";
        return "OK: " + tfPickLine(slot, sel[0].libraryItem, tfShownFrame(tl, sel[0]));
    }
    if (sel.length === 2) {
        for (var s = 0; s < 2; s++) {
            if (sel[s].elementType !== "instance" || sel[s].instanceType !== "symbol" || sel[s].symbolType !== "graphic") {
                return "ERROR: Select two Graphic symbol instances (Source and Target), or one.";
            }
        }
        var a = sel[0], b = sel[1];
        if (a.libraryItem.name === b.libraryItem.name) return "ERROR: Both selected instances are " + a.libraryItem.name + ". Select two different symbols.";
        if (tfRunsBefore(tl, b, tl.currentFrame) && !tfRunsBefore(tl, a, tl.currentFrame)) { a = sel[1]; b = sel[0]; }
        return "OK: " + tfPickLine("source", a.libraryItem, tfShownFrame(tl, a)) + "\n" + tfPickLine("target", b.libraryItem, tfShownFrame(tl, b));
    }
    if (sel.length > 2) return "ERROR: Select one symbol instance, or two (Source and Target). Selected: " + sel.length + ".";

    var items = dom.library.getSelectedItems();
    if (items.length === 1) {
        if (items[0].itemType !== "graphic") return "ERROR: \"" + items[0].name + "\" is a " + items[0].itemType + ", not a Graphic symbol.";
        return "OK: " + tfPickLine(slot, items[0], 0);
    }
    return "ERROR: Select one Graphic symbol on stage or in the Library, then Pick.";
}

// --- HELPER: instances of a symbol at frame f, on normal layers ---
function tfFindAtFrame(tl, name, f) {
    var hits = [];
    for (var i = 0; i < tl.layerCount; i++) {
        var layer = tl.layers[i];
        if (layer.layerType !== "normal" || f >= layer.frames.length) continue;
        var els = layer.frames[f].elements;
        for (var k = 0; k < els.length; k++) {
            if (els[k].elementType === "instance" && els[k].libraryItem && els[k].libraryItem.name === name) hits.push(els[k]);
        }
    }
    return hits;
}

/**
 * Create Transition, step 1: copy, swaps and layers, then the line-up view
 * (copy held one frame over character2, both as outlines). Continue does step 2.
 * @param {string} targetName  - library path of character2
 * @param {number} length      - transition length N in frames
 * @param {string} copyLoop    - "loop" | "play once" for the copy
 * @param {string} sourceName  - optional library path of character1 (the Source); without it the selected instance is character1
 * @returns {string}           - "OK: ..." or "ERROR: ..."
 */
function tfCreateTransition(targetName, length, copyLoop, sourceName) {
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
        // character1: with a Source, its selected instance, else its one instance
        // at the playhead; without, the one selected instance.
        var sel = dom.selection;
        var el = null;
        if (sourceName) {
            for (var s = 0; s < sel.length; s++) {
                if (sel[s].libraryItem && sel[s].libraryItem.name === sourceName) el = sel[s];
            }
            if (!el) {
                var hits = tfFindAtFrame(tl, sourceName, tl.currentFrame);
                if (!hits.length) return "ERROR: No " + tfShortName(sourceName) + " (Source) at frame " + (tl.currentFrame + 1) + ". Move the playhead onto it, or pick another Source.";
                if (hits.length > 1) return "ERROR: " + hits.length + " instances of " + tfShortName(sourceName) + " at frame " + (tl.currentFrame + 1) + ". Select the one to change.";
                el = hits[0];
            }
        } else {
            if (sel.length !== 1) return "ERROR: Select the character instance at the playhead, or pick a Source (selected: " + sel.length + ").";
            el = sel[0];
        }
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
        var stale = tfRemoveGhostLayers(tl);
        if (tfFindBackup(tl) !== -1) { tfRemoveBackup(tl); stale++; } // left by an earlier step 1 undone by hand
        if (stale) tl.currentFrame = End;
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

        // --- Backup for Cancel: character1's layer as it is now, hidden right above it ---
        // JSFL has no undo, so Cancel puts this layer back instead.
        var liType = layer.layerType;
        tfUseLayer(tl, li);
        tl.duplicateLayers();
        var backup = tl.layers[li]; // the duplicate goes above; character1's layer moves down one
        backup.name = TF_BACKUP_NAME;
        try { backup.layerType = "guide"; } catch (e) { } // guide layers never export
        backup.visible = false;
        backup.locked = true;
        li++;
        layer = tl.layers[li];

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
        // Every other layer is locked too, so only character2 can be picked on stage.
        tl.layers[copyLi].locked = true;
        var locked = tfLockOthers(tl, targetLi);
        tfSavePending(dom, [tl.name, copyPath, targetName, End, innerAtEnd, blankAfter ? 1 : 0, liType, locked]);
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

// --- Pending transition, kept in the document so it survives a panel reload ---
// Fields: timeline name, copy path, character2 path, End, inner frame at End - 1,
// 1 when step 1 added the blank keyframe at End + 1, character1's layer type,
// the layers step 1 locked ("index:name", tab separated), and the stage
// (1 = line-up, waiting for Continue; 2 = re-pose, waiting for Done).
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
            innerAtEnd: parseInt(p[4], 10), blankAfter: p[5] === "1",
            liType: p[6] || "normal", locked: p[7] || "", stage: p[8] === "2" ? 2 : 1 };
    } catch (e) {
        return null;
    }
}

// --- Step 1 locks: every layer but character2's, put back on Continue or Cancel ---
// Only layers that were unlocked get locked and listed, so the animator's own
// locks stay. Folders are skipped: locking one would lock character2's layer
// inside it too.
function tfLockOthers(tl, keep) {
    var list = [];
    for (var i = 0; i < tl.layerCount; i++) {
        var layer = tl.layers[i];
        if (i === keep || layer.locked || layer.layerType === "folder") continue;
        layer.locked = true;
        list.push(i + ":" + layer.name);
    }
    return list.join("\t");
}

// Unlock what tfLockOthers locked: same index and name first, else the first
// locked layer with that name (layers added above it shift the index).
function tfRestoreLocks(tl, list) {
    if (!list) return;
    var entries = list.split("\t");
    for (var n = 0; n < entries.length; n++) {
        var cut = entries[n].indexOf(":");
        var idx = parseInt(entries[n].substring(0, cut), 10);
        var name = entries[n].substring(cut + 1);
        if (idx < tl.layerCount && tl.layers[idx].name === name) {
            tl.layers[idx].locked = false;
            continue;
        }
        for (var i = 0; i < tl.layerCount; i++) {
            if (tl.layers[i].name === name && tl.layers[i].locked) { tl.layers[i].locked = false; break; }
        }
    }
}

// --- Backup of character1's layer (step 1), hidden guide layer right above it ---
var TF_BACKUP_NAME = "TF_BACKUP";

function tfFindBackup(tl) {
    for (var i = 0; i < tl.layerCount; i++) {
        if (tl.layers[i].name === TF_BACKUP_NAME && tl.layers[i].layerType === "guide") return i;
    }
    return -1;
}

function tfRemoveBackup(tl) {
    var b = tfFindBackup(tl);
    if (b === -1) return;
    tl.layers[b].locked = false;
    tl.deleteLayer(b);
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
        if (pend.end >= layer.frames.length) continue;
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
 * Create Transition, step 2 (after the line-up): the copy keeps its extra
 * frame over character2, character2 stays an outline, and the copy opens on
 * that frame (End) for the re-pose. Done takes the extra frame off.
 * @returns {string} - "OK: ..." or "ERROR: ..."
 */
function tfContinueTransition() {
    try {
        var dom = fl.getDocumentDOM();
        if (!dom) return "ERROR: No document open.";
        var pend = tfReadPending(dom);
        if (!pend) return "ERROR: Nothing to continue. Click Change Movement first.";
        if (pend.stage === 2) return "ERROR: The re-pose is already open. Click Done when the copy matches.";
        var tl = dom.getTimeline();
        if (tl.name !== pend.timeline) return "ERROR: Go back to the timeline \"" + pend.timeline + "\" to continue.";
        var found = tfFindPendingLayers(tl, pend);
        if (!found) {
            tfClearPending(dom);
            return "ERROR: The transition layers are not at frame " + (pend.end + 1) + " any more. Click Change Movement to start again.";
        }
        // Step 1's locks go, and so does the Cancel backup (Cancel in step 2 keeps the transition)
        tfRestoreLocks(tl, pend.locked);
        tfRemoveBackup(tl);
        found = tfFindPendingLayers(tl, pend);

        var End = pend.end;
        var copyLi = found.copy;
        var targetName = pend.targetName;
        var copyName = tfShortName(pend.copyPath);
        // Step 1 locked the copy; it opens for editing now
        tl.layers[copyLi].locked = false;

        // --- Re-pose view: the copy solid, character2 as an outline under it ---
        tl.layers[copyLi].outline = false;
        tl.layers[found.target].outline = true;
        tfSavePending(dom, [pend.timeline, pend.copyPath, targetName, End, pend.innerAtEnd, pend.blankAfter ? 1 : 0, pend.liType, "", 2]);

        // Inner frame the copy shows at End
        var key = tl.layers[copyLi].frames[End];
        var copyEl = key.elements[0];
        var inner = tfInnerFrame(copyEl.firstFrame, copyEl.loop, End - key.startFrame, copyEl.libraryItem.timeline.frameCount);
        var targetFirst = tl.layers[found.target].frames[End].elements[0].firstFrame;

        // Edit the copy in place on End, over character2
        tfSelectElement(dom, tl, copyLi, End, 0);
        try {
            dom.enterEditMode("inPlace");
        } catch (e) {
            return "OK: Step 2 of 2. Could not enter " + copyName + ": " + e + ". Re-pose inner frame " + (inner + 1) + " to match " +
                tfShortName(targetName) + " frame " + (targetFirst + 1) + ", then click Done.";
        }
        dom.getTimeline().currentFrame = inner;

        // The animator re-poses the bones
        return "OK: Step 2 of 2. Now inside " + copyName + " at frame " + (End + 1) + " (inner frame " + (inner + 1) + "): re-pose to match the outline of " +
            tfShortName(targetName) + " frame " + (targetFirst + 1) + ". Then click Done.";
    } catch (e) {
        delayerzUsage.error("movement");
        return "ERROR: " + e;
    }
}

/**
 * Panel state: re-pose flag (waiting for Done), then line-up flag (waiting
 * for Continue). "00" = nothing pending. A pending transition whose layers
 * are gone from its timeline (undo) is dropped.
 * @returns {string}
 */
function tfPanelState() {
    // Runs on every document and timeline change: it must never show Animate's error dialog
    try {
        var dom = fl.getDocumentDOM();
        if (!dom) return "00";
        var pend = tfReadPending(dom);
        if (!pend) return "00";
        // Inside the copy (re-pose) the open timeline is the copy's, so the layers are not checked there
        var tl = dom.getTimeline();
        if (tl.name !== pend.timeline || tfFindPendingLayers(tl, pend)) return pend.stage === 2 ? "10" : "01";
        tfClearPending(dom);
        return "00";
    } catch (e) {
        return "00";
    }
}

/**
 * Done (after the re-pose): leave the copy, take its extra frame over
 * character2 off (End is blank again), outlines off, playhead to P.
 * @returns {string} - "OK: ..." or "ERROR: ..."
 */
function tfFinishTransition() {
    try {
        var dom = fl.getDocumentDOM();
        if (!dom) return "ERROR: No document open.";
        var pend = tfReadPending(dom);
        if (!pend || pend.stage !== 2) return "INFO: No re-pose to finish.";
        // Exit one level at a time until the transition's timeline is open, or nothing changes
        for (var i = 0; i < 10 && dom.getTimeline().name !== pend.timeline; i++) {
            var before = dom.getTimeline().name;
            dom.exitEditMode();
            if (dom.getTimeline().name === before) break;
        }
        var tl = dom.getTimeline();
        if (tl.name !== pend.timeline) return "ERROR: Go back to the timeline \"" + pend.timeline + "\" to finish.";
        var found = tfFindPendingLayers(tl, pend);
        tfClearPending(dom);
        if (!found) return "ERROR: The transition layers are not at frame " + (pend.end + 1) + " any more. Nothing changed.";

        // --- Copy back to frames P..End-1: End is blank again ---
        var End = pend.end;
        var copyLi = found.copy;
        var copyLocked = tl.layers[copyLi].locked;
        tl.layers[copyLi].locked = false;
        tfUseLayer(tl, copyLi);
        if (pend.blankAfter && tfIsKeyframe(tl.layers[copyLi], End + 1)) tl.clearKeyframes(End + 1, End + 2);
        tl.insertBlankKeyframe(End);
        tl.layers[copyLi].outline = false;
        tl.layers[copyLi].locked = copyLocked;
        tl.layers[found.target].outline = false;

        var P = tfCopyStart(tl.layers[copyLi], End - 1);
        tl.currentFrame = P;
        return "OK: Transition finished. Playhead at frame " + (P + 1) + ".";
    } catch (e) {
        delayerzUsage.error("movement");
        return "ERROR: " + e;
    }
}

/**
 * Cancel. In step 1 (line-up): everything step 1 did goes, and character1's
 * layer comes back from the backup. In step 2 (re-pose): same as Done; the
 * transition stays.
 * @returns {string} - "OK: ...", "INFO: ..." or "ERROR: ..."
 */
function tfCancelTransition() {
    try {
        var dom = fl.getDocumentDOM();
        if (!dom) return "ERROR: No document open.";
        var pend = tfReadPending(dom);
        if (!pend) return "INFO: Nothing to cancel.";
        if (pend.stage === 2) return tfFinishTransition().replace("OK: Transition finished.", "OK: Re-pose stopped. The transition stays.");

        var tl = dom.getTimeline();
        if (tl.name !== pend.timeline) return "ERROR: Go back to the timeline \"" + pend.timeline + "\" to cancel.";
        var b = tfFindBackup(tl);
        var found = tfFindPendingLayers(tl, pend);
        if (b === -1 || !found || b + 1 >= tl.layerCount) {
            tfRestoreLocks(tl, pend.locked);
            tfClearPending(dom);
            return "ERROR: The step 1 layers changed, so they cannot be put back. Use Edit > Undo instead.";
        }

        // Unlock first: deleting layers below shifts the saved indices
        tfRestoreLocks(tl, pend.locked);

        // Delete character2's layer, the copy layer and character1's changed layer (right below the backup)
        var li = b + 1;
        var liName = tl.layers[li].name;
        var gone = [found.target, li];
        if (found.copy !== li) gone.push(found.copy);
        gone.sort(function (x, y) { return y - x; });
        for (var g = 0; g < gone.length; g++) {
            tl.layers[gone[g]].locked = false;
            tl.deleteLayer(gone[g]);
        }

        // The backup becomes character1's layer again
        var layer = tl.layers[b];
        layer.locked = false;
        try { layer.layerType = pend.liType; } catch (e) { }
        layer.visible = true;
        layer.name = liName;
        if (dom.library.itemExists(pend.copyPath)) dom.library.deleteItem(pend.copyPath);
        tfClearPending(dom);

        tfUseLayer(tl, b);
        tl.currentFrame = pend.end;
        return "OK: Change Movement cancelled. Layer " + liName + " is back as it was.";
    } catch (e) {
        delayerzUsage.error("movement");
        return "ERROR: " + e;
    }
}

// ============================================================
// SWAP: swap one part inside the Target character for a part of the Source
// ============================================================
// The panel lists the surface parts (the symbols right inside) of a Source
// and a Target character, head to toe. The animator picks one part in each
// list and clicks Swap: inside the Target, that part becomes the Source part,
// on every keyframe of its layer.
//
// swReadParts(path)                               parts of a character: the selected symbol, or `path`
// swSwapPart(target, li, layer, oldPath, newPath)  inside `target`, oldPath becomes newPath
// ============================================================

// --- HELPER: words of a symbol's own name ("BODY COMP/HAND L DEMO 01" -> HAND, L, DEMO, 01) ---
function swWords(path) {
    var raw = tfShortName(path).toUpperCase().split(/[\s_\-]+/);
    var words = [];
    for (var i = 0; i < raw.length; i++) if (raw[i]) words.push(raw[i]);
    return words;
}

var SW_SIDES = { L: "L", LEFT: "L", R: "R", RIGHT: "R" };

function swSide(words) {
    for (var i = 0; i < words.length; i++) if (SW_SIDES[words[i]]) return SW_SIDES[words[i]];
    return "";
}

// --- Head-to-toe order of the parts list, by the first word of the name (or folder) ---
// Arms and legs go left side first; unknown words after the body, then shadow and controllers.
var SW_ORDER = {
    HEAD: 10, HAIR: 11, FACE: 12, NECK: 20,
    CHEST: 30, BODY: 31, TORSO: 31, OUTFIT: 32,
    ARM: 40, UPPERARM: 40, SHOULDER: 40, FOREARM: 41, HAND: 42,
    HIP: 50, PELVIS: 50, SKIRT: 51,
    THIGH: 60, LEG: 60, CALF: 61, SHIN: 61, FOOT: 62,
    SHADOW: 90, MAIN: 95, CONTROLLER: 95
};
var SW_UNKNOWN = 80;

function swRank(path) {
    var words = swWords(path);
    var rank = SW_ORDER[words[0]];
    if (rank === undefined) {
        var folder = String(path).split("/");
        rank = folder.length > 1 ? SW_ORDER[folder[folder.length - 2].toUpperCase()] : undefined;
    }
    if (rank === undefined) return SW_UNKNOWN;
    // Right arm and leg after the whole left one
    if (rank >= 40 && rank < 70 && swSide(words) === "R") rank += 5;
    return rank;
}

/**
 * Parts of a character: per layer (guides and folders skipped), the symbols
 * on its first keyframe with content, head to toe.
 * @param {string} path - library path of the character; "" reads the selected instance (or the one Library item)
 * @returns {string} - "OK: <character path>", then one line per part
 *                     ("layer index\tlayer name\telement index\tpart path\thead-to-toe rank"), or "ERROR: ..."
 */
function swReadParts(path) {
    try {
        var dom = fl.getDocumentDOM();
        if (!dom) return "ERROR: No document open.";
        var item = null;
        if (path) {
            item = tfFindItem(dom.library, path);
            if (!item) return "ERROR: \"" + path + "\" is not in this document's library. Pick a character again.";
        } else {
            var sel = dom.selection;
            if (sel.length === 1 && sel[0].elementType === "instance" && sel[0].instanceType === "symbol") {
                item = sel[0].libraryItem;
            } else if (!sel.length) {
                var items = dom.library.getSelectedItems();
                if (items.length === 1 && items[0].timeline) item = items[0];
            }
            if (!item) return "ERROR: Select one character instance on stage (or its symbol in the Library), then Pick.";
        }

        var tl = item.timeline;
        var lines = ["OK: " + item.name];
        for (var li = 0; li < tl.layerCount; li++) {
            var layer = tl.layers[li];
            if (layer.layerType === "folder" || layer.layerType === "guide") continue;
            var parts = [];
            for (var f = 0; f < layer.frames.length; f = layer.frames[f].startFrame + layer.frames[f].duration) {
                var els = layer.frames[f].elements;
                if (!els.length) continue;
                for (var k = 0; k < els.length; k++) {
                    if (els[k].elementType === "instance" && els[k].libraryItem) {
                        parts.push({ k: k, name: els[k].libraryItem.name, rank: swRank(els[k].libraryItem.name) });
                    }
                }
                break;
            }
            parts.sort(function (x, y) { return x.rank - y.rank || x.k - y.k; });
            for (var p = 0; p < parts.length; p++) lines.push(li + "\t" + layer.name + "\t" + parts[p].k + "\t" + parts[p].name + "\t" + parts[p].rank);
        }
        if (lines.length === 1) return "ERROR: " + tfShortName(item.name) + " has no symbols inside.";
        return lines.join("\n");
    } catch (e) {
        return "ERROR: " + e;
    }
}

/**
 * Swap, inside the Target character, part `oldPath` for `newPath` on every
 * keyframe of its layer (by position and name, else the first layer with
 * that name). Only the symbol changes: first frame, looping, transform and
 * color stay.
 * @param {string} targetPath - library path of the Target character
 * @param {number} layerIndex - the part's layer position in the Target
 * @param {string} layerName  - that layer's name
 * @param {string} oldPath    - library path of the Target part to replace
 * @param {string} newPath    - library path of the Source part to put in
 * @returns {string} - "OK: ...", "INFO: ..." or "ERROR: ..."
 */
function swSwapPart(targetPath, layerIndex, layerName, oldPath, newPath) {
    var usageStart = new Date().getTime();
    try {
        var dom = fl.getDocumentDOM();
        if (!dom) return "ERROR: No document open.";
        var targetName = tfShortName(targetPath);
        if (oldPath === newPath) return "INFO: " + targetName + " already has " + tfShortName(newPath) + " there.";
        var target = tfFindItem(dom.library, targetPath);
        if (!target || !target.timeline) return "ERROR: \"" + targetPath + "\" is not in this document's library. Pick the Target again.";
        var part = tfFindItem(dom.library, newPath);
        if (!part) return "ERROR: \"" + newPath + "\" is not in this document's library. Pick the Source again.";

        var tl = target.timeline;
        layerIndex = parseInt(layerIndex, 10);
        var li = -1;
        if (layerIndex < tl.layerCount && tl.layers[layerIndex].name === layerName) li = layerIndex;
        for (var i = 0; li === -1 && i < tl.layerCount; i++) {
            if (tl.layers[i].name === layerName) li = i;
        }
        if (li === -1) return "ERROR: " + targetName + " has no layer \"" + layerName + "\" any more. Pick the Target again.";

        var layer = tl.layers[li];
        var swapped = 0;
        for (var f = 0; f < layer.frames.length; f = layer.frames[f].startFrame + layer.frames[f].duration) {
            var els = layer.frames[f].elements;
            for (var k = 0; k < els.length; k++) {
                if (els[k].elementType !== "instance" || !els[k].libraryItem || els[k].libraryItem.name !== oldPath) continue;
                els[k].libraryItem = part;
                swapped++;
            }
        }
        if (!swapped) return "ERROR: " + targetName + " has no " + tfShortName(oldPath) + " on layer \"" + layerName + "\" any more. Pick the Target again.";
        delayerzUsage.action("swap", new Date().getTime() - usageStart);
        return "OK: " + targetName + ": " + tfShortName(oldPath) + " swapped for " + tfShortName(newPath) +
            (swapped > 1 ? " on " + swapped + " keyframes." : ".");
    } catch (e) {
        delayerzUsage.error("swap");
        return "ERROR: " + e;
    }
}
