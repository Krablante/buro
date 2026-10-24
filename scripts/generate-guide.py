# /// script
# requires-python = ">=3.11"
# dependencies = ["reportlab==5.1.0", "markdown-it-py==3.0.0"]
# ///
"""Build the public bilingual guide. Run with: uv run scripts/generate-guide.py."""

import argparse
from dataclasses import dataclass
from html import escape
from io import BytesIO
import json
import os
from pathlib import Path
import re

from markdown_it import MarkdownIt
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, KeepTogether, PageBreak, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = (("en", "English", "guide.md"), ("ru", "Русский", "guide.ru.md"))
WIDTH, HEIGHT = A4
MARGIN = 45
CONTENT = WIDTH - 2 * MARGIN
PAPER = colors.HexColor("#f7f5f2")
INK = colors.HexColor("#20252d")
DARK = colors.HexColor("#0d1117")
RED = colors.HexColor("#ce273c")
MUTED = colors.HexColor("#69717d")
LINE = colors.HexColor("#d8d9dc")
LIGHT = colors.HexColor("#c9d1d9")
MARKDOWN = MarkdownIt("commonmark").enable("table")


def fonts():
    override = os.environ.get("BURO_PDF_FONTS_DIR")
    directories = [Path(override)] if override else [
        Path("/usr/share/fonts/truetype/freefont"),
        Path("/usr/share/fonts/truetype/dejavu"),
    ]
    for name, filename in (
        ("Guide", "FreeSans.ttf"), ("GuideBold", "FreeSansBold.ttf"),
        ("GuideItalic", "FreeSansOblique.ttf"), ("GuideMono", "DejaVuSansMono.ttf"),
    ):
        path = next((d / filename for d in directories if (d / filename).is_file()), None)
        if path is None:
            raise SystemExit(f"Missing {filename}; install FreeSans/DejaVu fonts or set BURO_PDF_FONTS_DIR")
        pdfmetrics.registerFont(TTFont(name, str(path)))
    pdfmetrics.registerFontFamily(
        "Guide", normal="Guide", bold="GuideBold", italic="GuideItalic", boldItalic="GuideBold"
    )


def style(name, **kwargs):
    settings = dict(fontName="Guide", fontSize=11.2, leading=16, textColor=INK,
                    spaceAfter=10, allowWidows=0, allowOrphans=0)
    settings.update(kwargs)
    return ParagraphStyle(name, **settings)


STYLES = {
    "body": style("body"),
    "title": style("title", fontName="GuideBold", fontSize=30, leading=34, spaceAfter=18),
    "label": style("label", fontName="GuideBold", fontSize=8.4, leading=11,
                   textColor=RED, spaceAfter=24),
    "h2": style("h2", fontName="GuideBold", fontSize=16, leading=20,
                spaceBefore=6, spaceAfter=7, keepWithNext=1),
    "cell": style("cell", fontSize=10.8, leading=15, spaceAfter=0),
    "cellhead": style("cellhead", fontName="GuideBold", fontSize=10.5, leading=14,
                      textColor=RED, spaceAfter=0),
    "quote": style("quote", fontSize=11.2, leading=16, spaceAfter=0),
    "bullet": style("bullet", leftIndent=11, firstLineIndent=-11, spaceAfter=7),
}


def inline(tokens, language, dark=False):
    output = []
    for token in tokens:
        if token.type in ("text", "html_inline"):
            output.append(escape(token.content))
        elif token.type in ("softbreak", "hardbreak"):
            output.append(" " if token.type == "softbreak" else "<br/>")
        elif token.type == "code_inline":
            output.append(f'<font name="GuideMono" size="9.5">{escape(token.content)}</font>')
        elif token.type in ("strong_open", "strong_close", "em_open", "em_close"):
            tag = "b" if token.type.startswith("strong") else "i"
            output.append(f'<{"/" if token.type.endswith("close") else ""}{tag}>')
        elif token.type == "link_open":
            href = token.attrGet("href")
            if href.startswith("#"):
                href = f"#{language}-{href[1:]}"
            output.append(f'<link href="{escape(href, quote=True)}" color="{"#fa7888" if dark else "#b0303e"}">')
        elif token.type == "link_close":
            output.append("</link>")
        else:
            raise ValueError(f"Unsupported inline Markdown: {token.type}")
    return "".join(output)


@dataclass
class Chapter:
    key: str
    title: str
    label: str
    tokens: list


