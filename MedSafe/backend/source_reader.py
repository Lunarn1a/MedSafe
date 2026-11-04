"""Fetch and parse one public DDInter record without executing page content."""
from html.parser import HTMLParser
import re
from urllib.request import Request, urlopen


class TableReader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.cells, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.cells = []
        elif tag in ("td", "th") and self.cells is not None:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.cells.append(" ".join(" ".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.cells is not None:
            if len(self.cells) >= 2:
                self.rows.append(self.cells)
            self.cells = None


def parse_source(html, expected_ids):
    reader = TableReader()
    reader.feed(html)
    fields = {row[0]: row[1] for row in reader.rows}
    ids = sorted(re.findall(r"DDInter\d+", fields.get("ID", "")))
    if ids != sorted(expected_ids) or len(ids) != 2:
        raise ValueError("The source page does not match the two reference drug IDs.")
    interaction = fields.get("Interaction", "")
    if len(interaction.split()) < 5 or len(interaction) > 50000:
        raise ValueError("No usable interaction explanation in this source record.")
    return {"interaction": interaction, "management": fields.get("Management", "-"), "verified_source_ids": ids}


def fetch_source(url, expected_ids, timeout=5):
    if not re.fullmatch(r"https://ddinter2\.scbdd\.com/server/interact/\d+/", url):
        raise ValueError("Unexpected source URL.")
    request = Request(url, headers={"User-Agent": "MedSafe-academic-source-review/1.0"})
    with urlopen(request, timeout=timeout) as response:
        if not response.geturl().startswith("https://ddinter2.scbdd.com/server/interact/"):
            raise ValueError("Unexpected source redirect.")
        body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ValueError("Source response exceeds the size limit.")
    return parse_source(body.decode("utf-8-sig"), expected_ids)
