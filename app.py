"""
Shift Preference Tool — Python/Flask Backend
Replaces the Node.js/Express server with identical API endpoints.
"""

import os
import csv
import io
import sqlite3
from datetime import datetime, timezone
from flask import Flask, request, jsonify, send_from_directory, Response

app = Flask(__name__, static_folder='public', static_url_path='')

# Database path
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'shift-preferences.db')


# ── Database helpers ─────────────────────────────────────────────────

def get_db():
    """Get a database connection with WAL mode, foreign keys, and busy timeout."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute('PRAGMA busy_timeout = 5000')
    return conn


def init_db():
    """Create tables if they don't exist."""
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS programs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            program_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
            UNIQUE(name, program_id)
        );

        CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            login_id TEXT NOT NULL UNIQUE,
            program_id INTEGER NOT NULL,
            priority1_shift_id INTEGER NOT NULL,
            priority2_shift_id INTEGER NOT NULL,
            priority3_shift_id INTEGER NOT NULL,
            submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (program_id) REFERENCES programs(id),
            FOREIGN KEY (priority1_shift_id) REFERENCES shifts(id),
            FOREIGN KEY (priority2_shift_id) REFERENCES shifts(id),
            FOREIGN KEY (priority3_shift_id) REFERENCES shifts(id)
        );
    ''')
    conn.commit()
    conn.close()
    print('Database initialized at', DB_PATH)


def row_to_dict(row):
    """Convert a sqlite3.Row to a plain dict."""
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    """Convert a list of sqlite3.Row to a list of dicts."""
    return [dict(r) for r in rows]


# ── Static pages ─────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('public', 'index.html')


@app.route('/admin')
def admin():
    return send_from_directory('public', 'admin.html')


@app.route('/manager')
def manager():
    return send_from_directory('public', 'manager.html')


# ── Program API ──────────────────────────────────────────────────────

@app.route('/api/programs', methods=['GET'])
def get_programs():
    conn = get_db()
    rows = conn.execute('SELECT id, name, created_at FROM programs ORDER BY name').fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))


@app.route('/api/programs', methods=['POST'])
def create_program():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()

    if not name:
        return jsonify({'error': 'Program name is required'}), 400

    conn = get_db()
    try:
        cursor = conn.execute('INSERT INTO programs (name) VALUES (?)', (name,))
        conn.commit()
        row = conn.execute('SELECT id, name, created_at FROM programs WHERE id = ?',
                           (cursor.lastrowid,)).fetchone()
        conn.close()
        return jsonify(row_to_dict(row)), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'A program with this name already exists'}), 409


@app.route('/api/programs/<int:program_id>', methods=['PUT'])
def update_program(program_id):
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()

    if not name:
        return jsonify({'error': 'Program name is required'}), 400

    conn = get_db()
    try:
        cursor = conn.execute('UPDATE programs SET name = ? WHERE id = ?', (name, program_id))
        if cursor.rowcount == 0:
            conn.close()
            return jsonify({'error': 'Program not found'}), 404
        conn.commit()
        row = conn.execute('SELECT id, name, created_at FROM programs WHERE id = ?',
                           (program_id,)).fetchone()
        conn.close()
        return jsonify(row_to_dict(row))
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'A program with this name already exists'}), 409


@app.route('/api/programs/<int:program_id>', methods=['DELETE'])
def delete_program(program_id):
    conn = get_db()
    cursor = conn.execute('DELETE FROM programs WHERE id = ?', (program_id,))
    if cursor.rowcount == 0:
        conn.close()
        return jsonify({'error': 'Program not found'}), 404
    conn.commit()
    conn.close()
    return jsonify({'message': 'Program deleted successfully'})


# ── Shift API ────────────────────────────────────────────────────────

@app.route('/api/programs/<int:program_id>/shifts', methods=['GET'])
def get_shifts_by_program(program_id):
    conn = get_db()
    rows = conn.execute(
        'SELECT id, name, program_id, created_at FROM shifts WHERE program_id = ? ORDER BY name',
        (program_id,)
    ).fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))


@app.route('/api/shifts', methods=['POST'])
def create_shift():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    program_id = data.get('programId')

    if not name:
        return jsonify({'error': 'Shift name is required'}), 400

    if program_id is None:
        return jsonify({'error': 'Program ID is required'}), 400

    conn = get_db()

    # Check program exists
    prog = conn.execute('SELECT id FROM programs WHERE id = ?', (program_id,)).fetchone()
    if not prog:
        conn.close()
        return jsonify({'error': 'Selected program does not exist'}), 400

    # Check duplicate name in same program (case-insensitive)
    existing = conn.execute(
        'SELECT id FROM shifts WHERE LOWER(name) = LOWER(?) AND program_id = ?',
        (name, program_id)
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({'error': 'A shift with this name already exists in the selected program'}), 409

    try:
        cursor = conn.execute('INSERT INTO shifts (name, program_id) VALUES (?, ?)', (name, program_id))
        conn.commit()
        row = conn.execute('SELECT id, name, program_id, created_at FROM shifts WHERE id = ?',
                           (cursor.lastrowid,)).fetchone()
        conn.close()
        return jsonify(row_to_dict(row)), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'A shift with this name already exists in the selected program'}), 409


@app.route('/api/shifts/<int:shift_id>', methods=['PUT'])
def update_shift(shift_id):
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    program_id = data.get('programId')

    if not name:
        return jsonify({'error': 'Shift name is required'}), 400
    if program_id is None:
        return jsonify({'error': 'Program ID is required'}), 400

    conn = get_db()

    # Check duplicate name in same program (excluding current shift)
    existing = conn.execute(
        'SELECT id FROM shifts WHERE LOWER(name) = LOWER(?) AND program_id = ? AND id != ?',
        (name, program_id, shift_id)
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({'error': 'A shift with this name already exists in the selected program'}), 409

    try:
        cursor = conn.execute('UPDATE shifts SET name = ?, program_id = ? WHERE id = ?',
                              (name, program_id, shift_id))
        if cursor.rowcount == 0:
            conn.close()
            return jsonify({'error': 'Shift not found'}), 404
        conn.commit()
        row = conn.execute('SELECT id, name, program_id, created_at FROM shifts WHERE id = ?',
                           (shift_id,)).fetchone()
        conn.close()
        return jsonify(row_to_dict(row))
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'A shift with this name already exists in the selected program'}), 409


@app.route('/api/shifts/<int:shift_id>', methods=['DELETE'])
def delete_shift(shift_id):
    conn = get_db()

    # Check if referenced in submissions
    ref = conn.execute(
        'SELECT COUNT(*) as cnt FROM submissions '
        'WHERE priority1_shift_id = ? OR priority2_shift_id = ? OR priority3_shift_id = ?',
        (shift_id, shift_id, shift_id)
    ).fetchone()
    referenced = ref['cnt'] > 0

    if referenced:
        conn.execute(
            'DELETE FROM submissions '
            'WHERE priority1_shift_id = ? OR priority2_shift_id = ? OR priority3_shift_id = ?',
            (shift_id, shift_id, shift_id)
        )

    cursor = conn.execute('DELETE FROM shifts WHERE id = ?', (shift_id,))
    if cursor.rowcount == 0:
        conn.close()
        return jsonify({'error': 'Shift not found'}), 404

    conn.commit()
    conn.close()
    return jsonify({'message': 'Shift deleted successfully', 'referenced': referenced})


# ── Submission API ───────────────────────────────────────────────────

def validate_login_id(login_id):
    """Validate login ID format: alphanumeric + mandatory @ at end."""
    if not login_id or not login_id.strip():
        return False, 'Login ID is required'
    if not login_id.endswith('@'):
        return False, 'Login ID must end with @'
    before_at = login_id[:-1]
    if not before_at.isalnum():
        return False, 'Login ID must contain only alphanumeric characters before @'
    if len(before_at) < 2:
        return False, 'Login ID must have at least 2 characters before @'
    return True, None


@app.route('/api/submissions', methods=['POST'])
def create_submission():
    data = request.get_json(silent=True) or {}
    login_id = data.get('loginId', '')
    program_id = data.get('programId')
    p1 = data.get('priority1ShiftId')
    p2 = data.get('priority2ShiftId')
    p3 = data.get('priority3ShiftId')

    # Validate login ID
    valid, error = validate_login_id(login_id)
    if not valid:
        return jsonify({'error': 'Invalid Login ID format'}), 400

    conn = get_db()

    # Validate program exists
    prog = conn.execute('SELECT id FROM programs WHERE id = ?', (program_id,)).fetchone()
    if not prog:
        conn.close()
        return jsonify({'error': 'Selected program does not exist'}), 400

    # Validate all three priorities provided
    if p1 is None or p2 is None or p3 is None:
        conn.close()
        return jsonify({'error': 'All three priority selections are required'}), 400

    # Validate distinct shifts
    if len({p1, p2, p3}) != 3:
        conn.close()
        return jsonify({'error': 'Each priority must be a different shift'}), 400

    # Validate shifts belong to the selected program
    shifts = conn.execute(
        'SELECT id FROM shifts WHERE program_id = ?', (program_id,)
    ).fetchall()
    valid_ids = {s['id'] for s in shifts}
    if not {p1, p2, p3}.issubset(valid_ids):
        conn.close()
        return jsonify({'error': 'One or more selected shifts are invalid'}), 400

    # Upsert submission
    try:
        conn.execute('''
            INSERT INTO submissions (login_id, program_id, priority1_shift_id, priority2_shift_id, priority3_shift_id, submitted_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(login_id) DO UPDATE SET
                program_id = excluded.program_id,
                priority1_shift_id = excluded.priority1_shift_id,
                priority2_shift_id = excluded.priority2_shift_id,
                priority3_shift_id = excluded.priority3_shift_id,
                submitted_at = datetime('now')
        ''', (login_id, program_id, p1, p2, p3))
        conn.commit()

        row = conn.execute(
            'SELECT id, login_id, program_id, priority1_shift_id, priority2_shift_id, '
            'priority3_shift_id, submitted_at FROM submissions WHERE login_id = ?',
            (login_id,)
        ).fetchone()
        conn.close()
        return jsonify({'message': 'Submission recorded', 'submission': row_to_dict(row)})
    except Exception as e:
        conn.close()
        return jsonify({'error': 'Submission could not be saved. Please try again.'}), 500


# ── Export API ───────────────────────────────────────────────────────

@app.route('/api/export', methods=['GET'])
def export_csv():
    conn = get_db()

    submissions = conn.execute(
        'SELECT id, login_id, program_id, priority1_shift_id, priority2_shift_id, '
        'priority3_shift_id, submitted_at FROM submissions ORDER BY login_id'
    ).fetchall()

    programs = {r['id']: r['name'] for r in conn.execute('SELECT id, name FROM programs').fetchall()}
    shifts = {r['id']: r['name'] for r in conn.execute('SELECT id, name FROM shifts').fetchall()}
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Login_ID', 'Program', 'Priority_1_Shift', 'Priority_2_Shift',
                     'Priority_3_Shift', 'Submission_Timestamp'])

    for sub in submissions:
        writer.writerow([
            sub['login_id'],
            programs.get(sub['program_id'], ''),
            shifts.get(sub['priority1_shift_id'], ''),
            shifts.get(sub['priority2_shift_id'], ''),
            shifts.get(sub['priority3_shift_id'], ''),
            sub['submitted_at'],
        ])

    csv_content = output.getvalue()
    output.close()

    return Response(
        csv_content,
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment; filename="shift-preferences.csv"'}
    )


# ── Dashboard API ────────────────────────────────────────────────────

@app.route('/api/dashboard', methods=['GET'])
def dashboard():
    """Return pivot-style summary: headcount by program, shift, priority, and date."""
    conn = get_db()

    submissions = conn.execute(
        'SELECT login_id, program_id, priority1_shift_id, priority2_shift_id, '
        'priority3_shift_id, submitted_at FROM submissions'
    ).fetchall()

    programs = {r['id']: r['name'] for r in conn.execute('SELECT id, name FROM programs').fetchall()}
    shifts_map = {r['id']: r['name'] for r in conn.execute('SELECT id, name FROM shifts').fetchall()}
    conn.close()

    total = len(submissions)

    # By program
    by_program = {}
    for s in submissions:
        pname = programs.get(s['program_id'], 'Unknown')
        by_program[pname] = by_program.get(pname, 0) + 1

    # By shift (count how many times each shift appears across all priorities)
    by_shift = {}
    for s in submissions:
        for sid in [s['priority1_shift_id'], s['priority2_shift_id'], s['priority3_shift_id']]:
            sname = shifts_map.get(sid, 'Unknown')
            by_shift[sname] = by_shift.get(sname, 0) + 1

    # By shift per priority level
    by_shift_priority = {'priority1': {}, 'priority2': {}, 'priority3': {}}
    for s in submissions:
        for key, sid in [('priority1', s['priority1_shift_id']),
                         ('priority2', s['priority2_shift_id']),
                         ('priority3', s['priority3_shift_id'])]:
            sname = shifts_map.get(sid, 'Unknown')
            by_shift_priority[key][sname] = by_shift_priority[key].get(sname, 0) + 1

    # By date
    by_date = {}
    for s in submissions:
        date = s['submitted_at'][:10] if s['submitted_at'] else 'Unknown'
        by_date[date] = by_date.get(date, 0) + 1

    # By program + shift (cross-tab)
    by_program_shift = {}
    for s in submissions:
        pname = programs.get(s['program_id'], 'Unknown')
        if pname not in by_program_shift:
            by_program_shift[pname] = {}
        for sid in [s['priority1_shift_id'], s['priority2_shift_id'], s['priority3_shift_id']]:
            sname = shifts_map.get(sid, 'Unknown')
            by_program_shift[pname][sname] = by_program_shift[pname].get(sname, 0) + 1

    return jsonify({
        'total': total,
        'byProgram': by_program,
        'byShift': by_shift,
        'byShiftPriority': by_shift_priority,
        'byDate': by_date,
        'byProgramShift': by_program_shift,
    })


@app.route('/dashboard')
def dashboard_page():
    return send_from_directory('public', 'dashboard.html')


# ── Error handler ────────────────────────────────────────────────────

@app.errorhandler(Exception)
def handle_error(e):
    return jsonify({'error': 'An unexpected error occurred'}), 500


# ── Main ─────────────────────────────────────────────────────────────

if __name__ == '__main__':
    init_db()
    print('Shift Preference Tool starting...')
    port = int(os.environ.get('PORT', 5000))
    print(f'Open your browser to: http://localhost:{port}')
    app.run(host='0.0.0.0', port=port, debug=False)
