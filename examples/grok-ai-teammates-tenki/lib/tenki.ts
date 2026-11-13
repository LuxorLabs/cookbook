// Tenki sandbox module for Grok AI Teammates. It exports the functions the app
// imports for its bot computers, plus a Sandbox class with the methods
// lib/sandbox-tools.ts calls, so that file only changes its imports.
import { randomBytes } from "node:crypto"

import {
  SessionNotFoundError,
  TenkiSandbox,
  WaitReadyFailedError,
  stderrText,
  stdoutText,
  type ExecResult,
  type Session,
} from "@tenkicloud/sandbox"

// Every bot sandbox carries this tag, which is how the meter finds them
const TAG = "ai-teammates"
// Where websockify serves noVNC and its websocket
const VNC_PORT = 6080
const DISPLAY = ":1"

// Reads TENKI_API_KEY (or TENKI_AUTH_TOKEN). Made on first use, so importing
// this module during `next build` needs no key.
let client: TenkiSandbox | undefined
const tenki = () => (client ??= new TenkiSandbox())

export const MEMORY_FILE = "MEMORY.md"

// The desktop: Xvfb, openbox, x11vnc on localhost only, and websockify in front
// of it that only lets in a connection carrying a token from ~/.desktop/tokens.
// Installs the packages on first use unless the image already has them, and
// starts whatever is not running, so it is safe to run any number of times.
// It runs detached, logging to ~/.desktop/desktop.log: run as a plain exec it
// left the exec waiting until its timeout.
export const DESKTOP_SCRIPT = String.raw`set -e
D=$HOME/.desktop
if ! command -v x11vnc xdotool websockify import >/dev/null; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    xvfb openbox x11vnc novnc python3-websockify xdotool imagemagick xterm
fi
export DISPLAY=${DISPLAY}
pgrep -x Xvfb >/dev/null || setsid Xvfb ${DISPLAY} -screen 0 1024x768x24 -nolisten tcp &
for i in $(seq 50); do xdotool getdisplaygeometry >/dev/null 2>&1 && break; sleep 0.2; done
pgrep -x openbox >/dev/null || setsid openbox &
pgrep -x x11vnc >/dev/null || setsid x11vnc -display ${DISPLAY} -localhost -rfbport 5900 -forever -shared -nopw -quiet &
touch $D/tokens; chmod 600 $D/tokens
(exec 3<>/dev/tcp/127.0.0.1/${VNC_PORT}) 2>/dev/null ||
  setsid websockify --web /usr/share/novnc --token-plugin TokenFile --token-source $D/tokens 0.0.0.0:${VNC_PORT} &`

// The tools expect stdout and stderr as one string
const combined = (res: ExecResult) =>
  Buffer.concat(res.outputs.map((o) => o.data)).toString("utf8")

const KEYS: Record<string, string> = {
  enter: "Return",
  escape: "Escape",
  tab: "Tab",
  backspace: "BackSpace",
  delete: "Delete",
  space: "space",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "Prior",
  pagedown: "Next",
  ctrl: "ctrl",
  alt: "alt",
  shift: "shift",
  cmd: "super",
}
const keysym = (k: string) =>
  KEYS[k.toLowerCase()] ?? (/^f\d+$/i.test(k) ? k.toUpperCase() : k)
const BUTTONS = { left: 1, middle: 2, right: 3 } as const

// A bot's sandbox, shaped like the API lib/sandbox-tools.ts calls
export class Sandbox {
  constructor(readonly session: Session) {}

  get id() {
    return this.session.id
  }

  private async run(
    argv: string[],
    options: { cwd?: string; timeoutMs?: number } = {}
  ) {
    const res = await this.session.exec(argv, { ...options, env: { DISPLAY } })
    if (res.status !== "SUCCEEDED")
      throw new Error(
        `${argv[0]} failed (${res.status}, exit ${res.exitCode}): ${stderrText(res) || stdoutText(res)}`
      )
    return res
  }

  private xdotool = (...args: (string | number)[]) =>
    this.run(["xdotool", ...args.map(String)]).then(() => undefined)

  process = {
    // A fresh bash in the home directory; timeout is in seconds
    executeCommand: async (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number
    ) => {
      const res = await this.session.exec(["bash", "-c", command], {
        cwd,
        env: { DISPLAY, ...env },
        timeoutMs: timeout ? timeout * 1000 : undefined,
      })
      const timedOut = res.status === "TIMED_OUT"
      return {
        exitCode: timedOut ? 124 : res.exitCode,
        result: combined(res) + (timedOut ? "\n(timed out)" : ""),
      }
    },
  }

