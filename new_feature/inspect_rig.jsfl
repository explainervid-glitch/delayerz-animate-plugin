// inspect_rig.jsfl  -  READ-ONLY probe for the "Create Transition" tool
// Usage: on the main timeline, move the playhead to a frame, select ONE character
// instance, then run via Commands > Run Command. Results appear in the Output panel.
// It enters the symbol to inspect it, then exits back. It changes nothing.

(function () {
    fl.outputPanel.clear();
    var dom = fl.getDocumentDOM();
    if (!dom) { fl.trace("No document open."); return; }

    function safe(fn, fallback) {
        try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
        catch (e) { return fallback; }
    }

    var tl = dom.getTimeline();
    fl.trace("=== MAIN TIMELINE ===");
    fl.trace("Timeline: " + tl.name + " | frameCount: " + tl.frameCount + " | playhead (0-based): " + tl.currentFrame);
    fl.trace("Layer count: " + tl.layerCount + " | current layer index: " + tl.currentLayer);

    var sel = dom.selection;
    fl.trace("Selection count: " + sel.length);
    if (sel.length !== 1) { fl.trace("Select exactly ONE instance and run again."); return; }

    var el = sel[0];
    fl.trace("elementType: " + el.elementType);
    if (el.elementType !== "instance") { fl.trace("Selected element is not a symbol instance."); return; }

    fl.trace("instanceType: " + el.instanceType);
    fl.trace("symbolType: " + safe(function () { return el.symbolType; }, "n/a"));
    fl.trace("libraryItem: " + el.libraryItem.name);
    fl.trace("firstFrame: " + safe(function () { return el.firstFrame; }, "n/a"));
    fl.trace("loop mode: " + safe(function () { return el.loop; }, "n/a"));
    fl.trace("position: " + el.x + ", " + el.y + " | scale: " + el.scaleX + ", " + el.scaleY + " | rotation: " + el.rotation);

    // Keyframe span info for the current layer at the playhead
    var layer = tl.layers[tl.currentLayer];
    var frame = layer.frames[tl.currentFrame];
    fl.trace("--- span on current layer ---");
    fl.trace("layer: " + layer.name + " | layerType: " + layer.layerType);
    fl.trace("span startFrame: " + frame.startFrame + " | duration: " + frame.duration + " | tweenType: " + frame.tweenType);

    // Enter the symbol and list its layers
    var itemName = el.libraryItem.name;
    dom.library.editItem(itemName);
    var inner = fl.getDocumentDOM().getTimeline();
    fl.trace("");
    fl.trace("=== INSIDE SYMBOL: " + itemName + " ===");
    fl.trace("frameCount: " + inner.frameCount + " | layerCount: " + inner.layerCount);

    for (var i = 0; i < inner.layerCount; i++) {
        var L = inner.layers[i];
        var kfs = [];
        for (var f = 0; f < L.frameCount; f++) {
            if (L.frames[f] && L.frames[f].startFrame === f) kfs.push(f);
        }
        var shown = kfs.length > 12 ? kfs.slice(0, 12).join(",") + ",... (" + kfs.length + " keyframes)" : kfs.join(",");
        fl.trace("[" + i + "] " + L.name + " | type: " + L.layerType + " | frames: " + L.frameCount + " | keyframes: " + shown);

        // Extra detail for anything that looks like a bone/armature layer
        var t = String(L.layerType).toLowerCase();
        if (t.indexOf("armature") !== -1 || t.indexOf("pose") !== -1) {
            var first = L.frames[0];
            fl.trace("     (armature-like layer) elements on frame 0: " + first.elements.length);
            for (var k = 0; k < first.elements.length; k++) {
                var e = first.elements[k];
                fl.trace("       element " + k + " type: " + e.elementType +
                    " | has armature property: " + safe(function () { return e.isArmature === true; }, "n/a"));
            }
        }
    }

    // Go back to the main timeline
    fl.getDocumentDOM().exitEditMode();
    fl.trace("");
    fl.trace("Done. Copy everything from the Output panel and send it to me.");
})();
