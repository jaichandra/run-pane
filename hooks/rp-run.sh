#!/bin/sh
# Typed into a multiplexer pane by /rp: `sh rp-run.sh '<command>'`. It clears the pane, shows the command,
# runs it in a login shell and ends with its exit code on a line of its own, which is how the Run pane
# knows the command is over. The command is an argument, never part of this text.
printf '\033[H\033[2J\033[3J'
printf '\033[2m$ %s\033[0m\n' "$1"
# Caught, not ignored: Ctrl+C reaches the command (a caught signal is reset by exec) and this shell
# stays to say how it ended.
trap : INT
sh -lc -- "$1"
c=$?
printf '\n\033[2m\342\224\200\342\224\200 exit %s\033[0m\n' "$c"
