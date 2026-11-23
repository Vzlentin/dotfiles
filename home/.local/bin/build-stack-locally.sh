#!/usr/bin/env bash
# Builds the harness stack from origin/main of its checkouts and installs it for Pi:
# harness, workflows and projects with their Pi packages into the npm folder of Pi, and orda with cargo.
# It builds from a copy of origin/main, so the branch and the changes of each checkout stay as they are.
# It stops the harness hosts at the end, so the next command starts them on the new code.
# Usage: build-stack-locally.sh [--force]   (--force also stops a host that has running work)
# STACK_SRC is the folder of the checkouts, default ~/Dev/perso.
set -euo pipefail

force=0
case "${1:-}" in
  "") ;;
  --force) force=1 ;;
  *) echo "usage: build-stack-locally.sh [--force]" >&2; exit 2 ;;
esac

checkouts="${STACK_SRC:-$HOME/Dev/perso}"
npm_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/npm"
state="${XDG_STATE_HOME:-$HOME/.local/state}/stack-main"
packs="$state/pack"
logs="$state/log"

fail() {
  echo "build-stack-locally: $*" >&2
  exit 1
}

# Runs a command with its output in a log file, and prints the end of the log when it fails.
logged() {
  local log="$logs/$1.log"
  shift
  "$@" >"$log" 2>&1 || { tail -n 30 "$log" >&2; fail "$* failed, see $log"; }
}

# Copies origin/main of the checkout $1 into a clean build folder, and prints `<folder> <short sha>`.
export_main() {
  local checkout="$checkouts/$1" build="$state/src/$1"
  [[ -d $checkout/.git ]] || fail "no checkout at $checkout"
  git -C "$checkout" fetch --quiet origin main
  rm -rf "$build"
  mkdir -p "$build"
  git -C "$checkout" archive origin/main | tar -x -C "$build"
  echo "$build $(git -C "$checkout" rev-parse --short origin/main)"
}

# Packs the npm package of the folder $1 into the pack folder, and prints the path of the tarball.
pack() {
  local file
  file="$(cd "$1" && npm pack --silent --pack-destination "$packs" "${@:2}" 2>>"$logs/pack.log" | tail -n 1)"
  [[ -f $packs/$file ]] || fail "npm pack gave no tarball in $1, see $logs/pack.log"
  echo "$packs/$file"
}

# Prints `<pid> <host>` for each harness host that runs from the npm folder of Pi.
running_hosts() {
  local pid args
  while read -r pid args; do
    [[ $args == *"$npm_dir/node_modules/@vzlentin/harness/dist/cli.js"* && $args == *" host" ]] || continue
    args="${args% host}"
    echo "$pid ${args##* }"
  done < <(pgrep -af '@vzlentin/harness/dist/cli\.js' || true)
}

mkdir -p "$packs" "$logs"
rm -f "$packs"/*.tgz "$logs"/*.log
[[ -f $npm_dir/package.json ]] || fail "no package.json in $npm_dir"

specs=()
summary=()
for repo in harness workflows projects; do
  read -r build sha < <(export_main "$repo")
  echo "build $repo $sha"
  logged "$repo-ci" npm --prefix "$build" ci --no-audit --no-fund
  for dir in "$build" "$build/pi"; do
    # The root package builds in its prepack script. The Pi package has only source files.
    if [[ $dir == "$build" ]]; then tarball="$(pack "$dir")"; else tarball="$(pack "$dir" --ignore-scripts)"; fi
    specs+=("$(tar -xOzf "$tarball" package/package.json | jq -r .name)=file:$tarball")
  done
  summary+=("$repo $sha")
done

if (( ! force )); then
  while read -r pid host; do
    if "$npm_dir/node_modules/.bin/harness" --host "$host" tree 2>/dev/null | grep -Eq '  (running|busy)  '; then
      fail "the host $host (pid $pid) has running work: wait for it, or use --force"
    fi
  done < <(running_hosts)
fi

echo "install in $npm_dir"
cp "$npm_dir/package.json" "$state/package.json.before"
# Each @vzlentin package is an override, so no package takes another copy from the registry.
# A Pi package is also a dependency, which Pi loads.
jq '
  reduce ($ARGS.positional[] | capture("^(?<name>[^=]+)=(?<spec>.*)$")) as $p (.;
    .overrides[$p.name] = $p.spec
    | if $p.name | startswith("@vzlentin/pi-") then .dependencies[$p.name] = $p.spec else . end)
' "$state/package.json.before" --args "${specs[@]}" >"$npm_dir/package.json"
# A tarball keeps the version of the last release, so npm keeps an installed copy of that version.
rm -rf "$npm_dir/node_modules/@vzlentin"
if [[ -f $npm_dir/package-lock.json ]]; then
  jq 'del(.packages[keys[] | select(contains("node_modules/@vzlentin/"))])' "$npm_dir/package-lock.json" >"$state/lock.json"
  mv "$state/lock.json" "$npm_dir/package-lock.json"
fi
logged install npm --prefix "$npm_dir" install --legacy-peer-deps --no-audit --no-fund

for spec in "${specs[@]}"; do
  name="${spec%%=*}"
  tarball="${spec#*=file:}"
  [[ $name == @vzlentin/pi-* ]] && continue
  cmp -s <(tar -xOzf "$tarball" package/dist/cli.js) "$npm_dir/node_modules/$name/dist/cli.js" ||
    fail "$npm_dir/node_modules/$name is not the build of main"
done
[[ $(find "$npm_dir/node_modules" -path '*/@vzlentin/harness/package.json' | wc -l) -eq 1 ]] ||
  fail "$npm_dir has more than one copy of @vzlentin/harness"

while read -r pid host; do
  echo "stop the host $host (pid $pid)"
  kill -TERM "$pid" 2>/dev/null || continue
  for _ in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  ! kill -0 "$pid" 2>/dev/null || fail "the host $host (pid $pid) did not stop"
done < <(running_hosts)

if command -v cargo >/dev/null && [[ -d $checkouts/orda/.git ]]; then
  read -r build sha < <(export_main orda)
  echo "build orda $sha"
  CARGO_TARGET_DIR="$state/target" logged orda cargo install --quiet --locked --path "$build"
  summary+=("orda $sha")
else
  echo "skip orda: it needs cargo and $checkouts/orda"
fi

rm -rf "$state/src"

printf '\ninstalled from origin/main:\n'
printf '  %s\n' "${summary[@]}"
echo "Run /reload in each open Pi session."
