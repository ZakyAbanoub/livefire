#!/usr/bin/env bash
# Prepare a BLIND livefire run on one sample app (see samples/SPEC.md "Blindness rules").
#
#   samples/prepare-run.sh <preset> <vulnerable|clean> [--whole|--feature]
#
# Copies samples/<preset>/<variant>/ to $LIVEFIRE_SAMPLES_DIR/<preset>-<variant> (default
# $TMPDIR/livefire-samples), drops selftest.sh (it names the exploits), `git init`s it with one
# commit on main, and prints the exact Workflow args for that copy on stdout. The answer key and
# the twin stay out of reach of every agent.
set -euo pipefail
preset="${1:?preset}"; variant="${2:?vulnerable|clean}"; scope="${3:---whole}"
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/$preset/$variant"
[ -d "$src" ] || { echo "no sample at $src" >&2; exit 2; }
base="${LIVEFIRE_SAMPLES_DIR:-${TMPDIR:-/tmp}/livefire-samples}"
# The directory name must not reveal the variant (agents see repoRoot): a neutral random suffix,
# with the mapping printed to stderr for the operator only.
dest="$base/$preset-app-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
echo "$preset/$variant -> $dest" >&2
rm -rf "$dest"; mkdir -p "$dest"
# copy without dependency/build dirs and without the exploit script
(cd "$src" && tar --exclude=node_modules --exclude=.next --exclude=vendor --exclude=target --exclude=bin --exclude=obj --exclude=.venv --exclude=__pycache__ --exclude=selftest.sh -cf - .) | (cd "$dest" && tar -xf -)
cd "$dest"
git init -q -b main
git -c user.name=livefire -c user.email=livefire@localhost add -A
git -c user.name=livefire -c user.email=livefire@localhost commit -q -m "initial import"
# Blindness check: hint words (case-insensitive) or a hole id (case-SENSITIVE, so base64 hashes in
# lockfiles such as "h5+…" do not trip it). Lockfiles are skipped entirely.
scan() {
  { grep -rniE "vuln|insecure|intentional|\bhole\b|unsafe" . --exclude-dir=.git --exclude-dir=node_modules --exclude='*lock*' --exclude='*.lock' || true
    grep -rnE "\bH[1-5]\b" . --exclude-dir=.git --exclude-dir=node_modules --exclude='*lock*' --exclude='*.lock' || true; }
}
hits="$(scan)"
if [ -n "$hits" ]; then echo "BLINDNESS VIOLATION in $dest:" >&2; echo "$hits" >&2; exit 3; fi
node "$here/../skills/livefire/livefire-args.mjs" "$dest" "$scope"
