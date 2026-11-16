#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export JAVA_HOME="${FLOWAD_JAVA_HOME:-${HOME}/Library/Flowad/toolchains/jdk-17.0.21+9/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-${HOME}/Library/Android/sdk}"
cd "$SCRIPT_DIR/../pleos-android"
exec ./gradlew "$@"
