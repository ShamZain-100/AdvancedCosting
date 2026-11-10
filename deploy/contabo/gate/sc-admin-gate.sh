#!/usr/bin/env bash
# Smart Costing (Contabo): forced command for the developer's administration login (user sc-dev). One line per key in
# ~sc-dev/.ssh/authorized_keys, written by `install.sh add-key dev`:
#
#   restrict,pty,command="/usr/local/bin/sc-admin-gate <name>" ssh-ed25519 AAAA… <name>
#
# `pty` keeps `ssh -t` working for password prompts. Each login runs exactly one sc-admin command through sudo
# (sudoers/smartcosting-dev); arguments are split on whitespace and never evaluated by a shell. stdin is passed on
# (for `set KEY` and `create-admin`). No shell, no scp/sftp, no forwarding, no Docker.
#
#   ssh sc-dev@<server>                  lists the commands
#   ssh sc-dev@<server> status
#
# Installed by install.sh as root:root 755 in /usr/local/bin/sc-admin-gate.
set -Eeuo pipefail
WHO=${1:-unknown}
CMD=${SSH_ORIGINAL_COMMAND:-}
CMD=${CMD//\"/}
read -ra args <<<"$CMD"
[[ ${args[0]:-} == sudo ]] && args=("${args[@]:1}")
[[ ${args[0]:-} == sc-admin ]] && args=("${args[@]:1}")
for x in "${args[@]}"; do
  [[ $x =~ ^[A-Za-z0-9@._%+=:/-]+$ ]] || { echo "sc-admin-gate: argument not allowed: $x" >&2; exit 126; }
done
cd /
exec sudo -n /usr/local/bin/sc-admin --who "$WHO" "${args[@]}"
