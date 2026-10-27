// The way back: what the user changes on a page comes back to the agent as one block of text.
// A field: x-init="$store.back.field('reply 1', $el.value)" x-model="$store.back.values['reply 1']".
// A part: Alpine.store("back").part(() => "a line"), for a page that builds its own lines.
// $store.back.text is the block. $store.back.copy() copies it.
document.addEventListener("alpine:init", () => {
	const page = document.body.dataset.page;
	Alpine.store("back", {
		values: Alpine.$persist({}).as(`${page}:back`),
		defaults: {},
		parts: [],
		note: "",
		field(key, value) {
			this.defaults[key] = value;
			if (!(key in this.values)) this.values[key] = value;
		},
		changed(key) {
			return String(this.values[key] ?? "").trim() !== String(this.defaults[key] ?? "").trim();
		},
		undo(key) {
			this.values[key] = this.defaults[key];
		},
		part(build) {
			this.parts.push(build);
		},
		get text() {
			const lines = this.parts.map((build) => build()).filter(Boolean);
			const fields = Object.keys(this.defaults)
				.filter((key) => this.changed(key))
				.map((key) => `${key}:\n${String(this.values[key]).trim()}`);
			return [...(lines.length ? lines : [`[${page}]`]), ...fields].join("\n\n");
		},
		async copy(text = this.text, message = "Copied: paste it in the terminal") {
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
			this.toast(message);
		},
		reset() {
			for (const key of Object.keys(this.defaults)) this.values[key] = this.defaults[key];
		},
		toast(message) {
			this.note = message;
			setTimeout(() => (this.note = ""), 1500);
		},
	});
});
