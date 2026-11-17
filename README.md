# ANSH PANEL v1.0.0

A first, downloadable Docker-free MVP of the selected ANSH Panel design.

## Included
- Neon purple/black responsive dashboard
- Admin login and user login
- Admin can create users and Minecraft server entries
- User can see and control only assigned servers
- Start / stop / restart Java server processes
- Live console output and command input
- Upload a server `.jar` file
- CPU/RAM/disk overview
- JSON file persistence (no database service required)

## Requirements
- Ubuntu/Debian or another Linux VPS
- Node.js 20+ and npm
- Java runtime matching the Minecraft server version
- A Linux user dedicated to running this panel is strongly recommended

## Install
```bash
unzip ansh-panel.zip
cd ansh-panel
chmod +x install.sh
./install.sh
```
Edit `.env` and set a strong `ADMIN_PASSWORD`, then run:
```bash
npm start
```
Open `http://VPS-IP:3000`.

## First login
Username/password are read from `.env` (`admin` / `ChangeMe123!` by default).
Change the password before exposing the panel to the internet.

## Add a Minecraft server
1. Sign in as admin.
2. Open **Servers** → **Create Server**.
3. Enter a name, port and RAM limit.
4. Upload the server's official `.jar` file in that server's card.
5. Accept the Minecraft EULA by creating `eula.txt` containing `eula=true` inside that server's folder (or use the EULA checkbox in the create dialog).
6. Start the server.

The panel does not download Minecraft server software automatically. Obtain server jars from their official project websites and comply with their terms.

## Security / limitations
- This is an MVP, not yet a production-hardened hosting platform.
- Use HTTPS via a reverse proxy (Caddy/Nginx) before public exposure.
- Keep port 3000 private until HTTPS and firewall rules are configured.
- Run as a non-root Linux user. Do not run this panel as root.
- Console commands are sent to the Minecraft server process, not to a system shell.
- Process control and resource figures are local to the machine running this panel.
- Multi-VPS node agents, Railway persistent-volume configuration, Bedrock process support,
  plugin marketplace, schedules, backups, audit logs, and production database are planned,
  not included in this first MVP.
- Railway deployments may restart or lose local files unless persistent storage is configured.
  Minecraft hosting on Railway depends on its networking, storage, and process constraints;
  this package does not claim full Railway game-server compatibility.
