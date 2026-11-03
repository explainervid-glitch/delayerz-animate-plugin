// ============================================================
// DelayerZ.jsfl - Adobe Animate Command
// Compatible with ExtendScript ES3
// v2.1 - XML UI dialog (radio buttons), single file via FLfile temp
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

(function () {

    // --- Usage for zeploy: one "command" per completed run (not when the
    // dialog is cancelled or the selection is wrong). Same id as the panel,
    // so both count as DelayerZ. Keep the version in step with
    // CSXS/manifest.xml (npm run package checks it).
    var usage = zeployUsageV1("com.zeus.delayerz", "1.7.2");
    var usageStart; // set once the dialog is accepted, so it times the work only

    // --- HELPER: Array.indexOf replacement (not available in ES3) ---
    function arrContains(arr, val) {
        for (var x = 0; x < arr.length; x++) {
            if (arr[x] === val) return true;
        }
        return false;
    }

    // --- HELPER: drop folder and camera layers (no frames to move) ---
    function filterMovableLayers(indices) {
        var kept = [];
        for (var x = 0; x < indices.length; x++) {
            var type = tl.layers[indices[x]].layerType;
            if (type !== "folder" && type !== "camera") kept.push(indices[x]);
        }
        return kept;
    }

    // ============================================================
    // STEP 1: VALIDATE DOCUMENT
    // ============================================================

    var doc = fl.getDocumentDOM();
    if (!doc) {
        alert("DelayerZ Error: No document is open.");
        fl.trace("[DelayerZ] ERROR: No document is open.");
        return;
    }

    var tl = doc.getTimeline();

    // ============================================================
    // STEP 2: SAVE INITIAL FRAME POSITION
    // ============================================================

    var originalFramePos = tl.currentFrame;
    var animStartFrame = tl.currentFrame;

    // ============================================================
    // STEP 3: DETECT TARGET LAYERS (three-priority strategy)
    //
    // Priority 1 - tl.getSelectedFrames()
    //   Returns triplets [layerIdx, startFrame, endFrame, ...].
    //   Most explicit signal: user selected frames on specific layers.
    //
    // Priority 2 - doc.selection (stage objects) [DISABLED]
    //   Causes cutFrames() to misbehave; disabled until workaround found.
    //
    // Priority 3 - tl.layers[i].selected (layer header click)
    //   Fallback when neither of the above produced results.
    // ============================================================

    var targetLayers = [];
    var i, j;
    var selectedFrames = tl.getSelectedFrames();

    // --- Priority 1: frame ruler / timeline frame selection ---
    if (selectedFrames && selectedFrames.length >= 3) {
        for (i = 0; i < selectedFrames.length; i += 3) {
            var fLayerIdx = selectedFrames[i];
            if (!arrContains(targetLayers, fLayerIdx)) {
                targetLayers.push(fLayerIdx);
            }
        }
    }

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
    targetLayers = filterMovableLayers(targetLayers);

    if (targetLayers.length < 2) {
        alert("DelayerZ Error: Select at least 2 layers in the timeline before running this command.");
        fl.trace("[DelayerZ] ERROR: Fewer than 2 layers selected.");
        return;
    }

    // ============================================================
    // STEP 4: SHOW XML UI DIALOG
    //
    // Technique: write XML to a temp file in the Commands folder,
    // load it via fl.xmlPanel(), then immediately delete the temp file.
    // This keeps the distribution as a single .jsfl file.
    // ============================================================

    var xmlContent =
        '<dialog title="DelayerZ" buttons="accept,cancel">' +
        '<vbox>' +
        '<hbox>' +
        '<label value="Frame Delay:" />' +
        '<textbox id="delay" value="5" size="10" />' +
        '<label value="Frames" />' +
        '</hbox>' +
        '<separator />' +
        '<label value="Layer order:" />' +
        '<radiogroup id="mode">' +
        '<radio label="Bottom to Top" value="normal" selected="true" />' +
        '<radio label="Top to Bottom" value="inverted" />' +
        '<radio label="Randomize" value="random" />' +
        '</radiogroup>' +
        '</vbox>' +
        '</dialog>';

    var tmpURI = fl.configURI + "Commands/~delayerz_tmp_ui.xml";
    FLfile.write(tmpURI, xmlContent);
    var result = fl.xmlPanel(tmpURI);
    FLfile.remove(tmpURI);

    if (!result || result.dismiss !== "accept") {
        fl.trace("[DelayerZ] Cancelled.");
        return;
    }
    usageStart = new Date().getTime();

    // ============================================================
    // STEP 5: PARSE & VALIDATE DIALOG VALUES
    // ============================================================

    var absDelay = Math.abs(parseInt(result.delay, 10));
    if (isNaN(absDelay) || absDelay < 1) {
        alert("DelayerZ Error: Invalid delay value. Minimum is 1 frame.");
        fl.trace("[DelayerZ] ERROR: Invalid delay value \"" + result.delay + "\".");
        return;
    }

    var modeStr = result.mode;

    // Clear stage selection before cut/paste to prevent blank layer bug.
    // If elements are still selected on stage when cutFrames() is called,
    // Animate may route the operation to the object clipboard instead of
    // the frame clipboard -- causing pasteFrames() to paste nothing (blank).
    doc.selection = [];

    // ============================================================
    // STEP 6: DETERMINE LAYER ORDER
    // ============================================================

    var orderedLayers = [];
    for (i = 0; i < targetLayers.length; i++) {
        orderedLayers.push(targetLayers[i]);
    }

    // Bubble sort ascending (ES3 safe, no .sort() with comparator)
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

    if (modeStr === "normal") {
        // Reverse so the top layer (smallest index) delays last
        var reversed = [];
        for (i = orderedLayers.length - 1; i >= 0; i--) {
            reversed.push(orderedLayers[i]);
        }
        orderedLayers = reversed;
    } else if (modeStr === "random") {
        var rTemp;
        for (i = orderedLayers.length - 1; i > 0; i--) {
            j = Math.floor(Math.random() * (i + 1));
            rTemp = orderedLayers[i];
            orderedLayers[i] = orderedLayers[j];
            orderedLayers[j] = rTemp;
        }
    }
    // "inverted" -> ascending order is already correct

    // ============================================================
    // STEP 7: PLAN THE SHIFTS, CHECK THEM, THEN APPLY
    //
    // shifts[i] is how far orderedLayers[i] moves: 0 for the first layer
    // and for locked or hidden layers, which are left alone.
    // A layer that moves must have frames at or after the playhead.
    // Otherwise its cut range is empty, cutFrames() cuts nothing, and
    // pasteFrames() pastes the previous layer's frames from the clipboard.
    // Everything is checked before the first frame moves.
    // ============================================================

    var layerIdx, layer, shiftAmount, originalEnd;
    var shifts = [];

    for (i = 0; i < orderedLayers.length; i++) {
        layer = tl.layers[orderedLayers[i]];
        shifts.push(layer.locked || !layer.visible ? 0 : i * absDelay);

        if (shifts[i] > 0 && animStartFrame >= layer.frames.length) {
            alert("DelayerZ Error: \"" + layer.name + "\" has no frames at or after frame " +
                (animStartFrame + 1) + ". Move the playhead or deselect that layer.");
            fl.trace("[DelayerZ] ERROR: \"" + layer.name + "\" has no frames at or after the playhead.");
            return;
        }
    }

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

    // ============================================================
    // STEP 7b: CLEANUP - remove blank keyframe artifacts left by cutFrames
    //
    // Why clearKeyframes instead of removeFrames?
    // - removeFrames -> deletes the frame SLOT -> content shifts left -> stagger lost
    // - clearKeyframes -> removes only the KEYFRAME MARKER, slot remains
    //   -> the span from the previous frame fills the gap naturally
    //   -> stagger is preserved, blank keyframe artifact is gone
    //
    // EXCEPTION: if the animation starts at frame 1 (index 0), blank keyframes
    // at the start of the timeline are natural and harmless -- skip cleanup.
    // ============================================================

    if (animStartFrame > 0) {
        var f, fr;
        for (i = 0; i < orderedLayers.length; i++) {
            layerIdx = orderedLayers[i];
            layer = tl.layers[layerIdx];
            shiftAmount = shifts[i];

            if (shiftAmount === 0) continue;

            tl.currentLayer = layerIdx;

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

    // ============================================================
    // STEP 8: ALIGNMENT - equalize length of all target layers
    // ============================================================

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

    // ============================================================
    // STEP 9: RESTORE PLAYHEAD + REPORT
    // ============================================================

    tl.currentFrame = originalFramePos;

    fl.trace("[DelayerZ] OK: Stagger applied to " + targetLayers.length + " layers. Delay=" + absDelay + "fr, Mode=" + modeStr + ".");
    usage.action("command", new Date().getTime() - usageStart);

})(); // end IIFE
