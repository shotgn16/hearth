#!/usr/bin/env node
// Command-line entry point. Run "hearth-server help" for the commands.
process.removeAllListeners('warning');
require('../src/cli').main(process.argv.slice(2));
