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
    var statusEl = document.getElementById("status");

    // --- Apply button handler ---
    applyBtn.addEventListener("click", function () {
        var delay = parseInt(delayInput.value, 10);
        var mode = document.querySelector('input[name="mode"]:checked').value;

        if (isNaN(delay) || delay < 1) {
            showStatus("Enter a valid delay value (min 1).", "error");
            return;
        }

        showStatus("Applying stagger...", "info");
        setButtons(true);

        cs.evalScript('applyDelayerZ(' + delay + ', "' + mode + '")', function (result) {
            setButtons(false);
            handleResult(result);

            // Enable Undo only when Apply succeeded
            if (result && result.indexOf("OK:") === 0) {
                undoBtn.disabled = false;
            }
        });
    });

    // --- Undo button handler ---
    undoBtn.addEventListener("click", function () {
        showStatus("Resetting to original positions...", "info");
        setButtons(true);

        cs.evalScript('undoDelayerZ()', function (result) {
            setButtons(false);
            handleResult(result);

            // After undo, disable the Undo button again
            undoBtn.disabled = true;
        });
    });

    // --- Helper: show status ---
    function handleResult(result) {
        if (!result || result === "undefined") {
            showStatus("No response from Animate.", "error");
            return;
        }
        if (result.indexOf("OK:") === 0) {
            showStatus(result.replace("OK: ", ""), "success");
        } else {
            showStatus(result.replace("ERROR: ", ""), "error");
        }
    }

    function showStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className = "status " + (type || "");
    }

    // Disable all buttons while a job is running
    function setButtons(disabled) {
        applyBtn.disabled = disabled;
        if (disabled) undoBtn.disabled = true;
    }

})();
