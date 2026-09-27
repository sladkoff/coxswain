#!/bin/sh
# Installs the latest coxswain release on macOS or Linux:
#   curl -fsSL https://raw.githubusercontent.com/sladkoff/coxswain/main/install.sh | sh
# A version picks a release instead (pre-releases too): ... | sh -s -- 0.2.0-rc.1
set -eu

releases=https://github.com/sladkoff/coxswain/releases
# /releases/latest redirects to /releases/tag/vX of the newest release that isn't a pre-release.
version=${1:-$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$releases/latest")}
version=${version##*/}
version=${version#v}

case $(uname -m) in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) echo "No coxswain build for $(uname -m)." >&2; exit 1 ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

case $(uname -s) in
  Darwin)
    curl -fL "$releases/download/v$version/coxswain-$version-mac-$arch.zip" -o "$tmp/coxswain.zip"
    apps=/Applications
    [ -w "$apps" ] || { apps=$HOME/Applications; mkdir -p "$apps"; }
    rm -rf "$apps/coxswain.app"
    ditto -xk "$tmp/coxswain.zip" "$apps" # ditto, not unzip: keeps the framework symlinks
    echo "Installed coxswain $version in $apps/coxswain.app"
    ;;
  Linux)
    [ "$arch" = x64 ] && arch=x86_64 # the AppImage names x64 that way
    mkdir -p "$HOME/.local/bin"
    curl -fL "$releases/download/v$version/coxswain-$version-linux-$arch.AppImage" -o "$tmp/coxswain"
    chmod +x "$tmp/coxswain"
    mv "$tmp/coxswain" "$HOME/.local/bin/coxswain"
    echo "Installed coxswain $version as ~/.local/bin/coxswain"
    ;;
  *) echo "On Windows, run the installer from $releases" >&2; exit 1 ;;
esac
