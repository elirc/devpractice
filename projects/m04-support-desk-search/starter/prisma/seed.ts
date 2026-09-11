import { PrismaClient, TicketStatus } from '@prisma/client';

/**
 * Repeatable seed: running it twice produces the same data, not duplicates.
 * Every record is fictional.
 */
const prisma = new PrismaClient();

const USERS = [
  { id: 'user-dana', displayName: 'Dana (dispatcher)' },
  { id: 'user-ravi', displayName: 'Ravi (dispatcher)' },
];

const TICKETS = [
  { id: 'seed-t-1', title: 'Card reader rejects every chip payment', body: 'Till 3 shows "card not read" for chip payments. Contactless works.', status: TicketStatus.open, customerName: 'Brightleaf Bakery', ownerId: 'user-dana', createdAt: '2026-08-31T09:12:00.000Z' },
  { id: 'seed-t-2', title: 'Monthly invoice shows last month total', body: 'The September invoice repeats the August figure.', status: TicketStatus.pending, customerName: 'Halden Legal', ownerId: 'user-dana', createdAt: '2026-09-01T14:03:00.000Z' },
  { id: 'seed-t-3', title: 'Cannot add a second delivery address', body: 'Save does nothing and no error appears.', status: TicketStatus.open, customerName: 'Orrin Cycles', ownerId: 'user-ravi', createdAt: '2026-09-02T08:47:00.000Z' },
  { id: 'seed-t-4', title: 'Password reset email never arrives', body: 'Two staff requested a reset yesterday; nothing arrived.', status: TicketStatus.closed, customerName: 'Vellum Studio', ownerId: 'user-ravi', createdAt: '2026-08-20T16:30:00.000Z' },
  { id: 'seed-t-5', title: 'Export produces an empty spreadsheet', body: 'The CSV downloads with only a header row.', status: TicketStatus.pending, customerName: 'Kestrel Freight', ownerId: 'user-dana', createdAt: '2026-09-03T11:15:00.000Z' },
];

const COMMENTS = [
  { id: 'seed-c-1', ticketId: 'seed-t-1', authorId: 'user-dana', body: 'Asked the customer to try another card.', createdAt: '2026-08-31T09:40:00.000Z' },
  { id: 'seed-c-2', ticketId: 'seed-t-1', authorId: 'user-ravi', body: 'Three cards tried, same message.', createdAt: '2026-08-31T10:05:00.000Z' },
  { id: 'seed-c-3', ticketId: 'seed-t-3', authorId: 'user-ravi', body: 'Reproduced on staging.', createdAt: '2026-09-02T09:30:00.000Z' },
];

async function main(): Promise<void> {
  for (const user of USERS) {
    await prisma.trainingUser.upsert({ where: { id: user.id }, create: user, update: { displayName: user.displayName } });
  }
  for (const ticket of TICKETS) {
    const data = { ...ticket, createdAt: new Date(ticket.createdAt) };
    await prisma.ticket.upsert({ where: { id: ticket.id }, create: data, update: data });
  }
  for (const comment of COMMENTS) {
    const data = { ...comment, createdAt: new Date(comment.createdAt) };
    await prisma.comment.upsert({ where: { id: comment.id }, create: data, update: data });
  }
  const counts = {
    users: await prisma.trainingUser.count(),
    tickets: await prisma.ticket.count(),
    comments: await prisma.comment.count(),
  };
  console.log('Seeded', counts);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