  // Through the shell rather than the SDK's file API, which is confined to
  // /home/tenki: a bot can read and write anywhere its user can
  fs = {
    downloadFile: async (path: string) =>
      Buffer.from((await this.run(["cat", "--", path])).stdout),
    uploadFile: async (file: Buffer, path: string) => {
      const staged = `.upload-${randomBytes(6).toString("hex")}`
      await this.session.writeFile(staged, file)
      await this.run([
        "sh",
        "-c",
        'mkdir -p "$(dirname "$2")" && mv -f "$1" "$2"',
        "sh",
        staged,
        path,
      ])
    },
    listFiles: async (path: string) =>
      stdoutText(
        await this.run([
          "find",
          path,
          "-mindepth",
          "1",
          "-maxdepth",
          "1",
          "-printf",
          "%y\\t%s\\t%f\\n",
        ])
      )
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [type, size, name] = line.split("\t")
          return { name, isDir: type === "d", size: Number(size) }
        }),
  }

  computerUse = {
    getStatus: async () => {
      const res = await this.session.exec([
        "bash",
        "-c",
        `pgrep -x Xvfb && pgrep -x x11vnc && (exec 3<>/dev/tcp/127.0.0.1/${VNC_PORT})`,
      ])
      return {
        status:
          res.exitCode === 0 ? ("active" as const) : ("inactive" as const),
      }
    },
    start: async () => {
      await this.run([
        "bash",
        "-c",
        'mkdir -p .desktop && setsid bash -c "$0" >>.desktop/desktop.log 2>&1 </dev/null &',
        DESKTOP_SCRIPT,
      ])
      // The first start installs the packages, which takes about a minute
      for (
        const end = Date.now() + 300_000;
        Date.now() < end;
        await new Promise((r) => setTimeout(r, 2000))
      )
        if ((await this.computerUse.getStatus()).status === "active") return
      const log = await this.process.executeCommand(
        "tail -n 20 .desktop/desktop.log"
      )
      throw new Error(`The desktop did not start:\n${log.result}`)
    },
    // ImageMagick's capture has no cursor, so showCursor is ignored
    screenshot: {
      takeCompressed: async ({
        format = "jpeg",
        quality = 70,
      }: {
        format?: "jpeg" | "png"
        quality?: number
        showCursor?: boolean
      } = {}) => {
        const res = await this.run([
          "import",
          "-window",
          "root",
          "-quality",
          String(quality),
          `${format}:-`,
        ])
        return { screenshot: Buffer.from(res.stdout).toString("base64") }
      },
    },
    display: {
      getInfo: async () => {
        const [width, height] = stdoutText(
          await this.run(["xdotool", "getdisplaygeometry"])
        )
          .trim()
          .split(" ")
          .map(Number)
        return { displays: [{ width, height }] }
      },
    },
    mouse: {
      move: (x: number, y: number) => this.xdotool("mousemove", x, y),
      click: (
        x: number,
        y: number,
        button: keyof typeof BUTTONS = "left",
        double = false
      ) =>
        this.xdotool(
          "mousemove",
          x,
          y,
          "click",
          "--repeat",
          double ? 2 : 1,
          BUTTONS[button]
        ),
      drag: (startX: number, startY: number, endX: number, endY: number) =>
        this.xdotool(
          "mousemove",
          startX,
          startY,
          "mousedown",
          1,
          "mousemove",
          endX,
          endY,
          "mouseup",
          1
        ),
      scroll: (x: number, y: number, direction: "up" | "down", amount = 1) =>
        this.xdotool(
          "mousemove",
          x,
          y,
          "click",
          "--repeat",
          amount,
          direction === "up" ? 4 : 5
        ),
    },
    keyboard: {
      type: (text: string) => this.xdotool("type", "--delay", 12, "--", text),
      press: (key: string, modifiers: string[] = []) =>
        this.xdotool("key", "--", [...modifiers, key].map(keysym).join("+")),
    },
  }
}

// Every bot owns one sandbox. Sticky, so it runs until it is paused or
// deleted rather than for Tenki's default two hours; tagged with the bot.
export async function createBotSandbox(botId: string) {
  const session = await tenki()
    .createAndWait({
      name: `bot-${botId}`,
      tags: [TAG, `bot-${botId}`],
      sticky: true,
      allowInbound: true,
      cpuCores: 2,
      memoryMb: 2048,
      diskSizeGb: 10,
      image: process.env.TENKI_DESKTOP_IMAGE || undefined,
      workspaceId: process.env.TENKI_WORKSPACE_ID || undefined,
    })
    .catch(async (error) => {
      if (error instanceof WaitReadyFailedError)
        await error.session.close().catch(() => {})
      throw error
    })

  try {
    const res = await session.exec(["touch", MEMORY_FILE])
    if (res.exitCode !== 0)
      throw new Error(`Creating ${MEMORY_FILE} failed: ${stderrText(res)}`)
  } catch (error) {
    await session.close().catch(() => {})
    throw error
  }
  return session.id
}

