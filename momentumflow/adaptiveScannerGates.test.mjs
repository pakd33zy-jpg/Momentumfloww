import fs from "fs";
const t = fs.readFileSync(new URL("./liveBot.js", import.meta.url), "utf8");
const ok = (v,m) => { if (!v) throw new Error(m); };
ok(t.includes("adaptiveLiquidityStrongDollarVolume: 1000000"), "adaptive equity floor missing");
ok(t.includes("function adaptiveLiquidityThreshold("), "adaptive liquidity helper missing");
ok(t.includes("function adaptiveCryptoPrefilterMomentum("), "crypto adaptive prefilter missing");
ok(t.includes("maxRiskFraction: 0.005"), "risk cap changed");
console.log("adaptive scanner gate regression test passed");
