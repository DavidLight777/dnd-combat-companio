import sqlite3
conn = sqlite3.connect('data/combat_companion.db')
c = conn.cursor()
c.execute("SELECT version_num FROM alembic_version")
for row in c.fetchall():
    print(row[0])
conn.close()
