# LitVerse Frontend

React + Vite frontend for the four LitVerse contracts in the repository.

## Run locally

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

For Windows PowerShell, if script execution blocks npm commands, use `npm.cmd`.

## Vercel

Set the Vercel project Root Directory to `frontend`. Framework preset: Vite. Build command: `npm run build`. Output directory: `dist`.

Set the variables from `.env.example` in Vercel Project Settings. The defaults in the source are copied from `scripts/verify-deployment.ts`; the app checks that each configured address has contract bytecode before loading. Verify these addresses against the current LiteForge deployment before production use.

## Contract alignment

- Network: LiteForge, chain ID 4441, native currency zkLTC.
- NFT: reads live sale price, max supply, minted count, wallet limit, sale start, pause and reveal state; public mint calls `publicMint(quantity)`.
- Marketplace: uses `listNFT`, `buyNFT`, `cancelListing`, collection approval checks and ERC-721 operator approval.
- Auction: uses `createAuction`, `placeBid`, `finalizeAuction`, `claimNFT`, `cancelAuction` and `withdraw`.
- Collection factory: uses `createCollection`, `collectionCount`, `collections` and `CollectionCreated` events.
- NFT metadata: the current NFT contract's `publicMint` does not accept a metadata URI. `setTokenURI` is owner-only. The UI therefore does not pretend that a public minter can attach an image; collection owners can set token URIs through the owner-only control.

## Honest data behavior

NFTs, listings, auctions and activity are read from contract calls and emitted events. If the RPC cannot return logs or a contract address has no bytecode, the UI shows an error/incomplete state instead of sample transactions.

## Not included yet

Community posts/comments/likes require a Supabase project URL, anon key and agreed database/storage policies. No fake community data is bundled.