def load_chapters(filename, version):
    text = (ROOT / "docs" / filename).read_text()
    versions = re.findall(r"/releases/download/v([^/]+)/buro-([^/\s]+)\.tgz", text)
    if versions != [(version, version)]:
        raise ValueError(f"Update the install example in {filename} to BURO {version}")
    parts = re.split(r'^<a id="([a-z-]+)"></a>\n\n# (.+?)\s*$', text, flags=re.M)
    chapters = []
    for key, title, body in zip(parts[1::3], parts[2::3], parts[3::3]):
        label, body = body.strip().split("\n\n", 1)
        chapters.append(Chapter(key, title, label.strip("*"), MARKDOWN.parse(body)))
    if not chapters or chapters[0].key != "cover":
        raise ValueError(f"Missing cover in {filename}")
    return chapters


class Destination(Flowable):
    def __init__(self, key, title, pages, level=1):
        super().__init__()
        self.key, self.title, self.pages, self.level = key, title, pages, level
        self.width = self.height = 0

    def draw(self):
        self.pages[self.key] = self.canv.getPageNumber()
        self.canv.bookmarkPage(self.key)
        self.canv.addOutlineEntry(self.title, self.key, level=self.level, closed=False)


class Code(Flowable):
    def __init__(self, text):
        super().__init__()
        self.lines = text.rstrip().splitlines()
        longest = max(pdfmetrics.stringWidth(line, "GuideMono", 1) for line in self.lines)
        self.size = min(9.8, (CONTENT - 32) / max(longest, 1))
        if self.size < 8:
            raise ValueError(f"Code line too long; wrap it in the source: {max(self.lines, key=len)}")
        self.leading = self.size * 1.48
        self.width = CONTENT
        self.height = 28 + self.leading * len(self.lines)
        self.spaceAfter = 14

    def draw(self):
        c = self.canv
        c.setFillColor(DARK)
        c.roundRect(0, 0, self.width, self.height, 5, fill=1, stroke=0)
        c.setFillColor(LIGHT)
        c.setFont("GuideMono", self.size)
        y = self.height - 14 - self.size
        for line in self.lines:
            c.drawString(16, y, line)
            y -= self.leading


def table(tokens, start, language):
    rows, row, heads = [], [], False
    i = start + 1
    while tokens[i].type != "table_close":
        token = tokens[i]
        if token.type == "thead_open":
            heads = True
        elif token.type == "thead_close":
            heads = False
        elif token.type == "tr_open":
            row = []
        elif token.type == "inline":
            row.append(Paragraph(inline(token.children, language), STYLES["cellhead" if heads else "cell"]))
        elif token.type == "tr_close":
            rows.append(row)
        i += 1
    ratios = (0.22, 0.39, 0.39) if len(rows[0]) == 3 else (0.32, 0.68)
    result = Table(rows, colWidths=[CONTENT * n for n in ratios], repeatRows=1, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("LINEBELOW", (0, 0), (-1, -1), 0.45, LINE),
    ]))
    result.spaceAfter = 16
    return result, i + 1


def blocks(tokens, language):
    result, i, bullet = [], 0, False
    while i < len(tokens):
        token = tokens[i]
        if token.type == "paragraph_open":
            text = inline(tokens[i + 1].children, language)
            result.append(Paragraph(("•  " if bullet else "") + text,
                                    STYLES["bullet" if bullet else "body"]))
            i += 3
        elif token.type == "heading_open":
            result.append(Paragraph(inline(tokens[i + 1].children, language), STYLES["h2"]))
            i += 3
        elif token.type == "fence":
            result.append(Code(token.content))
            i += 1
        elif token.type == "table_open":
            item, i = table(tokens, i, language)
            result.append(item)
        elif token.type == "blockquote_open":
            end = next(j for j in range(i + 1, len(tokens)) if tokens[j].type == "blockquote_close")
            content = blocks(tokens[i + 1:end], language)
            for paragraph in content:
                paragraph.style = STYLES["quote"]
            box = Table([[content]], colWidths=[CONTENT])
            box.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1e5e6")),
                ("LINEBEFORE", (0, 0), (-1, -1), 2, RED),
                ("LEFTPADDING", (0, 0), (-1, -1), 13),
                ("RIGHTPADDING", (0, 0), (-1, -1), 13),
                ("TOPPADDING", (0, 0), (-1, -1), 11),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
            ]))
            box.spaceAfter = 14
            result.append(box)
            i = end + 1
        elif token.type in ("bullet_list_open", "bullet_list_close"):
            bullet = token.type.endswith("open")
            i += 1
        elif token.type in ("list_item_open", "list_item_close"):
            i += 1
        else:
            raise ValueError(f"Unsupported block Markdown: {token.type}")
    return result


