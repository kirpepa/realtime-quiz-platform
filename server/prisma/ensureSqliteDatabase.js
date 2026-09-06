import 'dotenv/config';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL обязателен');

// Remote databases do not need a local file. For SQLite, Prisma resolves a
// relative file URL from the schema directory, so mirror that behavior here.
if (databaseUrl.startsWith('file:')) {
  const schemaDirectory = path.dirname(fileURLToPath(import.meta.url));
  const configuredPath = databaseUrl.slice('file:'.length).split('?')[0];
  const databasePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(schemaDirectory, configuredPath);

  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const handle = await fs.open(databasePath, 'a', 0o600);
  await handle.close();
}
