import { marked } from 'marked';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';

const BASE_DIR = '/Users/evan/Desktop/技术/risk control';
const MD_PATH = `${BASE_DIR}/product-business-simple.md`;
const HTML_PATH = `${BASE_DIR}/_business_simple_temp.html`;
const PDF_NAME = 'RiskControl-产品需求与业务逻辑说明-简版.pdf';
const PDF_PATH = `${BASE_DIR}/${PDF_NAME}`;
const DESKTOP_PDF_PATH = `${os.homedir()}/Desktop/${PDF_NAME}`;
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const mdRaw = fs.readFileSync(MD_PATH, 'utf-8');
const htmlContent = marked.parse(mdRaw);

const styledHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>RiskControl 产品需求与业务逻辑说明（简版）</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
    font-size: 11pt;
    line-height: 1.65;
    color: #1a1a1a;
    background: #ffffff;
  }
  h1, h2, h3, h4 {
    color: #0b1a3b;
    font-weight: 700;
    page-break-after: avoid;
  }
  h1 {
    font-size: 22pt;
    border-bottom: 3px solid #2563eb;
    padding-bottom: 10px;
    margin-top: 0;
    margin-bottom: 18px;
  }
  h2 {
    font-size: 15.5pt;
    border-left: 5px solid #2563eb;
    padding-left: 10px;
    margin-top: 26px;
    margin-bottom: 10px;
  }
  h3 {
    font-size: 12.5pt;
    color: #1e3a8a;
    margin-top: 18px;
    margin-bottom: 6px;
  }
  h4 { font-size: 11pt; margin-top: 12px; }
  p { margin: 6px 0 10px 0; text-align: justify; }
  blockquote {
    margin: 10px 0;
    padding: 9px 12px 9px 14px;
    background: #fff7ed;
    border-left: 4px solid #f59e0b;
    color: #78350f;
    font-size: 10.5pt;
    page-break-inside: avoid;
  }
  code {
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 10pt;
    background: #f1f5f9;
    color: #be123c;
    padding: 1.5px 5px;
    border-radius: 4px;
  }
  pre {
    background: #0f172a;
    color: #e2e8f0;
    padding: 12px 14px;
    border-radius: 6px;
    font-size: 9.5pt;
    line-height: 1.45;
    page-break-inside: avoid;
    overflow-x: auto;
  }
  pre code { background: transparent; color: inherit; padding: 0; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 16px 0;
    font-size: 10pt;
    page-break-inside: avoid;
  }
  thead { display: table-header-group; }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 7px 9px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: linear-gradient(135deg, #1e3a8a, #2563eb);
    color: #ffffff;
    font-weight: 600;
  }
  tbody tr:nth-child(even) { background: #f8fafc; }
  ul, ol { padding-left: 22px; margin: 6px 0 10px 0; }
  li { margin: 3px 0; }
  hr {
    border: none;
    border-top: 1.5px dashed #94a3b8;
    margin: 20px 0;
  }
  strong { color: #0b1a3b; }
  a { color: #2563eb; text-decoration: none; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>
${htmlContent}
</body>
</html>`;

fs.writeFileSync(HTML_PATH, styledHtml, 'utf-8');
console.log('[1/3] HTML generated:', HTML_PATH);

const chromeArgs = [
  `'${CHROME_PATH}'`,
  '--headless=new',
  '--disable-gpu',
  '--no-pdf-header-footer',
  '--no-sandbox',
  '--hide-scrollbars',
  '--virtual-time-budget=2000',
  `--print-to-pdf='${PDF_PATH}'`,
  `'file://${HTML_PATH}'`,
].join(' ');

try {
  execSync(chromeArgs, { stdio: 'ignore' });
  console.log('[2/3] PDF saved:', PDF_PATH);
} catch (e) {
  console.error('Chrome PDF failed.');
  process.exit(1);
}

try { fs.unlinkSync(HTML_PATH); } catch (_) {}

console.log('[3/3] Copying PDF to Desktop...');
try {
  fs.copyFileSync(PDF_PATH, DESKTOP_PDF_PATH);
  console.log('✅ PDF on Desktop:', DESKTOP_PDF_PATH);
} catch (e) {
  console.warn('Copy to Desktop failed. PDF at:', PDF_PATH);
}
