# M03 reference solution

Only `src/routes/tickets.ts` changes.

```bash
cd ../starter
cp ../solution/src/routes/tickets.ts src/routes/tickets.ts
npm run check:baseline && npm run check:mission
```

The repair is deliberately small: ownership becomes part of the query through
`findOwnedTicket`, every inaccessible resource answers 404, and no refusal
carries data from the record it refused.
