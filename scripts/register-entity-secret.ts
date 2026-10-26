/**
 * One-time entity secret registration.
 * Run: bun run scripts/register-entity-secret.ts
 * NEVER commit or log the output secret or recovery file.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { registerEntitySecretCiphertext, initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets'

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY
  if (!apiKey) throw new Error('CIRCLE_API_KEY must be set in .env')

  // 1. Generate secret without printing it
  const entitySecret = crypto.randomBytes(32).toString('hex')

  // 2. Register ciphertext + write recovery file
  const recoveryDir = '/home/user/app/.circle'
  fs.mkdirSync(recoveryDir, { recursive: true })

  const response = await registerEntitySecretCiphertext({
    apiKey,
    entitySecret,
    recoveryFileDownloadPath: recoveryDir,
  })

  const recoveryPath = path.join(recoveryDir, 'recovery_file.dat')
  if (response.data?.recoveryFile) {
    fs.writeFileSync(recoveryPath, response.data.recoveryFile)
  }

  // 3. Persist to .env
  const envPath = path.join('/home/user/app', '.env')
  fs.appendFileSync(envPath, `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`, 'utf-8')

  // 4. Verify with a read-only call
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })
  await client.listWalletSets({ pageSize: 1 })

  console.log('OK')
}

main().catch((e) => { console.error(e); process.exit(1) })
