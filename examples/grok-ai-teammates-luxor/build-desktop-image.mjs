// Optional: bake the desktop packages into a private Luxor Agent Cloud image, so a new bot's
// desktop starts in seconds instead of installing them on first use.
//   node build-desktop-image.mjs   prints TENKI_DESKTOP_IMAGE=<ref> for .env.local
import { TemplateSpec, LuxorSandbox } from "@luxorai/sandbox";

const luxor = new LuxorSandbox();
const name = process.env.TEMPLATE_NAME || "ai-teammates-desktop";
// The same packages lib/tenki.ts installs when they are missing. One run step:
// the builder takes a spec without a Git context only in that shape.
const spec = new TemplateSpec().run(
	"S=$([ $(id -u) = 0 ] || echo sudo); $S apt-get update -qq && DEBIAN_FRONTEND=noninteractive $S apt-get install -y -qq --no-install-recommends " +
		"xvfb openbox x11vnc novnc python3-websockify xdotool imagemagick xterm",
);

const template = (await luxor.listTemplates()).find((t) => t.name === name) ?? (await luxor.createTemplate({ name, spec }));
const build = await luxor.buildTemplate(template, {
	waitForCompletion: true,
	onEvent: (e) => e.type === "log" && process.stderr.write(e.data),
});
console.log(`TENKI_DESKTOP_IMAGE=${build.image.digestRef}`);