class Cover(Flowable):
    def __init__(self, chapter, language, version):
        super().__init__()
        self.chapter, self.language, self.version = chapter, language, version
        self.width, self.height = CONTENT, HEIGHT - 106

    def draw(self):
        c = self.canv
        top = self.height

        def paragraph(text, y, **kwargs):
            p = Paragraph(text, style("cover", **{"textColor": LIGHT, **kwargs}))
            _, height = p.wrap(CONTENT, 1000)
            p.drawOn(c, 0, y - height)
            return y - height

        c.setFillColor(LIGHT)
        c.setFont("GuideBold", 8.4)
        c.drawString(0, top - 4, f"{self.chapter.label} / BURO {self.version}")
        c.setFillColor(colors.white)
        c.setFont("GuideBold", 80)
        c.drawString(-2, top - 110, "BURO")
        c.setStrokeColor(RED)
        c.setLineWidth(1)
        c.line(0, top - 143, CONTENT, top - 143)
        tokens = self.chapter.tokens
        y = top - 171
        title = inline(tokens[1].children, self.language, dark=True)
        y = paragraph(title, y, fontName="GuideBold", fontSize=31, leading=37,
                      textColor=colors.white) - 16
        y = paragraph(inline(tokens[4].children, self.language, dark=True), y,
                      fontSize=14, leading=19) - 21
        i = 6
        phases = []
        while i < len(tokens):
            if tokens[i].type == "bullet_list_open":
                phases = [t.content for t in tokens[i:] if t.type == "inline"]
                break
            elif tokens[i].type == "paragraph_open":
                y = paragraph(inline(tokens[i + 1].children, self.language, dark=True),
                              y, fontSize=11.2, leading=16) - 12
                i += 3
            else:
                i += 1
        if y < 145:
            raise ValueError(f"Cover content reaches language navigation: {self.language}")
        language_links = [f'<link href="#{lang}-cover">{escape(name)}</link>'
                          for lang, name, _ in LANGUAGES]
        language_links.append('<link href="#contents">Contents / Оглавление</link>')
        paragraph(" · ".join(language_links), 119, fontSize=10.5, leading=14,
                  textColor=colors.HexColor("#ef6679"))
        phase_width = CONTENT / len(phases)
        for index, phase in enumerate(phases):
            name, description = re.fullmatch(r"\*\*(.+)\*\* - (.+)", phase).groups()
            x = index * phase_width
            c.setFillColor(colors.HexColor("#ef6679"))
            c.setFont("GuideBold", 8.4)
            c.drawString(x, 77, name.upper())
            p = Paragraph(escape(description), style("phase", fontSize=10.5, leading=14,
                                                    textColor=LIGHT))
            _, h = p.wrap(phase_width - 16, 100)
            p.drawOn(c, x, 54 - h)


class Contents(Flowable):
    def __init__(self, chapters, pages, languages):
        super().__init__()
        self.chapters, self.pages, self.languages = chapters, pages, languages
        self.width = CONTENT
        self.height = 574

    def draw(self):
        c = self.canv
        languages = [entry[0] for entry in self.languages]
        column = (CONTENT - 24) / len(languages)
        for index, (_, name, _) in enumerate(self.languages):
            c.setFont("GuideBold", 10.5)
            c.setFillColor(RED)
            c.drawString(24 + index * column, self.height - 6, name)
        y = self.height - 39
        for number, chapter in enumerate(self.chapters[languages[0]][1:], 1):
            c.setFont("GuideMono", 8.4)
            c.setFillColor(MUTED)
            c.drawString(0, y + 1, f"{number:02}")
            row_height = 0
            for index, language in enumerate(languages):
                translated = self.chapters[language][number]
                key = f"{language}-{chapter.key}"
                p = Paragraph(f'<link href="#{key}">{escape(translated.title)}</link>',
                              style("toc", fontSize=10.5, leading=13, spaceAfter=0))
                _, h = p.wrap(column - 31, 100)
                x = 24 + index * column
                p.drawOn(c, x, y + 10 - h)
                c.setFont("GuideMono", 8.5)
                c.setFillColor(RED)
                c.drawRightString(x + column - 9, y + 1, str(self.pages.get(key, "–")))
                c.linkRect("", key, (x, y + 10 - h, x + column - 7, y + 13), relative=1, thickness=0)
                row_height = max(row_height, h)
            c.setStrokeColor(LINE)
            c.setLineWidth(0.4)
            c.line(0, y - row_height + 3, CONTENT, y - row_height + 3)
            y -= row_height + 12
        if y < 0:
            raise ValueError("Contents exceeds one page; adjust its layout")


