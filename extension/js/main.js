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

    // --- Log: hidden by default, opened with the log button ---
    // Newest entry first, last 20 kept. While the log is closed, a dot on
    // the button shows that a message arrived (red wins over green).
    var UNREAD_RANK = { success: 1, error: 2 };

    logBtn.addEventListener("click", function () {
        setLogOpen(logEl.hidden);
    });

    function setLogOpen(open) {
        logEl.hidden = !open;
        logBtn.setAttribute("aria-pressed", open ? "true" : "false");
        logBtn.title = open ? "Hide log" : "Show log";
        if (open) logBtn.removeAttribute("data-unread");
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

        if (logEl.hidden) {
            var current = logBtn.getAttribute("data-unread");
            if (!current || UNREAD_RANK[type] >= UNREAD_RANK[current]) {
                logBtn.setAttribute("data-unread", type);
            }
        }
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
