import sqlite3
conn = sqlite3.connect('data/combat_companion.db')
c = conn.cursor()
c.execute("DELETE FROM alembic_version")
c.execute("INSERT INTO alembic_version (version_num) VALUES ('924b67782e86')")
conn.commit()
conn.close()
print('Alembic version restored to 924b67782e86')
