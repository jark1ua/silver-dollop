// Load a .map into headless FMG and export Gaea-ready PNGs:
// per-biome monochrome masks, grayscale heightmap, water mask, rivers mask.
const {chromium} = require("playwright-core");
const fs = require("fs");
const path = require("path");

const mapFile = process.argv[2];
const SCALE = +(process.argv[3] || 2); // 2048 * 2 = 4096
const OUT = path.join(__dirname, "export");

(async () => {
  fs.mkdirSync(OUT, {recursive: true});
  const browser = await chromium.launch({executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--disable-dev-shm-usage"]});
  const page = await browser.newPage({viewport: {width: 2300, height: 2300}});
  page.on("pageerror", e => console.log("PAGEERROR:", e.message.slice(0, 300)));
  await page.goto("http://127.0.0.1:8099/index.html", {waitUntil: "domcontentloaded"});
  await page.waitForFunction(() => typeof pack !== "undefined" && pack.cells && typeof mapHistory !== "undefined" && mapHistory.length > 0, null, {timeout: 300000});
  const before = await page.evaluate(() => seed);
  await page.setInputFiles("#mapToLoad", mapFile);
  await page.waitForFunction(b => typeof seed !== "undefined" && seed !== b, before, {timeout: 300000});
  await page.waitForTimeout(5000);
  console.log("map loaded, extracting at scale", SCALE);

  const save = (name, dataUrl) => {
    fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log("wrote", name);
  };

  // which biomes exist on this map
  const biomes = await page.evaluate(() => {
    const count = {};
    for (const b of pack.cells.biome) count[b] = (count[b] || 0) + 1;
    return biomesData.i.filter(b => count[b]).map(b => ({b, name: biomesData.name[b], cells: count[b]}));
  });
  console.log("biomes present:", biomes.map(x => `${x.b}:${x.name}(${x.cells})`).join(", "));

  // per-biome monochrome masks (white = biome, black = everything else)
  for (const {b, name} of biomes) {
    const dataUrl = await page.evaluate(({b, S}) => {
      const c = pack.cells, vp = pack.vertices.p;
      const canvas = document.createElement("canvas");
      canvas.width = graphWidth * S;
      canvas.height = graphHeight * S;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(S, S);
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      for (let i = 0; i < c.i.length; i++) {
        if (c.biome[i] !== b) continue;
        const poly = c.v[i].map(v => vp[v]);
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let j = 1; j < poly.length; j++) ctx.lineTo(poly[j][0], poly[j][1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      return canvas.toDataURL("image/png");
    }, {b, S: SCALE});
    save(`biome_${String(b).padStart(2, "0")}_${name.replace(/[^\w-]+/g, "_")}.png`, dataUrl);
  }

  // grayscale heightmap: FMG height 0-100 -> gray 0-255 (sea level 20 -> 51).
  // Water is drawn from the uniform grid (pack water cells are sparse and
  // render as faceted fans); land is drawn from pack cells on top.
  const heightUrl = await page.evaluate(S => {
    const canvas = document.createElement("canvas");
    canvas.width = graphWidth * S;
    canvas.height = graphHeight * S;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(S, S);
    const drawCells = (cells, vertices, filter) => {
      for (let i = 0; i < cells.i.length; i++) {
        if (!filter(i)) continue;
        const g = Math.round((cells.h[i] / 100) * 255);
        const col = `rgb(${g},${g},${g})`;
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        const poly = cells.v[i].map(v => vertices.p[v]);
        if (!poly.length || poly.some(p => !p)) continue;
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let j = 1; j < poly.length; j++) ctx.lineTo(poly[j][0], poly[j][1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    };
    drawCells(grid.cells, grid.vertices, () => true); // uniform base incl. smooth ocean
    drawCells(pack.cells, pack.vertices, i => pack.cells.h[i] >= 20); // refined land on top
    return canvas.toDataURL("image/png");
  }, SCALE);
  save("heightmap.png", heightUrl);

  // water mask (white = water: ocean + lakes)
  const waterUrl = await page.evaluate(S => {
    const c = pack.cells, vp = pack.vertices.p;
    const canvas = document.createElement("canvas");
    canvas.width = graphWidth * S;
    canvas.height = graphHeight * S;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(S, S);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    for (let i = 0; i < c.i.length; i++) {
      if (c.h[i] >= 20) continue;
      const poly = c.v[i].map(v => vp[v]);
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let j = 1; j < poly.length; j++) ctx.lineTo(poly[j][0], poly[j][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    return canvas.toDataURL("image/png");
  }, SCALE);
  save("mask_water.png", waterUrl);

  // rivers mask: rasterize the drawn #rivers SVG layer, white on black
  const riversUrl = await page.evaluate(async S => {
    const riversNode = document.getElementById("rivers");
    if (!riversNode) return null;
    if (!riversNode.children.length && typeof drawRivers === "function") drawRivers();
    const clone = riversNode.cloneNode(true);
    clone.removeAttribute("style");
    clone.setAttribute("fill", "#ffffff");
    clone.setAttribute("stroke", "none");
    clone.querySelectorAll("*").forEach(el => {
      el.removeAttribute("style");
      el.removeAttribute("filter");
      el.setAttribute("fill", "#ffffff");
      el.setAttribute("stroke", "none");
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${graphWidth}" height="${graphHeight}" viewBox="0 0 ${graphWidth} ${graphHeight}"><rect width="100%" height="100%" fill="black"/>${clone.outerHTML}</svg>`;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], {type: "image/svg+xml"}));
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = graphWidth * S;
    canvas.height = graphHeight * S;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    return canvas.toDataURL("image/png");
  }, SCALE);
  if (riversUrl) save("mask_rivers.png", riversUrl);

  fs.writeFileSync(path.join(OUT, "biomes.json"), JSON.stringify(biomes, null, 2));
  await browser.close();
  console.log("done ->", OUT);
})().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
