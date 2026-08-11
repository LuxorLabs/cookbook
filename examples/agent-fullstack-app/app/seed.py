"""Seed the app's data. Creates a SQLite DB the backend serves from.

Stdlib only — no network, no pip install. Runs inside the sandbox.
"""
import sqlite3

DB = "/home/tenki/app.db"

TASKS = [
    ("Write the launch post", "done"),
    ("Verify the sandbox demo", "doing"),
    ("Seed the database", "done"),
    ("Ship the cookbook example", "doing"),
    ("Review inbound applications", "todo"),
]

conn = sqlite3.connect(DB)
conn.execute("DROP TABLE IF EXISTS tasks")
conn.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL)")
conn.executemany("INSERT INTO tasks (title, status) VALUES (?, ?)", TASKS)
conn.commit()
print(f"seeded {conn.execute('SELECT COUNT(*) FROM tasks').fetchone()[0]} tasks into {DB}")
conn.close()
