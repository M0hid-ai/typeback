'use strict';

/**
 * Launcher for `npm start`.
 *
 * VS Code exports ELECTRON_RUN_AS_NODE=1 into its integrated terminal (it uses
 * Electron internally and needs its own child processes to behave like plain
 * Node). Anything you launch from that terminal inherits it, which makes our
 * Electron start up as a bare Node process: require('electron') then returns the
 * path to the exe instead of the API, and the app dies on `app is undefined`.
 *
 * Running `electron .` directly works fine from PowerShell but not from the VS
 * Code terminal, which is a genuinely confusing way to lose twenty minutes. So
 * we strip the variable and spawn Electron ourselves.
 */

const { spawn } = require('child_process');

// In a plain Node process this module exports the path to the Electron binary.
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env
});

child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
