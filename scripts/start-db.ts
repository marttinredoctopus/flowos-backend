import EmbeddedPostgres from 'embedded-postgres';
import path from 'path';

const pg = new EmbeddedPostgres({
  databaseDir: path.join(process.cwd(), '.postgres-data'),
  user: 'postgres',
  password: 'postgres',
  port: 5432,
  persistent: true,
});

async function main() {
  await pg.initialise();
  await pg.start();

  // Create the database if it doesn't exist
  const client = pg.getPgClient();
  await client.connect();
  const res = await client.query(`SELECT 1 FROM pg_database WHERE datname='flowos'`);
  if (res.rowCount === 0) {
    await client.query('CREATE DATABASE flowos');
    console.log('Created database: flowos');
  }
  await client.end();

  console.log('PostgreSQL running on port 5432');

  process.on('SIGINT', async () => {
    await pg.stop();
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch(console.error);
