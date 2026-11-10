# Deploying to the Contabo server (smartcosting.venoralab.com)

Smart Costing runs on the same Contabo VM as PrayerTime, as its own Docker Compose project (`smartcosting`). The host's
nginx (shared with PrayerTime) serves HTTPS for `smartcosting.venoralab.com` and forwards to the app on loopback ports
3100 (web) and 4100 (API). The repository's Caddy proxy (`docker-compose.prod.yml`) is not used on this server.

Images are built **off the server**, either by the GitHub workflow or on the developer's PC, and streamed in over SSH.
Both paths run the same script (`deploy/local-deploy.sh`) and go through the same restricted gate.

| Who | Login | Can do |
|---|---|---|
| GitHub workflow | `sc-deploy` (key in GitHub secrets) | load Smart Costing images, deploy / roll back, status, logs |
| Developer's PC | `sc-deploy` (developer's key) | the same |
| Developer | `sc-dev` | `sc-admin` commands: status, logs, restart, allowed settings, backups, restore, create admin, certificate |
| Server owner | root | everything else: secrets, ports, memory limits, scripts, compose file, nginx files, keys |

Neither login has a shell, Docker access (other than through the gate), file copying or port forwarding. Every request is
logged in `/var/log/smartcosting/` (`gate.log`, `admin.log`, `deploy.log`).

## What a deploy does

`deploy.sh` on the server, called through the gate:

1. checks the images are on the server, the settings are complete and there is free disk
2. backs up the database and uploaded files (`/var/backups/smartcosting/predeploy/`, newest 10 kept)
3. runs `prisma migrate deploy` and the roles/permissions seed with the **new** image
4. starts the new containers and checks `/api/health` and `/login` for up to 3 minutes
5. healthy: records the version and keeps the newest 3 images per service. Unhealthy: **switches back automatically**
   to the previous version (exit code 2)

Migrations are never rolled back, so write them backwards compatible: add nullable columns or columns with a default,
and drop old columns in a later release.

## 1. Server owner: one-time setup

On the server (Ubuntu with Docker, the compose plugin, nginx and certbot, as already set up for PrayerTime):

```bash
# from your PC: copy the server files to the server
git archive origin/main deploy/contabo | ssh root@<server> 'rm -rf /root/smartcosting-setup && mkdir -p /root/smartcosting-setup && tar -x -C /root/smartcosting-setup'

# on the server
cd /root/smartcosting-setup/deploy/contabo
sudo bash install.sh install
```

