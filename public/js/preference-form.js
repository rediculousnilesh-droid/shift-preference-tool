/**
 * Shift Preference Form — client-side logic.
 *
 * Handles:
 *  - Loading programs on page load
 *  - Loading shifts when a program is selected
 *  - Filtering priority dropdowns so the same shift can't be picked twice
 *  - Client-side validation
 *  - Submitting to POST /api/submissions
 *  - Showing confirmation / error messages
 */

(function () {
  'use strict';

  // ── DOM references ──────────────────────────────────────────────────
  const form = document.getElementById('preference-form');
  const loginIdInput = document.getElementById('login-id');
  const programSelect = document.getElementById('program-select');
  const priority1Select = document.getElementById('priority1-select');
  const priority2Select = document.getElementById('priority2-select');
  const priority3Select = document.getElementById('priority3-select');
  const submitBtn = document.getElementById('submit-btn');

  const confirmationMsg = document.getElementById('confirmation-message');
  const errorMsg = document.getElementById('error-message');

  const loginIdError = document.getElementById('login-id-error');
  const programError = document.getElementById('program-error');
  const priority1Error = document.getElementById('priority1-error');
  const priority2Error = document.getElementById('priority2-error');
  const priority3Error = document.getElementById('priority3-error');
  const programLoading = document.getElementById('program-loading');

  const prioritySelects = [priority1Select, priority2Select, priority3Select];
  const priorityErrors = [priority1Error, priority2Error, priority3Error];

  // ── State ───────────────────────────────────────────────────────────
  let availableShifts = []; // shifts for the currently selected program

  // ── Helpers ─────────────────────────────────────────────────────────

  /** Hide all inline validation errors. */
  function clearFieldErrors() {
    [loginIdError, programError, ...priorityErrors].forEach(function (el) {
      el.textContent = '';
    });
  }

  /** Hide the top-level confirmation / error banners. */
  function clearMessages() {
    confirmationMsg.hidden = true;
    errorMsg.hidden = true;
    errorMsg.textContent = '';
  }

  /** Show an inline error next to a field. */
  function showFieldError(el, msg) {
    el.textContent = msg;
  }

  /** Show the top-level error banner. */
  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
  }

  /** Show the confirmation banner for 3 seconds, then reset the form. */
  function showConfirmationAndReset() {
    confirmationMsg.hidden = false;
    setTimeout(function () {
      confirmationMsg.hidden = true;
      resetForm();
    }, 3000);
  }

  /** Reset the entire form to its initial state. */
  function resetForm() {
    form.reset();
    clearFieldErrors();
    clearMessages();
    availableShifts = [];
    prioritySelects.forEach(function (sel) {
      sel.disabled = true;
      sel.innerHTML = '<option value="">-- Select a program first --</option>';
    });
  }

  // ── Data fetching ───────────────────────────────────────────────────

  /** Fetch programs from the API and populate the program dropdown. */
  async function loadPrograms() {
    programLoading.hidden = false;
    try {
      var res = await fetch('/api/programs');
      if (!res.ok) throw new Error('Failed to load programs');
      var programs = await res.json();

      // Keep the default placeholder
      programSelect.innerHTML = '<option value="">-- Select a Program --</option>';
      programs.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        programSelect.appendChild(opt);
      });
    } catch (err) {
      showError('Unable to load programs. Please refresh the page.');
    } finally {
      programLoading.hidden = true;
    }
  }

  /** Fetch shifts for the selected program and populate priority dropdowns. */
  async function loadShifts(programId) {
    // Disable and reset priority selects while loading
    prioritySelects.forEach(function (sel) {
      sel.disabled = true;
      sel.innerHTML = '<option value="">Loading shifts…</option>';
    });

    try {
      var res = await fetch('/api/programs/' + programId + '/shifts');
      if (!res.ok) throw new Error('Failed to load shifts');
      availableShifts = await res.json();

      if (availableShifts.length === 0) {
        prioritySelects.forEach(function (sel) {
          sel.innerHTML = '<option value="">No shifts available for this program</option>';
        });
        return;
      }

      // Enable and populate
      populatePriorityDropdowns();
    } catch (err) {
      showError('Unable to load shifts. Please try again.');
    }
  }

  // ── Dropdown filtering ──────────────────────────────────────────────

  /**
   * Rebuild all three priority dropdowns, filtering out shifts that are
   * already selected in the other two dropdowns.
   */
  function populatePriorityDropdowns() {
    var selectedValues = prioritySelects.map(function (sel) {
      return sel.value;
    });

    prioritySelects.forEach(function (sel, idx) {
      var currentValue = selectedValues[idx];
      var otherSelected = selectedValues.filter(function (v, i) {
        return i !== idx && v !== '';
      });

      sel.innerHTML = '<option value="">-- Select a shift --</option>';

      availableShifts.forEach(function (shift) {
        // Hide shifts selected in other dropdowns
        if (otherSelected.indexOf(String(shift.id)) !== -1) return;

        var opt = document.createElement('option');
        opt.value = shift.id;
        opt.textContent = shift.name;
        if (String(shift.id) === currentValue) {
          opt.selected = true;
        }
        sel.appendChild(opt);
      });

      sel.disabled = false;
    });
  }

  // ── Validation ──────────────────────────────────────────────────────

  /**
   * Validate the Login ID client-side.
   * Returns an error string or null if valid.
   */
  function validateLoginId(value) {
    if (!value || value.trim() === '') {
      return 'Login ID is required';
    }
    if (!value.endsWith('@')) {
      return 'Login ID must end with @';
    }
    var beforeAt = value.slice(0, -1);
    if (beforeAt.length < 2) {
      return 'Login ID must have at least 2 characters before @';
    }
    if (!/^[a-zA-Z0-9]+$/.test(beforeAt)) {
      return 'Login ID must contain only alphanumeric characters before @';
    }
    return null;
  }

  /**
   * Run full client-side validation. Returns true if valid.
   */
  function validateForm() {
    clearFieldErrors();
    var valid = true;

    // Login ID
    var loginErr = validateLoginId(loginIdInput.value);
    if (loginErr) {
      showFieldError(loginIdError, loginErr);
      valid = false;
    }

    // Program
    if (!programSelect.value) {
      showFieldError(programError, 'Please select a program');
      valid = false;
    }

    // Priorities
    prioritySelects.forEach(function (sel, idx) {
      if (!sel.value) {
        showFieldError(priorityErrors[idx], 'Priority ' + (idx + 1) + ' selection is required');
        valid = false;
      }
    });

    return valid;
  }

  // ── Event handlers ──────────────────────────────────────────────────

  programSelect.addEventListener('change', function () {
    clearMessages();
    var programId = programSelect.value;
    if (!programId) {
      availableShifts = [];
      prioritySelects.forEach(function (sel) {
        sel.disabled = true;
        sel.innerHTML = '<option value="">-- Select a program first --</option>';
      });
      return;
    }
    loadShifts(programId);
  });

  // When any priority dropdown changes, re-filter the others
  prioritySelects.forEach(function (sel) {
    sel.addEventListener('change', function () {
      populatePriorityDropdowns();
    });
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearMessages();

    if (!validateForm()) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    var payload = {
      loginId: loginIdInput.value.trim(),
      programId: parseInt(programSelect.value, 10),
      priority1ShiftId: parseInt(priority1Select.value, 10),
      priority2ShiftId: parseInt(priority2Select.value, 10),
      priority3ShiftId: parseInt(priority3Select.value, 10),
    };

    try {
      var res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        var body = await res.json().catch(function () {
          return { error: 'Submission failed. Please try again.' };
        });
        showError(body.error || 'Submission failed. Please try again.');
        return;
      }

      showConfirmationAndReset();
    } catch (err) {
      showError('Unable to reach the server. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Preferences';
    }
  });

  // ── Init ────────────────────────────────────────────────────────────
  loadPrograms();
})();