def build(chapters, version, known_pages):
    stream, actual_pages = BytesIO(), {}
    doc = BaseDocTemplate(stream, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                          topMargin=42, bottomMargin=58,
                          title=f"BURO {version} · {' / '.join(name for _, name, _ in LANGUAGES)}",
                          author="BURO", subject="Typed memory for work objects · Public guide",
                          pageCompression=1)
    frame = Frame(MARGIN, 58, CONTENT, HEIGHT - 100, leftPadding=0,
                  rightPadding=0, topPadding=0, bottomPadding=0, id="page")
    cover_pages = {known_pages.get(f"{lang}-cover", -1) for lang, _, _ in LANGUAGES}
    cover_pages.add(1)

    def background(c, current_doc):
        dark = current_doc.page in cover_pages
        c.saveState()
        c.setFillColor(DARK if dark else PAPER)
        c.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
        c.setStrokeColor(colors.HexColor("#3b434f") if dark else LINE)
        c.setLineWidth(0.45)
        c.line(MARGIN, 44, WIDTH - MARGIN, 44)
        c.setFillColor(LIGHT if dark else MUTED)
        c.setFont("GuideBold", 7.6)
        c.drawString(MARGIN, 27, f"BURO / {version}")
        x = MARGIN + 98
        nav = [(lang.upper(), f"{lang}-cover") for lang, _, _ in LANGUAGES]
        nav.append(("CONTENTS / ОГЛАВЛЕНИЕ", "contents"))
        for text, target in nav:
            w = c.stringWidth(text, "GuideBold", 7.6)
            c.drawString(x, 27, text)
            c.linkRect("", target, (x, 24, x + w, 37), thickness=0)
            x += w + 14
        c.setFont("GuideMono", 7.6)
        total = known_pages.get("total", 0)
        c.drawRightString(WIDTH - MARGIN, 27, f"{current_doc.page:02} / {total:02}")
        c.restoreState()

    doc.addPageTemplates(PageTemplate(id="guide", frames=[frame], onPage=background))
    story = []
    for language, name, _ in LANGUAGES:
        if story:
            story.append(PageBreak())
        cover = chapters[language][0]
        story.extend([Destination(f"{language}-cover", name, actual_pages, 0),
                      Cover(cover, language, version)])
        if language == LANGUAGES[0][0]:
            for start in range(0, len(LANGUAGES), 2):
                key = "contents" if start == 0 else f"contents-{start // 2 + 1}"
                story.extend([
                    PageBreak(), Destination(key, "Contents / Оглавление", actual_pages),
                    Paragraph("READ IN ORDER OR CHOOSE A TOPIC / ВЫБЕРИТЕ ТЕМУ", STYLES["label"]),
                    Paragraph("contents / оглавление", STYLES["title"]),
                    Paragraph("Choose a language and topic. Click a title or use the PDF bookmarks.<br/>"
                              "Выберите язык и тему. Названия глав и закладки PDF кликабельны.",
                              STYLES["body"]), Spacer(1, 14),
                    Contents(chapters, known_pages, LANGUAGES[start:start + 2]),
                ])
        for chapter in chapters[language][1:]:
            content = blocks(chapter.tokens, language)
            story.extend([
                PageBreak(), Destination(f"{language}-{chapter.key}", chapter.title, actual_pages),
                KeepTogether([Paragraph(chapter.label, STYLES["label"]),
                              Paragraph(chapter.title, STYLES["title"]), content[0]]),
                *content[1:],
            ])
    doc.build(story, canvasmaker=lambda *a, **kw: Canvas(*a, **{**kw, "invariant": 1}))
    actual_pages["total"] = doc.page
    return stream.getvalue(), actual_pages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if the committed PDF needs rebuilding")
    args = parser.parse_args()
    fonts()
    version = json.loads((ROOT / "package.json").read_text())["version"]
    chapters = {lang: load_chapters(filename, version) for lang, _, filename in LANGUAGES}
    keys = [[chapter.key for chapter in items] for items in chapters.values()]
    if any(key != keys[0] for key in keys[1:]) or len(set(keys[0])) != len(keys[0]):
        raise SystemExit("Guide languages must have the same unique chapter IDs in the same order")
    _, pages = build(chapters, version, {})
    output, final_pages = build(chapters, version, pages)
    if final_pages != pages:
        raise SystemExit("Page layout changed between passes; inspect the contents layout")
    path = ROOT / "docs" / "guide.pdf"
    if args.check:
        if not path.is_file() or path.read_bytes() != output:
            raise SystemExit("docs/guide.pdf is stale; run uv run scripts/generate-guide.py")
        print(f"Guide is current: {pages['total']} pages, {len(output):,} bytes")
    else:
        path.write_bytes(output)
        print(f"Wrote {path.relative_to(ROOT)}: {pages['total']} pages, {len(output):,} bytes")


if __name__ == "__main__":
    main()
