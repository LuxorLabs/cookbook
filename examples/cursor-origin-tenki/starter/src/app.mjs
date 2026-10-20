const members = { acme: ["ana"], globex: ["gus"] };

const invoices = [
	{ id: "inv_1", team: "acme", amountCents: 120000 },
	{ id: "inv_2", team: "acme", amountCents: 45000 },
	{ id: "inv_3", team: "globex", amountCents: 99000 },
];

export class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

export function requireMember(user, team) {
	if (!user) throw new HttpError(401, "sign in required");
	if (!members[team]?.includes(user)) throw new HttpError(403, "not a member of this team");
}

const routes = [
	["GET", /^\/teams\/([^/]+)\/invoices$/, (user, team) => {
		requireMember(user, team);
		return invoices.filter((i) => i.team === team);
	}],
];

export function handle({ user, method, path }) {
	for (const [m, pattern, fn] of routes) {
		const match = method === m && path.match(pattern);
		if (!match) continue;
		try {
			return { status: 200, body: fn(user, ...match.slice(1)) };
		} catch (e) {
			if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
			throw e;
		}
	}
	return { status: 404, body: { error: "not found" } };
}
