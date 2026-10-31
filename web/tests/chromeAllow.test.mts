import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDomains, hostAllowed } from "../src/lib/agent/oneOff/chromeAllow.ts";

test("normalizeDomains reduces urls to bare hostnames, dedupes and drops junk", () => {
  assert.deepEqual(normalizeDomains(["https://www.Verra.org/x", "registry.verra.org", "bad domain", "verra.org", ""]), [
    "verra.org",
    "registry.verra.org",
  ]);
});

test("hostAllowed matches the domain and its subdomains, never look-alikes", () => {
  assert.equal(hostAllowed("verra.org", ["verra.org"]), true);
  assert.equal(hostAllowed("registry.verra.org", ["verra.org"]), true);
  assert.equal(hostAllowed("www.verra.org", ["verra.org"]), true);
  assert.equal(hostAllowed("evilverra.org", ["verra.org"]), false);
  assert.equal(hostAllowed("verra.org.evil.com", ["verra.org"]), false);
  assert.equal(hostAllowed("verra.org", []), false);
});
