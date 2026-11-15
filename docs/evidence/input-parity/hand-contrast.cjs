// node hand-contrast.cjs <Playwright> <Chrome> <Vite origin> <screenshot.png>
const { chromium } = require(process.argv[2]);
const [executablePath, origin, screenshot] = process.argv.slice(3);
const assert = require("node:assert/strict");

/** Runs in Chrome. Card names are direct text nodes and family labels are <small>. */
function measure(buttons) {
  const rgb = color => color.match(/[\d.]+/g).map(Number);
  function intensity(color) {
    const linear = rgb(color).slice(0, 3).map(n => n / 255)
      .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  return buttons.filter(button => !button.disabled).map(button => {
    const style = getComputedStyle(button);
    let background = style.backgroundColor;
    let parent = button.parentElement;
    while (rgb(background)[3] === 0 && parent) {
      background = getComputedStyle(parent).backgroundColor;
      parent = parent.parentElement;
    }
    function ratio(node) {
      const foreground = intensity(getComputedStyle(node).color), behind = intensity(background);
      return (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05);
    }
    const family = button.querySelector("small");
    return { label: button.firstChild.textContent.trim(), ratio: ratio(button), familyRatio: family && ratio(family),
      pressed: button.getAttribute("aria-pressed") === "true", focused: button.matches(":focus-visible"),
      hovered: button.matches(":hover"), background, selectionMark: style.boxShadow };
  });
}

async function check(browser, touch) {
  const page = await browser.newPage({ hasTouch: touch, viewport: touch
    ? { width: 412, height: 915 } : { width: 1366, height: 900 } });
  const activate = button => touch ? button.tap() : button.click();
  await page.goto(new URL("/setup/multiplayer", origin).href);
  await activate(page.getByRole("button", { name: "Start", exact: true }));
  const ready = page.getByRole("button", { name: "Ready · Reveal my hand" });
  await ready.waitFor();
  const cards = page.getByLabel("player-1 hand").getByRole("button");
  assert.equal(await cards.count(), 0);
  await activate(ready);
  await activate(page.getByRole("button", { name: "Turn details" }));
  await activate(cards.first());
  if (!touch) {
    await cards.nth(2).hover();
    await page.keyboard.press("Tab");
    assert.ok(await cards.nth(1).evaluate(b => b.matches(":focus-visible") && getComputedStyle(b).outlineStyle !== "none"));
  }
  const hand = await cards.evaluateAll(measure);
  const actions = await page.getByRole("button", { name: "End turn / pass", exact: true }).evaluateAll(measure);
  await page.screenshot({ path: touch ? screenshot.replace(/\.png$/, "-touch.png") : screenshot });
  console.log(JSON.stringify({ touch, hand, actions }));
  assert.ok(hand.length >= 2 && hand.every(card => card.ratio >= 4.5 && card.familyRatio >= 4.5));
  assert.ok(actions.length === 1 && actions[0].ratio >= 4.5);
  assert.ok(hand.some(card => card.pressed && card.selectionMark !== "none"));
  assert.ok(touch || hand.some(card => card.hovered) && hand.some(card => card.focused));
  await page.close();
}

async function run() {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await check(browser, false);
    await check(browser, true);
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
