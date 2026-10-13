#!/usr/bin/env node
// General-purpose Markdown -> print-ready A4 PDF converter.
// Built for interview-prep notes: any fenced-code language gets real
// syntax highlighting, ASCII box/arrow diagrams keep exact alignment,
// and ```mermaid blocks render as real flowchart/sequence/architecture
// diagrams instead of literal text.
//
// Usage:
//   md2pdf <input.md> [output.pdf] [--portrait]
//
// If output.pdf is omitted, it's written next to the input file with
// the same name (.md -> .pdf). Relative image paths in the markdown
// resolve against the input file's own folder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2).filter((a) => a !== '--portrait' && a !== '--help' && a !== '-h');
const portrait = process.argv.includes('--portrait');
const help = process.argv.includes('--help') || process.argv.includes('-h');

if (help || args.length < 1) {
  console.log(`md2pdf - Markdown to print-ready A4 PDF

Usage:
  md2pdf <input.md> [output.pdf] [--portrait]

Arguments:
  input.md     Path to the markdown file to convert
  output.pdf   Optional. Defaults to <input>.pdf next to the input file

Options:
  --portrait   Use A4 portrait instead of the default A4 landscape
  -h, --help   Show this help

Features:
  - Any fenced code language (\`\`\`python, \`\`\`java, ...) gets real syntax highlighting
  - \`\`\`mermaid blocks render as real diagrams (flowcharts, sequence diagrams, etc.)
  - ASCII box/arrow diagrams keep exact character alignment, never wrapped
  - Relative image paths resolve against the input file's folder`);
  process.exit(help ? 0 : 1);
}

const inputPath = path.resolve(args[0]);
const outputPath = path.resolve(
  args[1] || path.join(path.dirname(inputPath), path.basename(inputPath, path.extname(inputPath)) + '.pdf')
);
const inputDir = path.dirname(inputPath).replace(/\\/g, '/');

// Characters that only show up in intentionally-drawn ASCII art
// (box-drawing, arrows, block markers). If a fenced block with no
// language tag (or an unrecognized one) contains any of these, treat
// it as a diagram: never wrap it, only ever shrink it to fit the page.
// Otherwise treat it as plain pseudocode, which is safe to word-wrap.
const DIAGRAM_CHARS = /[╔╗╚╝╠╣╦╩╬═║─│┌┐└┘▲▼◄►➜⬇⬆↑↓→←]/;

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let mermaidCount = 0;

const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  highlight(code, lang) {
    const normalizedLang = (lang || '').toLowerCase().trim();

    if (normalizedLang === 'mermaid') {
      mermaidCount++;
      return `<div class="mermaid">${escapeHtml(code)}</div>`;
    }

    if (normalizedLang && hljs.getLanguage(normalizedLang)) {
      try {
        const highlighted = hljs.highlight(code, { language: normalizedLang }).value;
        return `<pre class="code-block lang-real"><code>${highlighted}</code></pre>`;
      } catch (e) {
        return `<pre class="code-block lang-real"><code>${escapeHtml(code)}</code></pre>`;
      }
    }

    const isDiagram = DIAGRAM_CHARS.test(code);
    const cls = isDiagram ? 'code-block diagram' : 'code-block pseudo';
    return `<pre class="${cls}"><code>${escapeHtml(code)}</code></pre>`;
  },
});

const raw = fs.readFileSync(inputPath, 'utf8');
const bodyHtml = md.render(raw);

