// The state of a decision card, for page.mjs and for the page itself.
// page.mjs renders each card at its fresh state, and the page script runs the same functions on the user's taps.
// The page gets this file as plain script, without its `export` words.
//
// d: a decision of the parley data. card: { pick, note, ask }, where pick is an option key or "" for none.

// The pick before the user taps: the answer, the plan of a my call, or none.
export function basePick(d) {
	if (d.decided) return d.answer ?? "";
	return d.whose === "my" ? d.plan : "";
}

export function freshCard(d) {
	return { pick: basePick(d), note: "", ask: false };
}

export function cardChanged(d, card) {
	return card.pick !== basePick(d) || card.note.trim() !== "";
}

// A second tap on the pick takes it back: to the answer on a decided card, to none on an open card.
export function nextPick(d, card, key) {
	if (card.pick !== key) return key;
	return d.decided ? basePick(d) : "";
}

// open: it waits for the user. plan: as planned or as decided. set: a pick. own: the user's words only.
export function cardKind(d, card) {
	if (!cardChanged(d, card)) return card.pick || d.decided ? "plan" : "open";
	if (card.pick) return "set";
	return card.note.trim() ? "own" : "open";
}

// A blank of a decided card that the user did not change shows how it was decided.
export function blankKind(d, card) {
	if (d.decided && !cardChanged(d, card)) return d.answer ? "set" : "own";
	return cardKind(d, card);
}

export function blankText(d, card) {
	if (card.pick) return d.labels[card.pick];
	if (card.note.trim()) return quote(card.note).slice(0, 60);
	return d.shown;
}

// The user's words on one line, with no double quote, for the answer line.
export function quote(text) {
	return text.trim().replace(/\s+/g, " ").replace(/"/g, "'");
}
