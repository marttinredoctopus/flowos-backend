/**
 * Dev launcher: starts embedded PostgreSQL, runs migrations, then starts the API server.
 */
const { default: EmbeddedPostgres } = require('embedded-postgres');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '.postgres-data');
const alreadyInitialised = fs.existsSync(path.join(dataDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: 5432,
  persistent: true,
});

async function main() {
  console.log('\x1b[36m[DB]\x1b[0m Starting PostgreSQL...');

  if (!alreadyInitialised) {
    await pg.initialise();
  }

  await pg.start();
  console.log('\x1b[36m[DB]\x1b[0m PostgreSQL ready on port 5432');

  // Ensure flowos database exists
  const client = pg.getPgClient();
  await client.connect();
  const r = await client.query("SELECT 1 FROM pg_database WHERE datname='flowos'");
  if (r.rowCount === 0) {
    await client.query('CREATE DATABASE flowos');
    console.log('\x1b[36m[DB]\x1b[0m Created database: flowos');
  }
  await client.end();

  // Run migration
  console.log('\x1b[36m[DB]\x1b[0m Running migrations...');
  await runProcess('node', [
    '-r', 'ts-node/register',
    path.join(__dirname, '..', 'migrations', '001_create_content_tables.ts'),
  ]);
  console.log('\x1b[36m[DB]\x1b[0m Migrations done');

  // Start the API server
  console.log('\x1b[32m[API]\x1b[0m Starting server...');
  const server = spawn(
    path.join(__dirname, '..', 'node_modules', '.bin', 'ts-node-dev'),
    ['--respawn', '--transpile-only', 'src/index.ts'],
    { stdio: 'inherit', cwd: path.join(__dirname, '..') }
  );

  const shutdown = async () => {
    server.kill();
    await pg.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function runProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`))));
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
