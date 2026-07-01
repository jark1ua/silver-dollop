// Headless FMG driver: generate a map from a custom heightmap template,
// capture diagnostic screenshots + stats, optionally save the .map file.
const {chromium} = require("playwright-core");
const fs = require("fs");
const path = require("path");

const SCRATCH = __dirname;
const OUT = path.join(SCRATCH, "out");
const config = JSON.parse(fs.readFileSync(path.join(SCRATCH, "config.json"), "utf8"));
const doSave = process.argv.includes("--save");

(async () => {
  fs.mkdirSync(OUT, {recursive: true});
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage({viewport: {width: 2300, height: 2300}});

  const missing = new Set();
  page.on("response", r => {
    if (r.status() === 404) missing.add(new URL(r.url()).pathname);
  });
  page.on("pageerror", e => console.log("PAGEERROR:", e.message.slice(0, 300)));

  console.log("loading FMG...");
  await page.goto("http://127.0.0.1:8099/index.html", {waitUntil: "domcontentloaded"});
  await page.waitForFunction(
    () => typeof pack !== "undefined" && pack.cells && typeof mapHistory !== "undefined" && mapHistory.length > 0,
    null,
    {timeout: 300000}
  );
  console.log("initial map ready, applying config...");

  await page.evaluate(cfg => {
    // inject custom heightmap template
    heightmapTemplates[cfg.templateKey] = {id: 99, name: cfg.templateName, template: cfg.template.join("\n"), probability: 0};
    const sel = byId("templateInput");
    if (!sel.querySelector(`option[value="${cfg.templateKey}"]`)) {
      const opt = document.createElement("option");
      opt.value = cfg.templateKey;
      opt.innerText = cfg.templateName;
      sel.appendChild(opt);
    }
    sel.value = cfg.templateKey;
    lock("template");

    changeCellsDensity(cfg.points);
    lock("points");

    mapWidthInput.value = cfg.mapWidth;
    mapHeightInput.value = cfg.mapHeight;

    mapSizeOutput.value = mapSizeInput.value = cfg.mapSize;
    lock("mapSize");
    latitudeOutput.value = latitudeInput.value = cfg.latitude;
    lock("latitude");
    longitudeOutput.value = longitudeInput.value = cfg.longitude;
    lock("longitude");

    options.temperatureEquator = cfg.temperatureEquator;
    lock("temperatureEquator");
    options.temperatureNorthPole = cfg.temperatureNorthPole;
    lock("temperatureNorthPole");
    options.temperatureSouthPole = cfg.temperatureSouthPole;
    lock("temperatureSouthPole");
    precInput.value = precOutput.value = cfg.prec;
    lock("prec");
    if (cfg.heightExponent) {
      byId("heightExponentInput").value = cfg.heightExponent;
      store("heightExponent", cfg.heightExponent);
    }
    distanceScale = distanceScaleInput.value = cfg.distanceScale;
    lock("distanceScale");
    statesNumber.value = cfg.statesNumber;
    lock("statesNumber");
  }, config);

  console.log("regenerating with seed", config.seed, "...");
  const t0 = Date.now();
  await page.evaluate(seed => regenerateMap({seed}), config.seed);
  await page.waitForFunction(
    seed => typeof mapHistory !== "undefined" && mapHistory.length > 1 && mapHistory[mapHistory.length - 1].seed === seed,
    config.seed,
    {timeout: 600000, polling: 1000}
  );
  // let drawLayers/fitMapToScreen settle
  await page.waitForTimeout(3000);
  console.log("generation took", ((Date.now() - t0) / 1000).toFixed(1), "s");

  // stats
  const stats = await page.evaluate(() => {
    const cells = pack.cells;
    const biomeCount = {};
    for (let i = 0; i < cells.i.length; i++) {
      const b = biomesData.name[cells.biome[i]];
      biomeCount[b] = (biomeCount[b] || 0) + 1;
    }
    const landCells = Array.from(cells.h).filter(h => h >= 20).length;
    return {
      seed,
      graphWidth,
      graphHeight,
      template: mapHistory[mapHistory.length - 1].template,
      mapCoordinates,
      landPct: ((100 * landCells) / cells.h.length).toFixed(1),
      cellsPack: cells.i.length,
      biomeCount,
      rivers: pack.rivers.length,
      maxHeight: Math.max(...cells.h),
      presets: Object.keys(getDefaultPresets())
    };
  });
  fs.writeFileSync(path.join(OUT, "stats.json"), JSON.stringify(stats, null, 2));
  console.log(JSON.stringify(stats, null, 2));

  // screenshots under different layer presets
  const shot = async (preset, file) => {
    await page.evaluate(p => {
      handleLayersPresetChange(p);
    }, preset);
    await page.waitForTimeout(2500);
    const svg = await page.locator("#map").boundingBox();
    await page.screenshot({path: path.join(OUT, file), clip: svg || undefined});
    console.log("shot:", file);
  };
  for (const p of stats.presets) {
    if (["landmass", "heightmap", "biomes", "physical", "political"].includes(p)) {
      await shot(p, `map-${p}.png`);
    }
  }

  if (doSave) {
    console.log("saving .map file...");
    const [download] = await Promise.all([
      page.waitForEvent("download", {timeout: 300000}),
      page.evaluate(() => saveMap("machine"))
    ]);
    const file = path.join(OUT, download.suggestedFilename());
    await download.saveAs(file);
    console.log("saved:", file, fs.statSync(file).size, "bytes");
  }

  if (missing.size) console.log("404s:", [...missing].join(", "));
  await browser.close();
})().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
