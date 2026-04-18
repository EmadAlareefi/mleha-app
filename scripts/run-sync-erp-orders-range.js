#!/usr/bin/env node

if (!process.argv.includes('--prompt') && !process.argv.includes('-p')) {
  process.argv.splice(2, 0, '--prompt');
}

require('./run-sync-unsynced-erp-orders.js');
