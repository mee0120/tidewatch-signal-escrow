/**
 * Transfer SignalEscrow owner + provider to a new address.
 * Order: setProvider first (requires owner), transferOwnership second.
 * Built with Arc Studio — https://studio.arc.io
 */

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets'
import { waitForSuccessfulTransaction } from '../src/onchain-wait'

const WALLET_ID   = '3c2464b2-8369-52e2-a782-800bbeca5396'
const CONTRACT    = '0x325a115658cbdaa9989a10e3b6825f7331a38611'
const NEW_ADDRESS = '0x1355139697C0E7f449965De9264F718755A5E539'

async function sendAndWait(
  walletsClient: ReturnType<typeof initiateDeveloperControlledWalletsClient>,
  label: string,
  sig: string,
  params: string[],
): Promise<string> {
  const res = await walletsClient.createContractExecutionTransaction({
    walletId: WALLET_ID,
    contractAddress: CONTRACT,
    abiFunctionSignature: sig,
    abiParameters: params,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  })
  const txId = res.data?.id
  if (!txId) throw new Error(`${label}: no transaction id returned — ${JSON.stringify(res)}`)
  console.log(`  [${label}] tx id: ${txId}`)

  const completed = await waitForSuccessfulTransaction(
    () => walletsClient.getTransaction({ id: txId }),
    (r) => r.data?.transaction?.state,
    {
      label,
      onState: (state, attempt) => {
        if (attempt % 5 === 0) console.log(`  [${label}] state: ${state}`)
      },
    },
  )

  const txHash = completed.data?.transaction?.txHash ?? '(hash not yet indexed)'
  console.log(`  [${label}] COMPLETE — txHash: ${txHash}`)
  return txHash
}

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET ?? process.env.ENTITY_SECRET
  if (!apiKey || !entitySecret) {
    throw new Error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET (or ENTITY_SECRET) must be set in .env')
  }

  const walletsClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })

  console.log(`Transferring owner + provider of ${CONTRACT} to ${NEW_ADDRESS}`)

  // 1. setProvider first — requires caller to be owner
  const spHash = await sendAndWait(walletsClient, 'setProvider', 'setProvider(address)', [NEW_ADDRESS])

  // 2. transferOwnership — relinquishes owner role last
  const toHash = await sendAndWait(walletsClient, 'transferOwnership', 'transferOwnership(address)', [NEW_ADDRESS])

  console.log('\n=== Done ===')
  console.log(`setProvider    txHash: ${spHash}`)
  console.log(`transferOwnership txHash: ${toHash}`)
  console.log(`New owner:    ${NEW_ADDRESS}`)
  console.log(`New provider: ${NEW_ADDRESS}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