// A running sandbox; paused ones are resumed here
export async function getBotSandbox(sandboxId: string) {
  const session = await tenki().get(sandboxId)
  if (session.state === "PAUSING") await session.waitPaused()
  if (session.state === "PAUSING" || session.state === "PAUSED")
    await session.resume()
  // resume() can return while the sandbox is still RESUMING
  await session.refresh()
  if (session.state === "RESUMING") await session.waitResumed()
  await session.refresh()
  if (session.state !== "RUNNING")
    throw new Error(`Sandbox ${sandboxId} is ${session.state}`)
  return new Sandbox(session)
}

export async function readBotMemory(sandbox: Sandbox) {
  const { exitCode, result } = await sandbox.process.executeCommand(
    `touch ${MEMORY_FILE} && cat ${MEMORY_FILE}`
  )
  if (exitCode !== 0)
    throw new Error(`Reading ${MEMORY_FILE} failed: ${result}`)
  return result
}

// A websocket address a browser can open the bot's desktop on. Each call
// writes a new random token, so the previous address stops letting new
// connections in; open ones stay up.
export async function getBotDesktopUrl(sandboxId: string) {
  const sandbox = await getBotSandbox(sandboxId)
  const { status } = await sandbox.computerUse.getStatus()
  if (status !== "active") await sandbox.computerUse.start()

  const token = randomBytes(24).toString("hex")
  await sandbox.process.executeCommand(
    `umask 077; echo '${token}: 127.0.0.1:5900' > .desktop/tokens`
  )

  // A named preview URL bound to this sandbox and port. Created with the
  // session: an unbound one gets an address that never routes.
  const session = sandbox.session
  const urls = await tenki().previewUrls.list({
    sessionId: session.id,
    workspaceId: session.workspaceId,
  })
  const preview =
    urls.find((u) => u.port === VNC_PORT) ??
    (await tenki().previewUrls.create(
      `desk-${session.id.replace(/-/g, "").slice(-16)}`,
      {
        sessionId: session.id,
        port: VNC_PORT,
        workspaceId: session.workspaceId,
      }
    ))

  const url = new URL("/websockify", preview.previewUrl)
  url.protocol = "wss:"
  url.searchParams.set("token", token)
  return url.toString()
}

export async function deleteBotSandbox(sandboxId: string) {
  let session: Session
  try {
    session = await tenki().get(sandboxId)
  } catch (error) {
    // Already gone is as good as deleted
    if (error instanceof SessionNotFoundError) return
    throw error
  }
  for (const url of await tenki().previewUrls.list({
    sessionId: sandboxId,
    workspaceId: session.workspaceId,
  }))
    await tenki().previewUrls.delete(url.id)
  await session.close()
}

// The IDs of every bot sandbox that holds a VM, which is when Tenki bills it
export async function listRunningSandboxIds() {
  const sessions = await tenki().list({
    tags: [TAG],
    workspaceId: process.env.TENKI_WORKSPACE_ID || undefined,
  })
  return sessions
    .filter((s) =>
      ["CREATING", "RUNNING", "RESUMING", "PAUSING"].includes(s.state)
    )
    .map((s) => s.id)
}

// Pausing keeps memory and files, releases the VM and stops billing; the next
// getBotSandbox resumes it
export async function stopBotSandbox(sandboxId: string) {
  const session = await tenki().get(sandboxId)
  if (session.state === "RUNNING") await session.pause()
}

// Tenki leaves a sticky sandbox running until it is paused or deleted. This pauses
// the bot sandboxes no command has touched for idleMinutes, and returns their IDs.
// Run it on a schedule (trigger/pause-idle.ts).
export async function stopIdleSandboxes(idleMinutes = 15) {
  const cutoff = Date.now() - idleMinutes * 60_000
  const sessions = await tenki().list({
    tags: [TAG],
    workspaceId: process.env.TENKI_WORKSPACE_ID || undefined,
  })
  const idle = sessions.filter(
    (s) => s.state === "RUNNING" && (s.lastActivityAt?.getTime() ?? 0) < cutoff
  )
  await Promise.all(idle.map((s) => s.pause()))
  return idle.map((s) => s.id)
}
