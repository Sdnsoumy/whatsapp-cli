# whatsapp-cli (TypeScript)

A powerful, headless WhatsApp CLI tool to act as a bridge between WhatsApp and standard Unix tooling. This is the **Node.js (TypeScript) port** of the original Go `whatsapp-cli`.

It maintains identical SQLite database structures, flags, and CLI command parity with the original Go version.

## Architecture Highlights
- Uses `@whiskeysockets/baileys` instead of `whatsmeow` for the WA protocol.
- Uses `better-sqlite3` to provide a synchronous local-first experience.
- Implements robust CLI functionality using `commander`.
- Stores data and sessions securely in `~/.wacli` by default.

## Installation

**Prerequisites:** You need Node.js (`>= 18`) and a C++ toolchain (for native sqlite3 compilation).

```bash
# Install locally
npm install
npm run build

# Install globally to your system
npm install -g .
```

## Basic Usage

The new `wacli` command should be accessible if you install it globally. If running directly from the project directory without a global install:
```bash
npm run dev -- <command>
```
Or, if you run the built binary directly:
```bash
node dist/cmd/main.js <command>
```

### 1. Authenticate
```bash
wacli auth
# Follow the prompt and scan the QR code using your WhatsApp Mobile app.
```

### 2. Sync Messages
Sync your messages from WhatsApp dynamically to your local SQLite DB:
```bash
wacli sync --mode follow --download-media --refresh-contacts
```
*(Modes: `bootstrap` scans until idle -> exits, `once` connects quickly -> exits, `follow` runs persistently)*

### 3. Usage Examples
Search messages (FTS5 enabled!):
```bash
wacli messages search "dinner reservation" --limit 5
```

Send a clear-text message:
```bash
wacli send 1234567890 "Hello from the new TypeScript CLI!"
```

Send an image:
```bash
wacli send-file --caption "Check this out" 1234567890 /path/to/image.jpg
```

See the local health state:
```bash
wacli doctor
```