const pageSize = portrait
  ? { css: 'A4 portrait', margin: '0.6in 0.7in', width: '6.9in' }
  : { css: 'A4 landscape', margin: '0.55in 0.6in', width: '10.4in' };

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<base href="file:///${inputDir}/">
<style>
  @page {
    size: ${pageSize.css};
    margin: ${pageSize.margin};
  }

  :root {
    --prose-font: "Segoe UI", "Calibri", "Georgia", sans-serif;
    --mono-font: "Cascadia Mono", "Consolas", "DejaVu Sans Mono", "Courier New", monospace;
  }

  * { box-sizing: border-box; }

  body {
    font-family: var(--prose-font);
    font-size: 11.5pt;
    line-height: 1.5;
    color: #1a1a1a;
    max-width: ${pageSize.width};
    margin: 0 auto;
  }

  h1 {
    font-size: 20pt;
    margin-top: 0;
    padding-top: 0.15in;
    border-bottom: 2px solid #2b3a55;
    page-break-before: always;
  }
  body > h1:first-of-type { page-break-before: avoid; }

  h2 {
    font-size: 15pt;
    margin-top: 22px;
    color: #2b3a55;
    page-break-after: avoid;
  }

  h3 { font-size: 13pt; page-break-after: avoid; }

  p, li { orphans: 3; widows: 3; }

  img { max-width: 100%; page-break-inside: avoid; }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 9.5pt;
    margin: 10px 0 16px;
  }
  th, td {
    border: 1px solid #c7cdd6;
    padding: 5px 7px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #eef1f6; }
  tr { page-break-inside: avoid; }

  code {
    font-family: var(--mono-font);
  }

  /* inline code (single backtick) */
  p code, li code, td code {
    background: #eef0f4;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.92em;
  }

  /* Long unbreakable text (commands, paths, URLs) must wrap: anything wider
     than the page makes Chrome shrink the whole document to fit it. */
  :not(pre) > code { overflow-wrap: anywhere; }
  p, li, td, th, blockquote { overflow-wrap: break-word; }

  pre.code-block {
    font-family: var(--mono-font);
    font-size: 9.5pt;
    line-height: 1.42;
    padding: 10px 12px;
    border-radius: 5px;
    margin: 10px 0 16px;
    tab-size: 4;
  }

  /* Real, recognized-language code — syntax highlighted, safe to wrap long comments */
  pre.lang-real {
    background: #f6f8fa;
    border: 1px solid #d7dce3;
    border-left: 4px solid #2b3a55;
    white-space: pre-wrap;
    word-break: break-word;
    page-break-inside: avoid;
  }

  /* Plain pseudocode / unlabeled snippets — no highlighting needed, safe to wrap */
  pre.pseudo {
    background: #fbfbf9;
    border: 1px solid #e3e0d5;
    border-left: 4px solid #a9a28a;
    white-space: pre-wrap;
    word-break: break-word;
    page-break-inside: avoid;
  }

  /* ASCII box/arrow diagrams — alignment is the content, NEVER wrap.
     Oversized ones get shrunk to fit by the post-render pass below. */
  pre.diagram {
    background: #f4f6fb;
    border: 1px solid #ccd4e3;
    border-left: 4px solid #5a7ab0;
    white-space: pre;
    overflow: hidden;
    page-break-inside: avoid;
  }
  pre.diagram > code {
    display: inline-block;
    transform-origin: top left;
  }

  pre.code-block code {
    background: none;
    padding: 0;
    border-radius: 0;
  }

  /* Mermaid diagrams render as SVG here; center them and let the
     shrink-to-fit pass handle anything wider than the page. */
  div.mermaid {
    text-align: center;
    margin: 14px 0;
    page-break-inside: avoid;
  }
  div.mermaid svg {
    max-width: 100%;
  }

  hr { border: none; border-top: 1px solid #d7dce3; margin: 20px 0; }

  blockquote {
    border-left: 4px solid #d7dce3;
    margin: 10px 0;
    padding: 2px 14px;
    color: #444;
  }

  /* highlight.js theme tuned for print (light background) */
  .hljs-comment, .hljs-quote { color: #6a7280; font-style: italic; }
  .hljs-keyword, .hljs-selector-tag, .hljs-literal { color: #a626a4; }
  .hljs-string, .hljs-doctag { color: #1a7f37; }
  .hljs-number { color: #b35900; }
  .hljs-title, .hljs-section, .hljs-built_in, .hljs-type { color: #005cc5; }
  .hljs-class .hljs-title { color: #005cc5; }
  .hljs-variable, .hljs-attr, .hljs-params { color: #953800; }
  .hljs-function .hljs-title { color: #6f42c1; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

const htmlPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'md2pdf-')), '_build.html');
fs.writeFileSync(htmlPath, html, 'utf8');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('file://' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });

  if (mermaidCount > 0) {
    await page.addScriptTag({ path: require.resolve('mermaid/dist/mermaid.min.js') });
    await page.evaluate(async () => {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
      await mermaid.run({ querySelector: '.mermaid' });
    });
    await page.waitForFunction(
      (expected) => document.querySelectorAll('div.mermaid svg').length >= expected,
      { timeout: 30000 },
      mermaidCount
    );
  }

  // Shrink any diagram/mermaid block wider than the printable page area
  // instead of letting it wrap (destroys ASCII alignment) or get
  // silently clipped at the page edge.
  await page.evaluate(() => {
    document.querySelectorAll('pre.diagram').forEach((pre) => {
      const code = pre.querySelector('code');
      const available = pre.clientWidth - 4;
      const natural = code.scrollWidth;
      if (natural > available) {
        const scale = Math.max(available / natural, 0.35);
        code.style.transform = `scale(${scale})`;
        const naturalHeight = code.scrollHeight;
        pre.style.height = (naturalHeight * scale + 20) + 'px';
      }
    });

    document.querySelectorAll('div.mermaid svg').forEach((svg) => {
      const container = svg.closest('div.mermaid');
      const available = container.clientWidth;
      const rect = svg.getBoundingClientRect();
      if (rect.width > available) {
        const scale = Math.max(available / rect.width, 0.3);
        svg.style.transform = `scale(${scale})`;
        svg.style.transformOrigin = 'top center';
        container.style.height = (rect.height * scale + 10) + 'px';
      }
    });
  });

  await page.pdf({
    path: outputPath,
    format: 'A4',
    landscape: !portrait,
    printBackground: true,
    margin: portrait
      ? { top: '0.6in', bottom: '0.6in', left: '0.7in', right: '0.7in' }
      : { top: '0.55in', bottom: '0.55in', left: '0.6in', right: '0.6in' },
  });

  await browser.close();
  fs.rmSync(path.dirname(htmlPath), { recursive: true, force: true });
  console.log('Wrote', outputPath);
})();
