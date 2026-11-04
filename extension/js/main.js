// ============================================================
// DelayerZ - Panel JavaScript (browser-side)
// ============================================================

(function () {
    "use strict";

    var cs = new CSInterface();

    // --- UI elements ---
    var applyBtn = document.getElementById("applyBtn");
    var undoBtn = document.getElementById("undoBtn");
    var delayInput = document.getElementById("delay");
    var logEl = document.getElementById("log");
    var logListEl = document.getElementById("logList");
    var logBtn = document.getElementById("logBtn");

    var DELAY_MIN = 1;
    var DELAY_MAX = 999;
    var LOG_MAX = 20;

    // --- Apply button handler ---
    applyBtn.addEventListener("click", function () {
        var delay = clampDelay();
        var mode = document.querySelector('input[name="mode"]:checked').value;

        setButtons(true);

        cs.evalScript('applyDelayerZ(' + delay + ', "' + mode + '")', function (result) {
            setButtons(false);
            handleResult(result);
            refreshUndo();
        });
    });

    // --- Undo button handler ---
    undoBtn.addEventListener("click", function () {
        setButtons(true);

        cs.evalScript('undoDelayerZ()', function (result) {
            setButtons(false);
            handleResult(result);
            refreshUndo();
        });
    });

    // --- Undo button follows the undo state kept in the JSX ---
    // A refused Undo (other document, locked layer) keeps that state, and so
    // does a rejected Apply, so the button cannot just be toggled here.
    function refreshUndo() {
        cs.evalScript('canUndoDelayerZ()', function (result) {
            undoBtn.disabled = result !== "1";
        });
    }

    refreshUndo();

    // --- Delay: stepper buttons, typing, and drag left/right ---
    function setDelay(value) {
        delayInput.value = Math.min(DELAY_MAX, Math.max(DELAY_MIN, value));
    }

    // Reads the field, falls back to 1 when it is empty or not a number,
    // and keeps it within 1..999.
    function clampDelay() {
        var value = parseInt(delayInput.value, 10);
        setDelay(isNaN(value) ? DELAY_MIN : value);
        return parseInt(delayInput.value, 10);
    }

    document.getElementById("delayDown").addEventListener("click", function () {
        setDelay(clampDelay() - 1);
    });
    document.getElementById("delayUp").addEventListener("click", function () {
        setDelay(clampDelay() + 1);
    });

    // Drag on the number: 1 frame per 4 px. A click without dragging
    // switches to typing; while typing, the mouse selects text as usual.
    var PX_PER_FRAME = 4;
    var drag = null;

    delayInput.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 || document.activeElement === delayInput) return;
        e.preventDefault();
        drag = { x: e.clientX, start: clampDelay(), moved: false };
        delayInput.setPointerCapture(e.pointerId);
    });

    delayInput.addEventListener("pointermove", function (e) {
        if (!drag) return;
        var dx = e.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) < 3) return;
        if (!drag.moved) {
            drag.moved = true;
            delayInput.classList.add("scrubbing");
            document.body.classList.add("scrubbing");
        }
        setDelay(drag.start + Math.round(dx / PX_PER_FRAME));
    });

    function endDrag() {
        if (!drag) return;
        var moved = drag.moved;
        drag = null;
        delayInput.classList.remove("scrubbing");
        document.body.classList.remove("scrubbing");
        if (!moved) {
            delayInput.focus();
            delayInput.select();
        }
    }

    delayInput.addEventListener("pointerup", endDrag);
    delayInput.addEventListener("pointercancel", endDrag);
    delayInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") delayInput.blur();
    });
    delayInput.addEventListener("blur", clampDelay);

    // ============================================================
    // Tools: Delay | Movement | Swap, picked from the icon rail on the left.
    // The last tool used opens next time.
    // ============================================================
    var TAB_KEY = "delayerz.tab";
    var tabs = {
        delay: { btn: document.getElementById("tabDelayBtn"), panel: document.getElementById("tabDelay") },
        movement: { btn: document.getElementById("tabMovementBtn"), panel: document.getElementById("tabMovement") },
        swap: { btn: document.getElementById("tabSwapBtn"), panel: document.getElementById("tabSwap") }
    };

    function showTab(name) {
        for (var key in tabs) {
            var on = key === name;
            tabs[key].btn.setAttribute("aria-selected", on ? "true" : "false");
            tabs[key].panel.hidden = !on;
        }
        try {
            localStorage.setItem(TAB_KEY, name);
        } catch (e) {
            // Not saved; the panel keeps working.
        }
    }

    tabs.delay.btn.addEventListener("click", function () { showTab("delay"); });
    tabs.movement.btn.addEventListener("click", function () { showTab("movement"); });
    tabs.swap.btn.addEventListener("click", function () { showTab("swap"); });

    try {
        var lastTab = localStorage.getItem(TAB_KEY);
        if (lastTab === "movement" || lastTab === "swap") showTab(lastTab);
    } catch (e) { }

    // ============================================================
    // Movement: character1 (Source) to character2 (Target)
    // ============================================================
    // name: full library path ("" = not picked); thumb: file URL of the frame preview
    var slots = {
        source: { name: "", thumb: "", btn: document.getElementById("sourcePick"), label: document.getElementById("sourceName") },
        target: { name: "", thumb: "", btn: document.getElementById("targetPick"), label: document.getElementById("targetName") }
    };
    var lengthInput = document.getElementById("length");
    var lengthCell = document.getElementById("lengthCell");
    var movementBtn = document.getElementById("movementBtn");
    var cancelBtn = document.getElementById("cancelBtn");

    var LENGTH_MIN = 1;
    var LENGTH_MAX = 999;
    var MOVEMENT_KEY = "delayerz.movement";

    // A preview that cannot load (file cleaned up) falls back to the pipette
    ["source", "target"].forEach(function (slot) {
        slots[slot].btn.querySelector("img").addEventListener("error", function () {
            setSlot(slot, slots[slot].name, "");
        });
    });

    // --- Remembered length, Source and Target (per PC; the panel works without them) ---
    // 1.7.5 kept plain names; they come back without a preview.
    var movementSettings = loadMovementSettings();
    if (movementSettings.length) lengthInput.value = movementSettings.length;
    ["source", "target"].forEach(function (slot) {
        var saved = movementSettings[slot];
        if (typeof saved === "string" && saved) setSlot(slot, saved, "");
        else if (saved && saved.name) setSlot(slot, saved.name, saved.thumb);
    });

    function loadMovementSettings() {
        try {
            return JSON.parse(localStorage.getItem(MOVEMENT_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function saveMovementSettings() {
        try {
            localStorage.setItem(MOVEMENT_KEY, JSON.stringify({
                length: clampLength(),
                source: { name: slots.source.name, thumb: slots.source.thumb },
                target: { name: slots.target.name, thumb: slots.target.thumb }
            }));
        } catch (e) {
            // Not saved; the panel keeps working.
        }
    }

    // --- Tiles: the frame preview (or the pipette) and the symbol name under it ---
    // Hovering the name shows the full library path.
    function setSlot(slot, name, thumb) {
        var s = slots[slot];
        s.name = name || "";
        s.thumb = s.name ? thumb || "" : "";
        var img = s.btn.querySelector("img");
        var icon = s.btn.querySelector("svg");
        if (s.thumb) img.src = s.thumb;
        else img.removeAttribute("src");
        img.hidden = !s.thumb;
        icon.style.display = s.thumb ? "none" : ""; // an <svg> has no hidden property
        s.btn.classList.toggle("has-thumb", !!s.thumb);
        s.label.textContent = s.name ? s.name.split("/").pop() : "none";
        s.label.classList.toggle("slot-none", !s.name);
        if (s.name) s.label.title = s.name;
        else s.label.removeAttribute("title");
    }

    function logSlots() {
        addLog("Source: " + (slots.source.name || "the selected instance") + " → Target: " + (slots.target.name || "none"), "info");
    }

    // One line per picked slot: "slot<TAB>path<TAB>preview URL"
    function pick(slot) {
        cs.evalScript("tfPickSymbol(" + quote(slot) + ")", function (result) {
            if (result && result.indexOf("OK: ") === 0) {
                result.substring(4).split("\n").forEach(function (line) {
                    var f = line.split("\t");
                    if (slots[f[0]]) setSlot(f[0], f[1], f[2]);
                });
                saveMovementSettings();
                logSlots();
            } else {
                handleResult(result);
            }
        });
    }

    slots.source.btn.addEventListener("click", function () { pick("source"); });
    slots.target.btn.addEventListener("click", function () { pick("target"); });

    // After Done both tiles empty, ready for the next change
    function clearSlots() {
        setSlot("source", "", "");
        setSlot("target", "", "");
        saveMovementSettings();
    }

    // --- Length: typing, and drag left/right like the delay ---
    function clampLength() {
        var value = parseInt(lengthInput.value, 10);
        if (isNaN(value)) value = 30;
        value = Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, value));
        lengthInput.value = value;
        return value;
    }

    var lengthDrag = null;

    lengthCell.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 || document.activeElement === lengthInput || lengthInput.disabled) return;
        e.preventDefault();
        lengthDrag = { x: e.clientX, start: clampLength(), moved: false };
        lengthCell.setPointerCapture(e.pointerId);
    });

    lengthCell.addEventListener("pointermove", function (e) {
        if (!lengthDrag) return;
        var dx = e.clientX - lengthDrag.x;
        if (!lengthDrag.moved && Math.abs(dx) < 3) return;
        if (!lengthDrag.moved) {
            lengthDrag.moved = true;
            lengthCell.classList.add("scrubbing");
            document.body.classList.add("scrubbing");
        }
        lengthInput.value = lengthDrag.start + Math.round(dx / PX_PER_FRAME);
        clampLength();
    });

    function endLengthDrag() {
        if (!lengthDrag) return;
        var moved = lengthDrag.moved;
        lengthDrag = null;
        lengthCell.classList.remove("scrubbing");
        document.body.classList.remove("scrubbing");
        if (moved) {
            saveMovementSettings();
        } else {
            lengthInput.focus();
            lengthInput.select();
        }
    }

    lengthCell.addEventListener("pointerup", endLengthDrag);
    lengthCell.addEventListener("pointercancel", endLengthDrag);
    // The label would also forward its click to the input; typing starts in endLengthDrag.
    lengthCell.addEventListener("click", function (e) {
        if (e.target !== lengthInput) e.preventDefault();
    });
    lengthInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") lengthInput.blur();
    });
    lengthInput.addEventListener("blur", function () {
        clampLength();
        saveMovementSettings();
    });

    // --- One button, three steps ---
    // Change Movement (step 1), Continue (step 2, after lining up character2),
    // Done (after the re-pose of the copy on the playhead frame).
    // The copy loops; play once may come back later.
    var STEPS = {
        create: { label: "Change Movement", call: null,
            title: "Create the transition: character2 starts at the playhead, the copy fills the frames before it" },
        "continue": { label: "Continue", call: "tfContinueTransition()",
            title: "Open the copy on the playhead frame, over character2's outline, for the re-pose" },
        finish: { label: "Done", call: "tfFinishTransition()",
            title: "Leave the copy and take its extra frame off" }
    };
    var step = "create";

    // A waiting Continue or Done also shows as a dot on the Movement icon (while Delay is open)
    function setStep(name) {
        step = name;
        movementBtn.textContent = STEPS[name].label;
        movementBtn.title = STEPS[name].title;
        movementBtn.classList.toggle("continue", name === "continue");
        movementBtn.classList.toggle("finish", name === "finish");
        if (name === "create") tabs.movement.btn.removeAttribute("data-step");
        else tabs.movement.btn.setAttribute("data-step", name);
        setStepFocus(name !== "create");
    }

    // While Continue or Done waits, only that button and Cancel work: no
    // new target, no new length, no Delay or Swap tool.
    function setStepFocus(on) {
        cancelBtn.hidden = !on;
        slots.source.btn.disabled = on;
        slots.target.btn.disabled = on;
        lengthInput.disabled = on;
        lengthCell.classList.toggle("locked", on);
        tabs.delay.btn.disabled = on;
        tabs.swap.btn.disabled = on;
        if (on && tabs.movement.panel.hidden) showTab("movement");
    }

    cancelBtn.addEventListener("click", function () {
        setMovementBusy(true);
        cs.evalScript("tfCancelTransition()", function (result) {
            setMovementBusy(false);
            handleResult(result);
            refreshMovement();
        });
    });

    movementBtn.addEventListener("click", function () {
        var call = STEPS[step].call;
        var finishing = step === "finish";
        if (!call) {
            if (!slots.target.name) {
                addLog("Pick a Target: the symbol to change to.", "error");
                return;
            }
            saveMovementSettings();
            call = "tfCreateTransition(" + quote(slots.target.name) + ", " + clampLength() + ", \"loop\", " + quote(slots.source.name) + ")";
        }
        setMovementBusy(true);
        cs.evalScript(call, function (result) {
            setMovementBusy(false);
            handleResult(result);
            if (finishing && result && result.indexOf("OK:") === 0) clearSlots();
            refreshMovement();
        });
    });

    // tfPanelState: re-pose flag (Done), then line-up flag (Continue).
    function refreshMovement() {
        cs.evalScript("tfPanelState()", function (result) {
            result = result || "";
            if (result.charAt(1) === "1") setStep("continue");
            else if (result.charAt(0) === "1") setStep("finish");
            else setStep("create");
        });
    }

    // Undo or switching documents can change it
    cs.addEventListener("com.adobe.events.flash.documentChanged", refreshMovement);
    cs.addEventListener("com.adobe.events.flash.timelineChanged", refreshMovement);
    window.addEventListener("focus", refreshMovement);
    refreshMovement();

    function setMovementBusy(busy) {
        movementBtn.disabled = busy;
        cancelBtn.disabled = busy;
        slots.source.btn.disabled = slots.target.btn.disabled = busy || step !== "create";
    }

    // JSFL string literal for a library name
    function quote(s) {
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    // ============================================================
    // Swap: inside the Target, one picked part becomes a picked Source part
    // ============================================================
    var swapBtn = document.getElementById("swapBtn");
    var pairsEl = document.getElementById("swPairs");
    var SWAP_KEY = "delayerz.swap";

    // path:  the character's library path ("" = not picked)
    // parts: its list lines (layer index, layer name, index, part path, head-to-toe rank)
    // part:  the picked line, or null
    // note:  why its parts cannot be shown (another document), or ""
    var sides = {
        source: { path: "", parts: [], part: null, note: "" },
        target: { path: "", parts: [], part: null, note: "" }
    };
    ["source", "target"].forEach(function (side) {
        var id = side === "source" ? "Source" : "Target";
        sides[side].nameEl = document.getElementById("sw" + id + "Name");
        sides[side].pickBtn = document.getElementById("sw" + id + "Pick");
        sides[side].pickBtn.addEventListener("click", function () { readParts(side, ""); });
    });

    // Both characters, remembered per PC; their parts are read again from the open document
    function saveSwap() {
        try {
            localStorage.setItem(SWAP_KEY, JSON.stringify({ source: sides.source.path, target: sides.target.path }));
        } catch (e) {
            // Not saved; the panel keeps working.
        }
    }

    function setSide(side, path) {
        var s = sides[side];
        s.path = path || "";
        s.nameEl.textContent = s.path ? s.path.split("/").pop() : "none";
        s.nameEl.classList.toggle("slot-none", !s.path);
        if (s.path) s.nameEl.title = s.path;
        else s.nameEl.removeAttribute("title");
    }

    // --- Rows: a Source part and the Target part that matches it ---
    // Same head-to-toe rank, then the most leading words in common on the
    // same side ("HAND L DEMO 01" with "HAND L DEMO 02", "CHEST" with
    // "CHEST copy"). A part without a match gets a row of its own. A Source
    // part only pairs; the animator can still pick any part on either side.
    function nameWords(path) {
        return path.split("/").pop().toUpperCase().split(/[\s_\-]+/).filter(Boolean);
    }

    function nameSide(words) {
        for (var i = 0; i < words.length; i++) {
            if (words[i] === "L" || words[i] === "LEFT") return "L";
            if (words[i] === "R" || words[i] === "RIGHT") return "R";
        }
        return "";
    }

    function wordsInCommon(a, b) {
        var x = nameWords(a), y = nameWords(b);
        if (nameSide(x) !== nameSide(y)) return 0;
        var n = 0;
        while (n < x.length && n < y.length && x[n] === y[n]) n++;
        return n;
    }

    function pairRows(src, tgt) {
        var ranks = [];
        src.concat(tgt).forEach(function (f) {
            var r = +f[4];
            if (ranks.indexOf(r) === -1) ranks.push(r);
        });
        ranks.sort(function (a, b) { return a - b; });
        var rows = [];
        ranks.forEach(function (r) {
            var s = src.filter(function (f) { return +f[4] === r; });
            var t = tgt.filter(function (f) { return +f[4] === r; });
            var used = [];
            s.forEach(function (f) {
                var best = -1, score = 0;
                for (var j = 0; j < t.length; j++) {
                    if (used.indexOf(j) !== -1) continue;
                    var c = wordsInCommon(f[3], t[j][3]);
                    // A tie goes to a different symbol: that is the one worth swapping
                    var better = c > score || (c && c === score && t[best][3] === f[3] && t[j][3] !== f[3]);
                    if (better) { best = j; score = c; }
                }
                if (best !== -1) used.push(best);
                rows.push([f, best === -1 ? null : t[best]]);
            });
            t.forEach(function (f, j) {
                if (used.indexOf(j) === -1) rows.push([null, f]);
            });
        });
        return rows;
    }

    function samePart(a, b) {
        return !!a && !!b && a[0] === b[0] && a[2] === b[2] && a[3] === b[3];
    }

    // Two parts of one character with the same name show their Library folder too
    function labelsFor(parts) {
        var seen = {};
        parts.forEach(function (f) {
            var short = f[3].split("/").pop();
            seen[short] = (seen[short] || 0) + 1;
        });
        return function (f) {
            var folders = f[3].split("/");
            var label = folders.pop();
            if (seen[label] > 1) label += " (" + (folders.length ? folders.join("/") : "Library root") + ")";
            return label;
        };
    }

    function emptyCell(text) {
        var cell = document.createElement("div");
        cell.className = "part-empty";
        cell.textContent = text || "";
        return cell;
    }

    function renderPairs() {
        var src = sides.source, tgt = sides.target;
        pairsEl.textContent = "";
        if (!src.parts.length && !tgt.parts.length) {
            var row0 = document.createElement("div");
            row0.className = "pair-row";
            row0.appendChild(emptyCell(src.note || "Not picked yet."));
            row0.appendChild(emptyCell(tgt.note || "Not picked yet."));
            pairsEl.appendChild(row0);
            updateSwapBtn();
            return;
        }
        var labels = { source: labelsFor(src.parts), target: labelsFor(tgt.parts) };
        var rows = pairRows(src.parts, tgt.parts);
        rows.forEach(function (pair, n) {
            var row = document.createElement("div");
            row.className = "pair-row";
            ["source", "target"].forEach(function (side, c) {
                var f = pair[c];
                if (!f) {
                    // First row of an empty side says why it is empty
                    row.appendChild(emptyCell(n === 0 && !sides[side].parts.length ? sides[side].note || "Not picked yet." : ""));
                    return;
                }
                var btn = document.createElement("button");
                btn.type = "button";
                btn.className = "part-item";
                btn.classList.toggle("selected", samePart(f, sides[side].part));
                btn.title = f[3] + " (layer " + f[1] + ")";
                btn.textContent = labels[side](f);
                btn.addEventListener("click", function () {
                    sides[side].part = f;
                    // A Source part also picks the Target part on its row
                    if (side === "source" && pair[1]) sides.target.part = pair[1];
                    renderPairs();
                });
                row.appendChild(btn);
            });
            pairsEl.appendChild(row);
        });
        updateSwapBtn();
    }

    // swReadParts: "OK: <path>", then the part lines. A picked part stays
    // picked when it is still in the list.
    function showParts(side, result) {
        var s = sides[side];
        var lines = result.split("\n");
        var path = lines[0].substring(4);
        var keep = path === s.path ? s.part : null;
        setSide(side, path);
        s.note = "";
        s.parts = lines.slice(1).map(function (line) { return line.split("\t"); });
        s.part = null;
        s.parts.forEach(function (f) { if (samePart(f, keep)) s.part = f; });
        renderPairs();
    }

    // path "" reads the selection (Pick); a remembered path is read quietly
    function readParts(side, path) {
        cs.evalScript("swReadParts(" + quote(path) + ")", function (result) {
            if (result && result.indexOf("OK: ") === 0) {
                showParts(side, result);
                saveSwap();
                if (!path) addLog((side === "source" ? "Source: " : "Target: ") + sides[side].path, "info");
            } else if (!path) {
                handleResult(result);
            } else {
                // Another document is open: the character stays picked for when it comes back
                var s = sides[side];
                s.parts = [];
                s.part = null;
                s.note = String(result || "").replace(/^ERROR: /, "");
                renderPairs();
            }
        });
    }

    function updateSwapBtn() {
        swapBtn.disabled = !(sides.source.part && sides.target.part);
    }

    function setSwapBusy(busy) {
        sides.source.pickBtn.disabled = sides.target.pickBtn.disabled = busy;
        var items = pairsEl.querySelectorAll(".part-item");
        for (var i = 0; i < items.length; i++) items[i].disabled = busy;
        if (busy) swapBtn.disabled = true;
        else updateSwapBtn();
    }

    // The Target is read again afterwards: its picked part has a new name
    swapBtn.addEventListener("click", function () {
        var t = sides.target.part;
        setSwapBusy(true);
        cs.evalScript("swSwapPart(" + quote(sides.target.path) + ", " + t[0] + ", " + quote(t[1]) + ", " +
            quote(t[3]) + ", " + quote(sides.source.part[3]) + ")", function (result) {
            setSwapBusy(false);
            handleResult(result);
            sides.target.part = null;
            readParts("target", sides.target.path);
        });
    });

    // A test build before 1.8.0 kept only the Source, as a plain path
    try {
        var savedSwap = localStorage.getItem(SWAP_KEY) || "";
        var saved = savedSwap.charAt(0) === "{" ? JSON.parse(savedSwap) : { source: savedSwap };
        setSide("source", saved.source);
        setSide("target", saved.target);
    } catch (e) { }

    function refreshSwap() {
        ["source", "target"].forEach(function (side) {
            if (sides[side].path) readParts(side, sides[side].path);
        });
    }
    refreshSwap();
    cs.addEventListener("com.adobe.events.flash.documentChanged", refreshSwap);

    // --- Log: hidden by default, opened with the log button ---
    // Newest entry first, last 20 kept. An error while the log is closed puts
    // a red dot on the button until the log opens.
    logBtn.addEventListener("click", function () {
        setLogOpen(logEl.hidden);
    });

    function setLogOpen(open) {
        logEl.hidden = !open;
        logBtn.setAttribute("aria-pressed", open ? "true" : "false");
        logBtn.title = open ? "Hide log" : "Show log";
        if (open) logBtn.classList.remove("has-error");
    }

    function addLog(msg, type) {
        var empty = logListEl.querySelector(".log-empty");
        if (empty) logListEl.removeChild(empty);
        if (type === "error" && logEl.hidden) logBtn.classList.add("has-error");

        var row = document.createElement("div");
        row.className = "log-entry " + type;
        var time = document.createElement("time");
        time.textContent = clockTime(new Date());
        var text = document.createElement("span");
        text.textContent = msg;
        row.appendChild(time);
        row.appendChild(text);
        logListEl.insertBefore(row, logListEl.firstChild);

        while (logListEl.children.length > LOG_MAX) logListEl.removeChild(logListEl.lastChild);
    }

    function clockTime(d) {
        var h = d.getHours(), m = d.getMinutes();
        return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
    }

    // --- Helper: log the result of an evalScript call ---
    function handleResult(result) {
        if (!result || result === "undefined") {
            addLog("No response from Animate.", "error");
            return;
        }
        if (result.indexOf("OK:") === 0) {
            addLog(result.replace("OK: ", ""), "success");
        } else if (result.indexOf("INFO:") === 0) {
            addLog(result.replace("INFO: ", ""), "info");
        } else {
            addLog(result.replace("ERROR: ", ""), "error");
        }
    }

    // Disable all buttons while a job is running
    function setButtons(disabled) {
        applyBtn.disabled = disabled;
        if (disabled) undoBtn.disabled = true;
    }

})();
