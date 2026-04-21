# Disk Cleaner

A local web app for visualising and cleaning large files on macOS.

## Features

- **Treemap graph view** — D3.js treemap where block area = file size. Click folders to drill in, click files to select.
- **Nested list view** — tree-table grouping files under their parent folders, collapsible.
- **Safety classifier** — every file is rated Safe / Review / Risky based on path and extension.
- **Delete All Safe** — one-click to free space from caches, logs, temp files, and downloads.
- **Reveal in Finder** — jump straight to any file in macOS Finder.
- **Copy path** — copy any file path to clipboard with one click.
- **Safety filter** — filter the list by Safe / Review / Risky.
- **Bulk delete** — checkbox-select files across views, delete with a single confirmation.

## Quick Start

```bash
cd disk-cleaner
npm install
node server.js
# → http://localhost:3456
```

## Usage

1. Enter a folder path (defaults to your home directory).
2. Choose a minimum file size and scan depth.
3. Click **Scan**.
4. Switch between **Graph** and **List** views with the toggle in the top-right.
5. Select files and click **Delete Selected**, or use **Delete All Safe Files** to auto-clean.

## Safety Levels

| Level  | Colour | Meaning |
|--------|--------|---------|
| Safe   | Green  | Caches, logs, temp files, installers in Downloads — safe to remove |
| Review | Yellow | Documents, media, archives outside Downloads — verify before deleting |
| Risky  | Red    | System files, `.plist`, `.dylib`, inside `.app` bundles — do not delete |

## Stack

- **Backend** — Node.js + Express (no database, no build step)
- **Frontend** — Vanilla HTML/CSS/JS + [D3.js v7](https://d3js.org)
