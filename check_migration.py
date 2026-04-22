import sqlite3
conn = sqlite3.connect('data/combat_companion.db')
c = conn.cursor()
# Check if migration already applied
c.execute("SELECT version_num FROM alembic_version WHERE version_num = 'abe27be90628'")
print('applied?', bool(c.fetchone()))
# Check if column exists
c.execute("PRAGMA table_info(map_floors)")
cols = [r[1] for r in c.fetchall()]
print('columns:', cols)
conn.close()
