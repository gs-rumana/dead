# Deploying Dead Tracks

Everything below is free (GAME_PLAN §9). You only need to do it once; after that every push to `main` deploys automatically.

## 1. Website on Cloudflare Pages

1. Create a free Cloudflare account and a Pages project named `dead-tracks` (it becomes `dead-tracks.pages.dev`).
2. Create an API token with the "Cloudflare Pages: Edit" permission.
3. In the GitHub repository settings, add secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and a variable `SERVER_URL` (for example `https://deadtracks.duckdns.org`).

Solo play works as soon as the website is up; it doesn't need the game server.

## 2. Game server on Oracle Cloud Always Free

1. Sign up for Oracle Cloud with a real credit or debit card. **Pick a European home region** (Frankfurt or London; any EU region if those are out of capacity). The home region can't be changed later.
2. Upgrade to pay-as-you-go (still $0 inside the free limits; it stops idle servers being reclaimed) and set a **$0 budget alert**.
3. Create an Ampere A1 (Arm) instance: Ubuntu, 2 OCPU, 12 GB. If you get "out of capacity", retry in another availability domain.
4. In the instance's VCN security list, allow inbound TCP 80 and 443.
5. Get a free hostname pointing at the VM's public IP, for example a DuckDNS subdomain.
6. On the VM:
   ```sh
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
   sudo usermod -aG docker $USER   # log out and back in
   mkdir -p ~/dead-tracks && cd ~/dead-tracks
   # copy deploy/docker-compose.yml and deploy/Caddyfile here, then:
   echo "SERVER_DOMAIN=deadtracks.duckdns.org" > .env
   echo "GITHUB_OWNER=<your-github-user>" >> .env
   echo "JWT_SECRET=$(openssl rand -base64 48)" >> .env
   echo "CLIENT_URL=https://dead-tracks.pages.dev" >> .env
   docker compose up -d
   ```
   Also open the ports in Ubuntu's own firewall: `sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT` and save with `netfilter-persistent`.
7. In GitHub add secrets `VM_HOST`, `VM_USER` and `VM_SSH_KEY` (a deploy key whose public half is in `~/.ssh/authorized_keys` on the VM).

Check it: `https://<your-hostname>/health` should return `{"ok":true,...}`, and `/metrics` shows rooms, players and tick times.

## Accounts and sign-in (§4.12)

Accounts live in a SQLite file in `./data` on the VM (back it up nightly, for example with a cron job copying `data/dead-tracks.db`). Guests work with no setup. Each sign-in provider is optional: set its two variables in `.env` and restart, and its button appears in the menu.

| Provider | Where to register the app | Redirect URL to enter |
|---|---|---|
| Discord | discord.com/developers/applications → OAuth2 | `https://<SERVER_DOMAIN>/auth/discord/callback` |
| Google | console.cloud.google.com → APIs & Services → Credentials → OAuth client (Web) | `https://<SERVER_DOMAIN>/auth/google/callback` |
| GitHub | github.com/settings/developers → OAuth Apps | `https://<SERVER_DOMAIN>/auth/github/callback` |

Then add `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` (and the same for `GOOGLE_` and `GITHUB_`) to `.env`. Only the provider's user id and display name are stored (§10).

The public server runs with `NODE_ENV=production`: the dev panel's commands and the "Dev" sign-in are refused there.

## Development server from your Mac

`pnpm dev` runs everything locally. To let friends join a dev build, expose port 2567 and 5173 with Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:5173`, and another for 2567), then open the client with `?` plus `VITE_SERVER_URL` set to the tunnel URL.

## Adding a region later (§9.2)

Run the same Docker image on another server and add it to `apps/client/public/regions.json`. No code changes.
