// Run with the local web preview running and Playwright installed (or set PLAYWRIGHT_MODULE).
const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

test("the reference stays at its last visible position on release and interruption", async (t) => {
  const browser = await chromium.launch({ channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto("http://127.0.0.1:5178");
  await page.getByRole("button", { name: "跳过引导" }).click();
  await page.waitForFunction(
    () => document.querySelector(".reference-media video")?.videoWidth > 0,
  );

  const card = page.getByRole("complementary", { name: "动作参考" });
  const home = await card.boundingBox();

  async function dragTo(x, y) {
    const start = await card.boundingBox();
    await page.mouse.move(start.x + 30, start.y + 15);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 15, { steps: 6 });
    const shown = await card.boundingBox();
    assert.ok(
      Math.abs(shown.x - x) < 1 && Math.abs(shown.y - y) < 1,
      "card should follow the pointer",
    );
    return shown;
  }

  async function releaseAt(shown) {
    await page.mouse.up();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.deepEqual(await card.boundingBox(), shown);
  }

  await releaseAt(await dragTo(home.x - 18, home.y - 10));
  await releaseAt(await dragTo(15, 190));

  const interrupted = await dragTo(470, 225);
  await card.evaluate((el) => {
    const slot = el.parentElement;
    slot.addEventListener(
      "pointermove",
      (event) => slot.releasePointerCapture(event.pointerId),
      { once: true },
    );
  });
  await page.mouse.move(500, 240);
  await page.mouse.move(500, 240);
  await releaseAt(interrupted);

  const unfocused = await dragTo(510, 270);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await releaseAt(unfocused);

  await page.getByRole("button", { name: "将参考视频放回原位" }).click();
  assert.deepEqual(await card.boundingBox(), home);
});
