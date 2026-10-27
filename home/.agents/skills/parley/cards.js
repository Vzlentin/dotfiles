// The cards of a parley page, on the way back of artifacts: each card is three fields of $store.back,
// and the answer line is a part of it. The state functions come from state.mjs, before this script.
document.addEventListener("alpine:init", () => {
	const P = JSON.parse(document.getElementById("parley-data").textContent);
	const byNumber = new Map(P.decisions.map((d) => [d.n, d]));
	const back = Alpine.store("back");
	for (const d of P.decisions) {
		for (const [name, value] of Object.entries(freshCard(d))) back.field(`${d.n} ${name}`, value, { list: false });
	}

	Alpine.store("parley", {
		P,
		card(n) {
			return { pick: back.values[`${n} pick`], note: back.values[`${n} note`], ask: back.values[`${n} ask`] };
		},
		changed(n) {
			return cardChanged(byNumber.get(n), this.card(n));
		},
		pick(n, key) {
			back.values[`${n} pick`] = nextPick(byNumber.get(n), this.card(n), key);
		},
		dot(d) {
			const card = this.card(d.n);
			return card.ask ? "ask" : cardKind(d, card);
		},
		// An object, so Alpine also takes away the class that the HTML gives.
		blank(n) {
			const kind = blankKind(byNumber.get(n), this.card(n));
			return Object.fromEntries(["open", "plan", "set", "own"].map((name) => [name, name === kind]));
		},
		shown(n) {
			return blankText(byNumber.get(n), this.card(n));
		},
		line() {
			const parts = [];
			for (const d of P.decisions) {
				const card = this.card(d.n);
				const note = quote(card.note);
				if (card.ask) parts.push(`?${d.n}`);
				if ((d.decided || d.whose === "my") && !cardChanged(d, card)) continue;
				if (card.pick) parts.push(`${d.n}${card.pick}${note ? `:"${note}"` : ""}`);
				else if (note) parts.push(`${d.n}:"${note}"`);
			}
			const open = P.decisions.some((d) => !d.decided);
			if (!open && !parts.length) parts.push("aligned");
			else if (open && P.decisions.some((d) => d.whose === "my" && !d.decided)) parts.push("ok");
			return `[${P.slug} r${P.round}] ${parts.join(" ")}`.trim();
		},
		// The state of the round, above the dots: "open" while something waits for the user, else "done".
		get head() {
			const yours = P.decisions.filter((d) => d.whose === "your" && !d.decided);
			const open = yours.filter((d) => !this.card(d.n).pick && !this.card(d.n).note.trim()).length;
			const fixes = P.decisions.filter((d) => d.decided && this.changed(d.n)).length;
			if (yours.length) return open ? { state: "open", text: `${open} of ${yours.length} your calls open` } : { state: "done", text: "your calls answered" };
			if (fixes) return { state: "open", text: `${fixes} correction${fixes > 1 ? "s" : ""}` };
			return { state: "done", text: "all decided: copy aligned if the terms are right" };
		},
		get asks() {
			return P.decisions.filter((d) => this.card(d.n).ask).length;
		},
		go(n) {
			const card = document.getElementById(`d-${n}`);
			if (card.tagName === "DETAILS") card.open = true;
			card.scrollIntoView({ block: "start" });
		},
	});
	back.part(() => Alpine.store("parley").line());
});
