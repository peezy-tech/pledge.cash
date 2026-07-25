export function supportInvoiceLockKey(invoiceId: string): string {
  // The prefix sorts before quote and inventory lock keys. Recurring quote
  // creation holds this lock before reserving inventory, so payment binding
  // must acquire the same global lock order to avoid a lock inversion.
  return JSON.stringify(["0-support-invoice", invoiceId]);
}

export function supportPayerBoardroomPaymentLockKey(
  boardroom: string,
  payer: string,
): string {
  return JSON.stringify([
    "0-support-payer-boardroom-payment",
    boardroom.toLowerCase(),
    payer.toLowerCase(),
  ]);
}
