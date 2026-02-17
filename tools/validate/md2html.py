#!/usr/bin/env python3
"""Convert a Markdown file to a self-contained GitHub-styled HTML file and open it."""

import html
import re
import sys
import os
import tempfile
import subprocess


def md_to_html(md: str) -> str:
    """Minimal Markdown-to-HTML converter (no dependencies)."""
    lines = md.split("\n")
    out = []
    in_code = False
    in_table = False
    in_ul = False
    in_ol = False
    in_details = False
    code_lang = ""

    i = 0
    while i < len(lines):
        line = lines[i]

        # Fenced code blocks
        if line.startswith("```"):
            if not in_code:
                code_lang = line[3:].strip()
                cls = f' class="language-{code_lang}"' if code_lang else ""
                out.append(f"<pre><code{cls}>")
                in_code = True
            else:
                out.append("</code></pre>")
                in_code = False
            i += 1
            continue

        if in_code:
            out.append(html.escape(line))
            i += 1
            continue

        # Blank line
        if not line.strip():
            if in_table:
                out.append("</tbody></table>")
                in_table = False
            if in_ul:
                out.append("</ul>")
                in_ul = False
            if in_ol:
                out.append("</ol>")
                in_ol = False
            out.append("")
            i += 1
            continue

        # <details> / <summary> passthrough
        if line.strip().startswith("<details") or line.strip().startswith("</details"):
            if in_table:
                out.append("</tbody></table>")
                in_table = False
            out.append(line)
            i += 1
            continue
        if line.strip().startswith("<summary"):
            out.append(line)
            i += 1
            continue

        # Headings
        m = re.match(r"^(#{1,6})\s+(.*)", line)
        if m:
            if in_table:
                out.append("</tbody></table>")
                in_table = False
            level = len(m.group(1))
            text = inline(m.group(2))
            slug = re.sub(r"[^a-z0-9\- ]", "", m.group(2).lower()).strip().replace(" ", "-")
            out.append(f'<h{level} id="{slug}">{text}</h{level}>')
            i += 1
            continue

        # Horizontal rule
        if re.match(r"^---+\s*$", line):
            if in_table:
                out.append("</tbody></table>")
                in_table = False
            out.append("<hr>")
            i += 1
            continue

        # Table
        if "|" in line and not line.startswith("    "):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if not in_table:
                # Check if next line is separator
                if i + 1 < len(lines) and re.match(r"^\|?[\s\-:|]+\|", lines[i + 1]):
                    out.append('<table><thead><tr>')
                    for c in cells:
                        out.append(f"<th>{inline(c)}</th>")
                    out.append("</tr></thead><tbody>")
                    in_table = True
                    i += 2  # skip separator
                    continue
            else:
                out.append("<tr>")
                for c in cells:
                    out.append(f"<td>{inline(c)}</td>")
                out.append("</tr>")
                i += 1
                continue

        # Ordered list
        m = re.match(r"^(\d+)\.\s+(.*)", line)
        if m:
            if in_table:
                out.append("</tbody></table>")
                in_table = False
            if not in_ol:
                out.append("<ol>")
                in_ol = True
            out.append(f"<li>{inline(m.group(2))}</li>")
            i += 1
            continue

        # Unordered list
        m = re.match(r"^[\-\*]\s+(.*)", line)
        if m:
            if in_table:
                out.append("</tbody></table>")
                in_table = False
            if not in_ul:
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{inline(m.group(1))}</li>")
            i += 1
            continue

        # Paragraph
        if in_ul:
            out.append("</ul>")
            in_ul = False
        out.append(f"<p>{inline(line)}</p>")
        i += 1

    if in_table:
        out.append("</tbody></table>")
    if in_ul:
        out.append("</ul>")
    if in_ol:
        out.append("</ol>")

    return "\n".join(out)


def inline(text: str) -> str:
    """Process inline markdown: bold, italic, code, links."""
    # Escape HTML first (but preserve already-valid tags)
    # Bold + italic
    text = re.sub(r"\*\*\*(.+?)\*\*\*", r"<strong><em>\1</em></strong>", text)
    # Bold
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    # Italic
    text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
    # Inline code
    text = re.sub(r"`([^`]+)`", lambda m: f"<code>{html.escape(m.group(1))}</code>", text)
    # Links
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    return text


CSS = """
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  max-width: 960px;
  margin: 40px auto;
  padding: 0 20px;
  color: #1f2328;
  line-height: 1.6;
  background: #fff;
}
h1 { border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
h2 { border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; margin-top: 2em; }
h3 { margin-top: 1.5em; }
hr { border: none; border-top: 1px solid #d1d9e0; margin: 2em 0; }
code {
  background: #f0f3f6;
  padding: 0.2em 0.4em;
  border-radius: 6px;
  font-size: 85%;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
pre {
  background: #f6f8fa;
  border: 1px solid #d1d9e0;
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
  line-height: 1.45;
}
pre code {
  background: none;
  padding: 0;
  font-size: 85%;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}
th, td {
  border: 1px solid #d1d9e0;
  padding: 8px 13px;
  text-align: left;
}
th { background: #f6f8fa; font-weight: 600; }
tr:nth-child(even) { background: #f6f8fa; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
details { margin: 1em 0; }
summary { cursor: pointer; font-weight: 600; color: #0969da; }
li { margin: 0.25em 0; }
strong { font-weight: 600; }
.pass { color: #1a7f37; font-weight: 600; }
.fail { color: #cf222e; font-weight: 600; }
"""


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <markdown-file> [--no-open]")
        sys.exit(1)

    md_path = sys.argv[1]
    no_open = "--no-open" in sys.argv

    with open(md_path, "r") as f:
        md_content = f.read()

    body = md_to_html(md_content)

    # Post-process: highlight PASS/FAIL in table cells
    body = re.sub(r"<td>PASS", '<td><span class="pass">PASS</span>', body)
    body = re.sub(r"\*\*PASS\*\*", '<span class="pass">PASS</span>', body)
    body = re.sub(r"<td>FAIL", '<td><span class="fail">FAIL</span>', body)
    body = re.sub(r"\*\*FAIL\*\*", '<span class="fail">FAIL</span>', body)

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fleet Validation Report</title>
<style>{CSS}</style>
</head>
<body>
{body}
</body>
</html>"""

    # Write next to the markdown file
    out_path = os.path.splitext(md_path)[0] + ".html"
    with open(out_path, "w") as f:
        f.write(html_content)

    print(f"Written: {out_path}")

    if not no_open:
        subprocess.run(["open", out_path])
        print("Opened in browser.")


if __name__ == "__main__":
    main()
