"""Build Flowad's local address index from an OpenStreetMap extract."""

import argparse
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile

import osmium
from shapely import from_wkb
from shapely.geometry import Point


def road_address(tags):
    street = tags.get("addr:street", "").strip()
    number = tags.get("addr:housenumber", "").strip()
    if not street or not number:
        return ""
    return " ".join(filter(None, (tags.get("addr:city", "").strip(), street, number)))


class AddressHandler(osmium.SimpleHandler):
    def __init__(self, database):
        super().__init__()
        self.database = database
        self.geometry = osmium.geom.WKBFactory()
        self.count = 0

    def insert(self, name, address, shape):
        if shape.is_empty or not shape.is_valid:
            return
        row = self.database.execute(
            "INSERT INTO place (name, address, shape) VALUES (?, ?, ?)", (name, address, shape.wkb)
        )
        west, south, east, north = shape.bounds
        self.database.execute(
            "INSERT INTO bounds VALUES (?, ?, ?, ?, ?)", (row.lastrowid, west, east, south, north)
        )
        self.count += 1

    def node(self, node):
        address = road_address(node.tags)
        if address and node.location.valid():
            self.insert("", address, Point(node.location.lon, node.location.lat))

    def area(self, area):
        building = area.tags.get("building")
        if not building or building in {"no", "construction", "proposed"}:
            return
        name = (area.tags.get("name:ko") or area.tags.get("name") or "").strip()
        address = road_address(area.tags)
        if name or address:
            try:
                shape = from_wkb(bytes.fromhex(self.geometry.create_multipolygon(area)))
            except (RuntimeError, ValueError):
                return
            self.insert(name, address, shape)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="South Korea .osm.pbf extract")
    parser.add_argument("output", type=Path, help="SQLite index path")
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        parser.error("the source and output must be different files")
    with tempfile.NamedTemporaryFile(dir=args.output.parent, suffix=".sqlite", delete=False) as file:
        temporary = Path(file.name)
    try:
        with closing(sqlite3.connect(temporary)) as database:
            database.executescript("""
                CREATE TABLE place (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                                    address TEXT NOT NULL, shape BLOB NOT NULL);
                CREATE VIRTUAL TABLE bounds USING rtree(id, west, east, south, north);
            """)
            handler = AddressHandler(database)
            handler.apply_file(str(args.source), locations=True,
                               filters=[osmium.filter.KeyFilter("building", "addr:street")])
            if not handler.count:
                parser.error("no buildings or road addresses found")
            database.commit()
        temporary.replace(args.output)
        print(f"Indexed {handler.count:,} buildings and address points.")
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
