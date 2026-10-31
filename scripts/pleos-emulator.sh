#!/bin/sh
set -eu
export ANDROID_HOME="${ANDROID_HOME:-${HOME}/Library/Android/sdk}"
exec "$ANDROID_HOME/emulator/emulator" -avd Flowad_Pleos_2_1 -no-snapshot -no-boot-anim -no-audio
