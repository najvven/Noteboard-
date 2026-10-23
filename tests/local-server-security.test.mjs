import assert from "node:assert/strict";
import test from "node:test";

import {
  getLocalSecurityHeaders,
  isTrustedLocalHost,
  isTrustedLocalOrigin,
} from "../shared/local-server-security.js";

test("localhost API rejects rebinding hosts and foreign origins", () => {
  assert.equal(isTrustedLocalHost("127.0.0.1:3000"), true);
  assert.equal(isTrustedLocalHost("localhost:3100"), true);
  assert.equal(isTrustedLocalHost("[::1]:3000"), true);
  assert.equal(isTrustedLocalHost("attacker.example:3000"), false);
  assert.equal(isTrustedLocalHost("127.0.0.1.attacker.example:3000"), false);
  assert.equal(isTrustedLocalOrigin("http://127.0.0.1:3000"), true);
  assert.equal(isTrustedLocalOrigin("http://localhost:3100"), true);
  assert.equal(isTrustedLocalOrigin("https://attacker.example"), false);
});

test("web responses deny framing and MIME sniffing", () => {
  const headers = getLocalSecurityHeaders();
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
});
