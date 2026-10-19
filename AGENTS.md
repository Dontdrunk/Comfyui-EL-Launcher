# 探索者启动器 — agent notes

## Browser / scraping policy (user directive, 2026-10-15)

Any task that calls a browser to fetch, render, crawl or scrape data must use
**Lightpanda** — the AI-native headless browser — instead of Chrome/Chromium,
full Playwright/Puppeteer with a downloaded Chromium, or a bare HTTP GET when the
page needs JavaScript.

- Docs: <https://lightpanda.io/> · Source: <https://github.com/lightpanda-io/browser>
- Full reference: the `lightpanda` skill in `~/.dsh/skills/lightpanda/SKILL.md`
- No native Windows build — it runs inside WSL Ubuntu:

      wsl.exe -e /home/dontdrunk/.local/bin/lightpanda fetch --dump markdown <url>

  (or just `lightpanda <args>` — shim `C:\Users\Dontdrunk\.local\bin\lightpanda.cmd`, already on PATH)
