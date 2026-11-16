"""Export the existing PUBLIC SQLite address index to D1-compatible SQL locally.

No network calls or user coordinates. Source is opened read-only; Java files stay intact.
Usage: python scripts/export-address-index.py PUBLIC_INDEX.sqlite OUTPUT.sql
Import into the optional ADDRESS_DB only in a later, authorized deployment stage.
"""
import pathlib
import sqlite3
import sys

source = pathlib.Path(sys.argv[1]).resolve(strict=True)
target = pathlib.Path(sys.argv[2]).resolve()
if source == target or target.exists():
    raise SystemExit("Output must be a new file distinct from the source index")
schema = pathlib.Path(__file__).resolve().parents[1] / "address" / "schema.sql"
with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as db, target.open("x", encoding="utf-8") as out:
    out.write(schema.read_text(encoding="utf-8") + "\n")
    for place_id, name, address, shape in db.execute("SELECT id,name,address,shape FROM place"):
        quote = lambda s: "'" + s.replace("'", "''") + "'"
        statement = f"INSERT INTO place VALUES({place_id},{quote(name)},{quote(address)},X'{shape.hex()}');\n"
        if len(statement.encode("utf-8")) > 100_000:
            raise SystemExit("Geometry exceeds D1 SQL statement limit; output is incomplete. Use a smaller regional dataset.")
        out.write(statement)
    for row in db.execute("SELECT id,west,east,south,north FROM bounds"):
        out.write("INSERT INTO bounds VALUES(" + ",".join(map(str, row)) + ");\n")
print("Exported public address index; no remote import performed.")
