#!/usr/bin/env python3
"""Generates index-full.html: index.html with style.css and the scripts inlined into a single file."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "index-full.html"


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


def inline_css(m):
    css = read(m.group(1)).replace("</style", "<\\/style")
    return f"<style>\n{css}\n</style>"


def inline_js(m):
    js = read(m.group(1)).replace("</script", "<\\/script").replace("<!--", "<\\!--")
    return f"<script>\n{js}\n</script>"


html = read("index.html")
html = re.sub(r'<link rel="stylesheet" href="(?!https?:)([^"]+)">', inline_css, html)
html = re.sub(r'<script src="(?!https?:)([^"]+)"></script>', inline_js, html)

OUT.write_text(html, encoding="utf-8")
print(f"{OUT.name}: {len(html.encode()) // 1024} KB")
