# Auto Web Screenshot

This project is a Node.js script that crawls a website and saves full-page screenshots of each discovered URL. It first tries to read the site's XML sitemaps and falls back to a lightweight HTML link crawler when no sitemap is present. Screenshots are stored by date in the `screens/` directory and processed URLs are logged in `done.txt` so that repeated runs skip pages that are already captured.

## Setup

1. Install Node.js (version 18 or later).
2. Install the project dependencies:
   ```bash
   npm install
   ```
3. Configure the base URL you want to capture. Copy `.env.example` to `.env` and edit `ROOT_URL`:
   ```env
   ROOT_URL=https://example.com
   ```
   You can also export `ROOT_URL` in your shell instead of using a `.env` file.

## Running

Execute the script with Node.js:

```bash
node huelShot.js
```

Screenshots will appear in `screens/YYYY-MM-DD/` (one folder per run). The script maintains `done.txt` so previously captured pages are not visited again.
