// The cards of a parley page, on the way back of artifacts: each tap becomes part of the answer line.
document.addEventListener("alpine:init", () => {
	const P = JSON.parse(document.getElementById("parley-data").textContent);
	const byNumber = new Map(P.decisions.map((d) => [d.n, d]));
	const base = (d) => (d.decided ? d.answer : d.whose === "me" ? d.plan : null);
	const quote = (text) => text.trim().replace(/\s+/g, " ").replace(/"/g, "'");
	const fresh = () => Object.fromEntries(P.decisions.map((d) => [d.n, { k: base(d), note: "", ask: false }]));

	Alpine.store("parley", {
		P,
		// One key for each page. Taps from an earlier round do not carry over: that round is decided.
		saved: Alpine.$persist({ round: P.round, cards: {} }).as(`${P.slug}:parley`),
		init() {
			if (this.saved.round !== P.round) this.saved = { round: P.round, cards: {} };
			this.saved.cards = { ...fresh(), ...this.saved.cards };
		},
		s(n) {
			return this.saved.cards[n];
		},
		changed(n) {
			const d = byNumber.get(n);
			return this.s(n).k !== base(d) || this.s(n).note.trim() !== "";
		},
		// A decided card goes back to its answer; an open card can be left empty.
		pick(n, key) {
			const d = byNumber.get(n);
			const s = this.s(n);
			s.k = s.k !== key ? key : d.decided ? base(d) : null;
		},
		kind(d) {
			const s = this.s(d.n);
			if (s.ask) return "ask";
			if (d.decided) return this.changed(d.n) ? (s.k ? "set" : "own") : "plan";
			if (s.k && (d.whose === "you" || s.k !== d.plan)) return "set";
			if (!s.k && s.note.trim()) return "own";
			if (s.k) return s.note.trim() ? "set" : "plan";
			return "open";
		},
		shown(n) {
			const d = byNumber.get(n);
			const s = this.s(n);
			return s.k ? d.labels[s.k] : s.note.trim() ? quote(s.note).slice(0, 60) : d.own || d.labels[d.plan];
		},
		blank(n) {
			const d = byNumber.get(n);
			if (d.decided && !this.changed(n)) return d.answer ? "set" : "own";
			const kind = this.kind(d);
			return kind === "ask" ? (this.s(n).k ? "set" : "open") : kind;
		},
		line() {
			const parts = [];
			for (const d of P.decisions) {
				const s = this.s(d.n);
				const note = quote(s.note);
				if (s.ask) parts.push(`?${d.n}`);
				if ((d.decided || d.whose === "me") && !this.changed(d.n)) continue;
				if (s.k) parts.push(`${d.n}${s.k}${note ? `:"${note}"` : ""}`);
				else if (note) parts.push(`${d.n}:"${note}"`);
			}
			const open = P.decisions.some((d) => !d.decided);
			if (!open && !parts.length) parts.push("aligned");
			else if (open && P.decisions.some((d) => d.whose === "me" && !d.decided)) parts.push("ok");
			return `[${P.slug} r${P.round}] ${parts.join(" ")}`.trim();
		},
		// The state of the round, above the dots: "open" while something waits for the user, else "done".
		get head() {
			const yours = P.decisions.filter((d) => d.whose === "you" && !d.decided).length;
			const open = P.decisions.filter((d) => d.whose === "you" && !d.decided && !this.s(d.n).k && !this.s(d.n).note.trim()).length;
			const fixes = P.decisions.filter((d) => d.decided && this.changed(d.n)).length;
			if (yours) return open ? { state: "open", text: `${open} of ${yours} your calls open` } : { state: "done", text: "your calls answered" };
			if (fixes) return { state: "open", text: `${fixes} correction${fixes > 1 ? "s" : ""}` };
			return { state: "done", text: "all decided: copy aligned if the terms are right" };
		},
		get asks() {
			return P.decisions.filter((d) => this.s(d.n).ask).length;
		},
		go(n) {
			const card = document.getElementById(`d-${n}`);
			if (card.tagName === "DETAILS") card.open = true;
			card.scrollIntoView({ block: "start" });
		},
		reset() {
			if (!confirm("Clear your answers and notes?")) return;
			this.saved = { round: P.round, cards: fresh() };
			Alpine.store("back").reset();
		},
	});
	Alpine.store("back").part(() => Alpine.store("parley").line());
});
