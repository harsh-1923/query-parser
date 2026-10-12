#!/usr/bin/env sh
# Downloads ByteBaker/indian-names lists (BSD-3-Clause) next to this script.
set -e
base=https://raw.githubusercontent.com/ByteBaker/indian-names/master/indian_names
for f in first.male.names first.female.names last.names; do curl -sfL -o "$f" "$base/$f"; done
