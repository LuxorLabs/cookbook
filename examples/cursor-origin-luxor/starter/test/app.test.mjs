import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/app.mjs";

test("members can list their team's invoices", () => {
	const r = handle({ user: "ana", method: "GET", path: "/teams/acme/invoices" });
	assert.equal(r.status, 200);
	assert.equal(r.body.length, 2);
});

test("non-members get 403", () => {
	const r = handle({ user: "gus", method: "GET", path: "/teams/acme/invoices" });
	assert.equal(r.status, 403);
});

test("anonymous requests get 401", () => {
	const r = handle({ method: "GET", path: "/teams/acme/invoices" });
	assert.equal(r.status, 401);
});