It creates the `sc-deploy` and `sc-dev` users (no passwords), `/opt/smartcosting` with root-owned scripts, the gates,
the sudoers rule, the nightly backup (02:45, after PrayerTime's 02:30) and `/opt/smartcosting/.env` with fresh secrets.
**Keep a copy of `/opt/smartcosting/.env` in your password manager.** No script backs it up.

DNS: an `A` record `smartcosting.venoralab.com` → the server's IP.

Allow the keys (public halves only):

```bash
sudo bash install.sh add-key deploy github     github-deploy.pub     # the GitHub workflow
sudo bash install.sh add-key deploy developer  developer.pub         # deploys from the developer's PC
sudo bash install.sh add-key dev    developer  developer.pub         # sc-admin for the developer
sudo bash install.sh keys                                            # list;  remove-key <deploy|dev> <name> revokes
```

Create the GitHub key pair once, on your PC: `ssh-keygen -t ed25519 -N '' -C github-deploy -f github-deploy`.
`github-deploy.pub` goes to the server. The private file goes into the GitHub secret, then delete it.

**Later changes to the server files** (compose file, scripts, gates, nginx site) are never deployed by the gate. After
they are merged, copy `deploy/contabo` again and run `sudo bash install.sh update`.

Memory: the limits add up to about 1.3 GB (db 384 MB, API 512 MB, web 384 MB), next to PrayerTime's about 2.5 GB on the
4 GB VM. Change them in `/opt/smartcosting/.env` if needed.

## 2. GitHub: who may deploy

Repository **Settings → Environments → New environment `production`**:

- **Required reviewers:** the owner. Tick **Prevent self-review** if the developer must not approve their own deploy.
- **Deployment branches and tags:** selected branches → `main`.
- **Environment secrets:** `DEPLOY_SSH_KEY` (contents of `github-deploy`) and `DEPLOY_KNOWN_HOSTS`
  (output of `ssh-keyscan -t ed25519 <server ip>`).
- **Environment variables:** `DEPLOY_HOST` = the server's IP.

Give the developer **Write** access to the repository. They can then start a deploy, which waits for your approval.
Protect `main` (Settings → Branches) if changes must go through pull requests.

## 3. Deploying

**From GitHub:** Actions → Deploy → Run workflow (or `gh workflow run deploy.yml -f services="api web"`). Approve it
under the run's "Review deployments". Leave `ref` empty for the tip of `main`. An older commit SHA is a **rollback**.

**From the developer's PC** (Linux; macOS and Git Bash/WSL also work). It needs Docker, git, ssh, gzip, curl and at
least 6 GB of free disk:

```bash
git fetch origin
export DEPLOY_SSH=sc-deploy@<server>
deploy/local-deploy.sh plan      # checks only
deploy/local-deploy.sh build     # builds from origin/main and smoke-tests the images with a throw-away database
deploy/local-deploy.sh ship      # uploads the images (one compressed stream)
deploy/local-deploy.sh deploy    # dry run, then asks for the first 7 characters of the SHA
deploy/local-deploy.sh verify
```

Another commit: `REF=<sha>`. One service: `SERVICES=web`. Rollback: `REF=<previous sha> deploy/local-deploy.sh deploy`
(the previous images are still on the server, so there's nothing to build or ship).

## 4. First release

1. Deploy both services (GitHub or PC, as above). The first release must include both `api` and `web`.
2. HTTPS:
   ```bash
   ssh sc-dev@<server> site-init       # temporary HTTP site so Let's Encrypt can check the domain
   ssh sc-dev@<server> cert            # certificate (renewed automatically by the host's certbot timer)
   ssh sc-dev@<server> site-install    # the full HTTPS site
   ```
3. First administrator: `ssh -t sc-dev@<server> create-admin you@example.com` (asks for a temporary password; the
   app asks for a new one at the first sign-in).
4. Sign in at https://smartcosting.venoralab.com.

## 5. Developer administration (`sc-dev`)

```bash
ssh sc-dev@<server>                                  # lists the commands
ssh sc-dev@<server> status                           # containers, versions, memory
ssh sc-dev@<server> logs api 300
ssh sc-dev@<server> env                              # settings that may be changed (set / empty, never the values)
printf '%s' 'mailto:admin@venoralab.com' | ssh sc-dev@<server> set VAPID_SUBJECT
ssh sc-dev@<server> restart api                      # apply changed settings
ssh sc-dev@<server> backup before-import             # manual backup
ssh sc-dev@<server> backups                          # list
ssh sc-dev@<server> restore nightly/20261110T024500Z --yes [--with-uploads]
ssh sc-dev@<server> deploy-log 200
```

Settings the developer may change: `WEB_ORIGIN`, `ENABLE_SWAGGER`, `DISABLE_MAINTENANCE`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. A restore always takes a safety backup first, and the result names it so the
restore can be undone.

## 6. Backups

Nightly at 02:45 (14 kept), before every deploy (10 kept) and on request (kept until deleted), each with the database
dump, the uploaded files and a checksum file, in `/var/backups/smartcosting/`. They live on the same server, so the owner
should copy that folder off the server regularly (e.g. rclone to cloud storage). Losing the VM otherwise loses them.

## 7. When something goes wrong

| Symptom | Where to look |
|---|---|
| deploy exit 1 | failed before switching; the old version still runs. `ssh sc-dev@<server> deploy-log 100` |
| deploy exit 2 | new version unhealthy, rolled back. `ssh sc-dev@<server> logs api 300` |
| deploy exit 3 | no previous version, or the rollback is unhealthy too: owner needed |
| site shows 502 | the containers are down: `status`, then `logs api` / `logs web` |
| sign-in fails behind nginx | check `WEB_ORIGIN` (`env`) and that `/api/` and `/` are on the same domain |
