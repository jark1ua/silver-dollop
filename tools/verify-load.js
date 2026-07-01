// Round-trip check: load the saved .map into a fresh FMG session
const {chromium} = require("playwright-core");
const path = require("path");

const mapFile = process.argv[2];

(async () => {
  const browser = await chromium.launch({executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--disable-dev-shm-usage"]});
  const page = await browser.newPage({viewport: {width: 2300, height: 2300}});
  page.on("pageerror", e => console.log("PAGEERROR:", e.message.slice(0, 300)));
  await page.goto("http://127.0.0.1:8099/index.html", {waitUntil: "domcontentloaded"});
  await page.waitForFunction(() => typeof pack !== "undefined" && pack.cells && typeof mapHistory !== "undefined" && mapHistory.length > 0, null, {timeout: 300000});
  const before = await page.evaluate(() => seed);

  await page.setInputFiles("#mapToLoad", mapFile);
  await page.waitForFunction(before => typeof seed !== "undefined" && seed !== before, before, {timeout: 300000});
  await page.waitForTimeout(5000);

  const state = await page.evaluate(() => ({
    seed,
    cells: pack.cells.i.length,
    rivers: pack.rivers.length,
    template: byId("templateInput").value,
    mapCoordinates,
    maxHeight: Math.max(...pack.cells.h)
  }));
  console.log("LOADED OK:", JSON.stringify(state));
  await page.screenshot({path: path.join(__dirname, "out", "roundtrip.png")});
  await browser.close();
})().catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
