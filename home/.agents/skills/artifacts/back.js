// The way back: what the user changes on a page comes back to the agent as one block of text.
// A field: x-init="$store.back.field('reply 1', $el.value)" x-model="$store.back.values['reply 1']".
// A field with { list: false } is not in the block: a part of the page reports it.
// A part: Alpine.store("back").part(() => "a line"), for a page that builds its own lines.
// $store.back.text is the block. $store.back.copy() copies it.
// The browser keeps only the edits, so a new build of the page shows its new defaults.
document.addEventListener("alpine:init", () => {
	const { page, key } = document.body.dataset;
	const same = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();
	Alpine.store("back", {
		edits: Alpine.$persist({}).as(`${key}:back`),
		values: {},
		defaults: {},
		listed: {},
		parts: [],
		// The text of the toast that Copy shows.
		toast: "",
		field(name, value, { list = true } = {}) {
			this.defaults[name] = value;
			this.listed[name] = list;
			this.values[name] = name in this.edits ? this.edits[name] : value;
			Alpine.effect(() => {
				const current = this.values[name];
				if (same(current, this.defaults[name])) delete this.edits[name];
				else this.edits[name] = current;
			});
		},
		changed(name) {
			return name in this.edits;
		},
		undo(name) {
			this.values[name] = this.defaults[name];
		},
		part(build) {
			this.parts.push(build);
		},
		get text() {
			const lines = this.parts.map((build) => build()).filter(Boolean);
			const fields = Object.keys(this.defaults)
				.filter((name) => this.listed[name] && this.changed(name))
				.map((name) => `${name}:\n${String(this.values[name]).trim()}`);
			return [...(lines.length ? lines : [`[${page}]`]), ...fields].join("\n\n");
		},
		async copy() {
			const text = this.text;
			try {
				await navigator.clipboard.writeText(text);
			} catch {
				const area = document.createElement("textarea");
				area.value = text;
				document.body.append(area);
				area.select();
				document.execCommand("copy");
				area.remove();
			}
			this.toast = "Copied: paste it in the terminal";
			setTimeout(() => (this.toast = ""), 1500);
		},
		reset() {
			for (const name of Object.keys(this.defaults)) this.values[name] = this.defaults[name];
		},
	});
});
