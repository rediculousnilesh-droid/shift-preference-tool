/**
 * Shift Management — client-side logic for the WFM Planner admin page.
 *
 * Handles:
 *  - Loading and displaying programs and shifts
 *  - CRUD operations for programs (create, inline edit, delete)
 *  - CRUD operations for shifts (create, inline edit, delete)
 *  - Confirmation dialog before deleting (with warning for referenced shifts)
 */

(function () {
  'use strict';

  // ── DOM references ──────────────────────────────────────────────────
  var createProgramForm = document.getElementById('create-program-form');
  var newProgramNameInput = document.getElementById('new-program-name');
  var programList = document.getElementById('program-list');
  var programMessage = document.getElementById('program-message');

  var createShiftForm = document.getElementById('create-shift-form');
  var shiftProgramSelect = document.getElementById('shift-program-select');
  var newShiftNameInput = document.getElementById('new-shift-name');
  var shiftTableBody = document.getElementById('shift-table-body');
  var shiftMessage = document.getElementById('shift-message');

  var dialogOverlay = document.getElementById('confirm-dialog-overlay');
  var dialogBody = document.getElementById('dialog-body');
  var dialogCancel = document.getElementById('dialog-cancel');
  var dialogConfirm = document.getElementById('dialog-confirm');

  // ── State ───────────────────────────────────────────────────────────
  var programs = [];
  var shifts = [];

  // ── Helpers ─────────────────────────────────────────────────────────

  function showMessage(el, text, type) {
    el.textContent = text;
    el.className = 'message message-' + type;
    el.hidden = false;
    setTimeout(function () { el.hidden = true; }, 4000);
  }

  function programNameById(id) {
    var p = programs.find(function (prog) { return prog.id === id; });
    return p ? p.name : 'Unknown';
  }

  // ── Data fetching ───────────────────────────────────────────────────

  async function loadPrograms() {
    try {
      var res = await fetch('/api/programs');
      if (!res.ok) throw new Error('Failed to load programs');
      programs = await res.json();
      renderPrograms();
      populateProgramDropdown();
    } catch (err) {
      showMessage(programMessage, 'Unable to load programs. Please refresh.', 'error');
    }
  }

  async function loadShifts() {
    try {
      var allShifts = [];
      for (var i = 0; i < programs.length; i++) {
        var res = await fetch('/api/programs/' + programs[i].id + '/shifts');
        if (!res.ok) continue;
        var programShifts = await res.json();
        allShifts = allShifts.concat(programShifts);
      }
      shifts = allShifts;
      renderShifts();
    } catch (err) {
      showMessage(shiftMessage, 'Unable to load shifts. Please refresh.', 'error');
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────

  function renderPrograms() {
    programList.innerHTML = '';

    if (programs.length === 0) {
      var emptyLi = document.createElement('li');
      emptyLi.textContent = 'No programs yet. Add one above.';
      emptyLi.style.color = '#6b7c93';
      programList.appendChild(emptyLi);
      return;
    }

    programs.forEach(function (prog) {
      var li = document.createElement('li');
      li.dataset.id = prog.id;

      var nameSpan = document.createElement('span');
      nameSpan.className = 'program-name';
      nameSpan.textContent = prog.name;

      var editBtn = document.createElement('button');
      editBtn.className = 'btn btn-secondary btn-sm';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function () { startEditProgram(li, prog); });

      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-danger btn-sm';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function () { deleteProgram(prog.id); });

      li.appendChild(nameSpan);
      li.appendChild(editBtn);
      li.appendChild(deleteBtn);
      programList.appendChild(li);
    });
  }

  function populateProgramDropdown() {
    shiftProgramSelect.innerHTML = '<option value="">-- Select a Program --</option>';
    programs.forEach(function (prog) {
      var opt = document.createElement('option');
      opt.value = prog.id;
      opt.textContent = prog.name;
      shiftProgramSelect.appendChild(opt);
    });
  }

  function renderShifts() {
    shiftTableBody.innerHTML = '';

    if (shifts.length === 0) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'No shifts yet. Add one above.';
      td.style.color = '#6b7c93';
      td.style.textAlign = 'center';
      tr.appendChild(td);
      shiftTableBody.appendChild(tr);
      return;
    }

    // Sort shifts by program name, then shift name
    var sorted = shifts.slice().sort(function (a, b) {
      var pA = programNameById(a.programId || a.program_id);
      var pB = programNameById(b.programId || b.program_id);
      if (pA < pB) return -1;
      if (pA > pB) return 1;
      var nA = (a.name || '').toLowerCase();
      var nB = (b.name || '').toLowerCase();
      return nA < nB ? -1 : nA > nB ? 1 : 0;
    });

    sorted.forEach(function (shift) {
      var tr = document.createElement('tr');
      tr.dataset.id = shift.id;

      var tdName = document.createElement('td');
      tdName.textContent = shift.name;

      var tdProgram = document.createElement('td');
      tdProgram.textContent = programNameById(shift.programId || shift.program_id);

      var tdActions = document.createElement('td');
      var actionsDiv = document.createElement('div');
      actionsDiv.className = 'actions';

      var editBtn = document.createElement('button');
      editBtn.className = 'btn btn-secondary btn-sm';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function () { startEditShift(tr, shift); });

      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-danger btn-sm';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function () { confirmDeleteShift(shift.id); });

      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);
      tdActions.appendChild(actionsDiv);

      tr.appendChild(tdName);
      tr.appendChild(tdProgram);
      tr.appendChild(tdActions);
      shiftTableBody.appendChild(tr);
    });
  }

  // ── Program CRUD ────────────────────────────────────────────────────

  createProgramForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = newProgramNameInput.value.trim();
    if (!name) return;

    try {
      var res = await fetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name }),
      });

      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        showMessage(programMessage, body.error || 'Failed to create program.', 'error');
        return;
      }

      newProgramNameInput.value = '';
      showMessage(programMessage, 'Program created successfully.', 'success');
      await loadPrograms();
      await loadShifts();
    } catch (err) {
      showMessage(programMessage, 'Unable to reach the server. Please try again.', 'error');
    }
  });

  function startEditProgram(li, prog) {
    // Replace the list item content with an inline edit form
    li.innerHTML = '';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input';
    input.value = prog.name;

    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function () { saveEditProgram(prog.id, input.value.trim()); });

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary btn-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function () { renderPrograms(); });

    li.appendChild(input);
    li.appendChild(saveBtn);
    li.appendChild(cancelBtn);
    input.focus();
  }

  async function saveEditProgram(id, name) {
    if (!name) {
      showMessage(programMessage, 'Program name cannot be empty.', 'error');
      return;
    }

    try {
      var res = await fetch('/api/programs/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name }),
      });

      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        showMessage(programMessage, body.error || 'Failed to update program.', 'error');
        return;
      }

      showMessage(programMessage, 'Program updated successfully.', 'success');
      await loadPrograms();
      await loadShifts();
    } catch (err) {
      showMessage(programMessage, 'Unable to reach the server. Please try again.', 'error');
    }
  }

  async function deleteProgram(id) {
    if (!confirm('Are you sure you want to delete this program? All associated shifts will also be deleted.')) {
      return;
    }

    try {
      var res = await fetch('/api/programs/' + id, { method: 'DELETE' });

      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        showMessage(programMessage, body.error || 'Failed to delete program.', 'error');
        return;
      }

      showMessage(programMessage, 'Program deleted successfully.', 'success');
      await loadPrograms();
      await loadShifts();
    } catch (err) {
      showMessage(programMessage, 'Unable to reach the server. Please try again.', 'error');
    }
  }

  // ── Shift CRUD ──────────────────────────────────────────────────────

  createShiftForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var programId = parseInt(shiftProgramSelect.value, 10);
    var name = newShiftNameInput.value.trim();

    if (!programId || isNaN(programId)) {
      showMessage(shiftMessage, 'Please select a program.', 'error');
      return;
    }
    if (!name) {
      showMessage(shiftMessage, 'Shift name is required.', 'error');
      return;
    }

    try {
      var res = await fetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, programId: programId }),
      });

      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        showMessage(shiftMessage, body.error || 'Failed to create shift.', 'error');
        return;
      }

      newShiftNameInput.value = '';
      showMessage(shiftMessage, 'Shift created successfully.', 'success');
      await loadShifts();
    } catch (err) {
      showMessage(shiftMessage, 'Unable to reach the server. Please try again.', 'error');
    }
  });

  function startEditShift(tr, shift) {
    tr.innerHTML = '';

    var tdName = document.createElement('td');
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'edit-input';
    nameInput.value = shift.name;
    tdName.appendChild(nameInput);

    var tdProgram = document.createElement('td');
    var progSelect = document.createElement('select');
    progSelect.className = 'edit-input';
    programs.forEach(function (prog) {
      var opt = document.createElement('option');
      opt.value = prog.id;
      opt.textContent = prog.name;
      if (prog.id === (shift.programId || shift.program_id)) {
        opt.selected = true;
      }
      progSelect.appendChild(opt);
    });
    tdProgram.appendChild(progSelect);

    var tdActions = document.createElement('td');
    var actionsDiv = document.createElement('div');
    actionsDiv.className = 'actions';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function () {
      saveEditShift(shift.id, nameInput.value.trim(), parseInt(progSelect.value, 10));
    });

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary btn-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function () { renderShifts(); });

    actionsDiv.appendChild(saveBtn);
    actionsDiv.appendChild(cancelBtn);
    tdActions.appendChild(actionsDiv);

    tr.appendChild(tdName);
    tr.appendChild(tdProgram);
    tr.appendChild(tdActions);
    nameInput.focus();
  }

  async function saveEditShift(id, name, programId) {
    if (!name) {
      showMessage(shiftMessage, 'Shift name cannot be empty.', 'error');
      return;
    }

    try {
      var res = await fetch('/api/shifts/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, programId: programId }),
      });

      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        showMessage(shiftMessage, body.error || 'Failed to update shift.', 'error');
        return;
      }

      showMessage(shiftMessage, 'Shift updated successfully.', 'success');
      await loadShifts();
    } catch (err) {
      showMessage(shiftMessage, 'Unable to reach the server. Please try again.', 'error');
    }
  }

  // ── Delete shift with confirmation dialog ───────────────────────────

  var pendingDeleteShiftId = null;

  function confirmDeleteShift(shiftId) {
    pendingDeleteShiftId = shiftId;
    dialogBody.textContent = 'Are you sure you want to delete this shift? If it is referenced in existing submissions, those submissions will also be removed.';
    dialogOverlay.hidden = false;
    dialogConfirm.focus();
  }

  dialogCancel.addEventListener('click', function () {
    dialogOverlay.hidden = true;
    pendingDeleteShiftId = null;
  });

  dialogConfirm.addEventListener('click', async function () {
    dialogOverlay.hidden = true;
    if (!pendingDeleteShiftId) return;

    var shiftId = pendingDeleteShiftId;
    pendingDeleteShiftId = null;

    try {
      var res = await fetch('/api/shifts/' + shiftId, { method: 'DELETE' });

      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        showMessage(shiftMessage, body.error || 'Failed to delete shift.', 'error');
        return;
      }

      var result = await res.json();

      if (result.referenced) {
        showMessage(shiftMessage, 'Shift deleted. Note: submissions referencing this shift were also removed.', 'success');
      } else {
        showMessage(shiftMessage, 'Shift deleted successfully.', 'success');
      }

      await loadShifts();
    } catch (err) {
      showMessage(shiftMessage, 'Unable to reach the server. Please try again.', 'error');
    }
  });

  // Close dialog on overlay click
  dialogOverlay.addEventListener('click', function (e) {
    if (e.target === dialogOverlay) {
      dialogOverlay.hidden = true;
      pendingDeleteShiftId = null;
    }
  });

  // ── Init ────────────────────────────────────────────────────────────
  async function init() {
    await loadPrograms();
    await loadShifts();
  }

  init();
})();
