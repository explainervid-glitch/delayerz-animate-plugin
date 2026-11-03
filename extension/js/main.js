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
    // Tools: Delay | Movement, picked from the icon rail on the left.
    // The last tool used opens next time.
    // ============================================================
    var TAB_KEY = "delayerz.tab";
    var tabs = {
        delay: { btn: document.getElementById("tabDelayBtn"), panel: document.getElementById("tabDelay") },
        movement: { btn: document.getElementById("tabMovementBtn"), panel: document.getElementById("tabMovement") }
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

    try {
        if (localStorage.getItem(TAB_KEY) === "movement") showTab("movement");
    } catch (e) { }

    // ============================================================
    // Movement: character1 (selected at the playhead) to character2 (Target)
    // ============================================================
    var targetEl = document.getElementById("target");
    var targetLabel = document.getElementById("targetLabel");
    var targetName = ""; // full library path of the picked symbol
    var pickBtn = document.getElementById("pickBtn");
    var lengthInput = document.getElementById("length");
    var lengthCell = document.getElementById("lengthCell");
    var movementBtn = document.getElementById("movementBtn");
    var cancelBtn = document.getElementById("cancelBtn");

    var LENGTH_MIN = 1;
    var LENGTH_MAX = 999;
    var MOVEMENT_KEY = "delayerz.movement";

    // --- Remembered length and target (per PC; the panel works without them) ---
    var movementSettings = loadMovementSettings();
    if (movementSettings.length) lengthInput.value = movementSettings.length;
    if (movementSettings.target) setTarget(movementSettings.target);

    function loadMovementSettings() {
        try {
            return JSON.parse(localStorage.getItem(MOVEMENT_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function saveMovementSettings() {
        try {
            localStorage.setItem(MOVEMENT_KEY, JSON.stringify({ length: clampLength(), target: targetName }));
        } catch (e) {
            // Not saved; the panel keeps working.
        }
    }

    // --- Target: Pick takes the selected symbol (stage first, then Library) ---
    // The label shows the symbol name; hovering shows the full library path
    function setTarget(name) {
        targetName = name;
        targetEl.textContent = name.split("/").pop();
        targetEl.classList.remove("target-none");
        targetLabel.title = name;
    }

    // Back to "none" (after Done); the symbol stays in the library
    function clearTarget() {
        targetName = "";
        targetEl.textContent = "none";
        targetEl.classList.add("target-none");
        targetLabel.removeAttribute("title");
        saveMovementSettings();
    }

    pickBtn.addEventListener("click", function () {
        cs.evalScript("tfPickSymbol()", function (result) {
            if (result && result.indexOf("OK: ") === 0) {
                setTarget(result.substring(4));
                saveMovementSettings();
                addLog("Target: " + targetName, "info");
            } else {
                handleResult(result);
            }
        });
    });

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
    // new target, no new length, no Delay tool.
    function setStepFocus(on) {
        cancelBtn.hidden = !on;
        pickBtn.disabled = on;
        lengthInput.disabled = on;
        lengthCell.classList.toggle("locked", on);
        tabs.delay.btn.disabled = on;
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
            if (!targetName) {
                addLog("Pick a symbol to transition to.", "error");
                return;
            }
            saveMovementSettings();
            call = "tfCreateTransition(" + quote(targetName) + ", " + clampLength() + ", \"loop\")";
        }
        setMovementBusy(true);
        cs.evalScript(call, function (result) {
            setMovementBusy(false);
            handleResult(result);
            if (finishing && result && result.indexOf("OK:") === 0) clearTarget();
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
        pickBtn.disabled = busy || step !== "create";
    }

    // JSFL string literal for a library name
    function quote(s) {
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    // --- Log: hidden by default, opened with the log button ---
    // Newest entry first, last 20 kept. No new-message marker on the button.
    logBtn.addEventListener("click", function () {
        setLogOpen(logEl.hidden);
    });

    function setLogOpen(open) {
        logEl.hidden = !open;
        logBtn.setAttribute("aria-pressed", open ? "true" : "false");
        logBtn.title = open ? "Hide log" : "Show log";
    }

    function addLog(msg, type) {
        var empty = logEl.querySelector(".log-empty");
        if (empty) logEl.removeChild(empty);

        var row = document.createElement("div");
        row.className = "log-entry " + type;
        var time = document.createElement("time");
        time.textContent = clockTime(new Date());
        var text = document.createElement("span");
        text.textContent = msg;
        row.appendChild(time);
        row.appendChild(text);
        logEl.insertBefore(row, logEl.firstChild);

        while (logEl.children.length > LOG_MAX) logEl.removeChild(logEl.lastChild);
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
