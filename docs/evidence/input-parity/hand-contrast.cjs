// node hand-contrast.cjs <Playwright> <Chrome> <Vite origin> <screenshot.png>
// Measure the enabled cards in the privately revealed Shared table drawer.
const { chromium } = require(process.argv[2]);
const [executablePath, origin, screenshot] = process.argv.slice(3);
const assert = require("node:assert/strict");

async function run() {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.goto(new URL("/setup/multiplayer", origin).href);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Ready · Reveal my hand" }).click();
    await page.getByRole("button", { name: "Turn details" }).click();
    const cards = page.getByLabel("player-1 hand").getByRole("button");
    await cards.first().click();
    const results = await cards.evaluateAll(buttons => {
      const rgb = color => color.match(/[\d.]+/g).map(Number);
      function intensity(color) {
        const linear = rgb(color).slice(0,3).map(n => n / 255)
          .map(n => n <= 0.04045 ? n/12.92 : ((n + 0.055)/1.055)**2.4);
        return linear[0]*0.2126 + linear[1]*0.7152 + linear[2]*0.0722;
      }
      return buttons.filter(button => !button.disabled).map(button => {
        const style = getComputedStyle(button);
        let background = style.backgroundColor;
        let parent = button.parentElement;
        while (rgb(background)[3] === 0 && parent) {
          background = getComputedStyle(parent).backgroundColor;
          parent = parent.parentElement;
        }
        const foreground = intensity(style.color), behind = intensity(background);
        return { label: button.textContent.trim(), color: style.color, background,
          ratio: (Math.max(foreground,behind)+0.05)/(Math.min(foreground,behind)+0.05) };
      });
    });
    await page.screenshot({ path: screenshot });
    console.log(JSON.stringify(results));
    assert.ok(results.length >= 2 && results.every(card => card.ratio >= 4.5),
      "Enabled private hand labels must be readable against their button surface.");
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
