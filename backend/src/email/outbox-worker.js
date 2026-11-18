import { textToHtml } from './mime.js';

const STALE_LOCK = "interval '5 minutes'";
const BACKOFF_BASE_SECONDS = 30;

/**
 * Delivers rows from email_outbox. Postgres is the source of truth: rows are
 * claimed with FOR UPDATE SKIP LOCKED so several instances can run safely, and
 * rows stuck in 'sending' after a crash are reclaimed after five minutes.
 * Delivery is at-least-once.
 */
export function createEmailOutboxWorker({ database, mailer, documents, logger, pollMs, batchSize }) {
  let timer = null;
  let running = null;
  let closed = false;
  let wakeRequested = false;

  async function claimBatch() {
    const { rows } = await database.query(
      `UPDATE email_outbox o
          SET status = 'sending', locked_at = now(), attempts = o.attempts + 1
        WHERE o.id IN (
          SELECT id FROM email_outbox
           WHERE (status = 'pending' AND next_attempt_at <= now())
              OR (status = 'sending' AND locked_at < now() - ${STALE_LOCK})
           ORDER BY id
           LIMIT $1
           FOR UPDATE SKIP LOCKED)
        RETURNING o.*`,
      [batchSize],
    );
    return rows;
  }

  async function loadAttachment(row) {
    const { rows } = await database.query(
      `SELECT p.*, r.period, r.branding
         FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
        WHERE p.id = $1`,
      [row.payslip_id],
    );
    if (!rows[0]) return null;
    // The same stored file the employee would download (rendered if not archived yet).
    const pdf = await documents.bytesFor(rows[0]);
    return { filename: row.attachment_name, contentType: 'application/pdf', content: pdf };
  }

  async function deliver(row) {
    try {
      const attachments = [];
      if (row.kind === 'payslip') {
        const attachment = await loadAttachment(row);
        if (!attachment) throw Object.assign(new Error('Payslip no longer exists'), { retryable: false });
        attachments.push(attachment);
      }
      const result = await mailer.send({
        fromName: row.from_name,
        to: row.to_email,
        subject: row.subject,
        text: row.body_text,
        html: textToHtml(row.body_text),
        attachments,
      });
      await database.query(
        `UPDATE email_outbox SET status = 'sent', sent_at = now(), locked_at = NULL, last_error = NULL, provider_message_id = $2
          WHERE id = $1`,
        [row.id, result.messageId ?? null],
      );
      logger.info('email_sent', { outboxId: row.id, kind: row.kind, provider: mailer.provider });
    } catch (error) {
      const giveUp = error.retryable === false || row.attempts >= row.max_attempts;
      await database.query(
        `UPDATE email_outbox
            SET status = $2, locked_at = NULL, last_error = $3,
                next_attempt_at = now() + make_interval(secs => $4)
          WHERE id = $1`,
        [row.id, giveUp ? 'failed' : 'pending', String(error.message).slice(0, 500), BACKOFF_BASE_SECONDS * 2 ** row.attempts],
      );
      logger.warn('email_failed', { outboxId: row.id, attempts: row.attempts, gaveUp: giveUp, error });
    }
  }

  async function tick() {
    do {
      wakeRequested = false;
      let batch;
      do {
        batch = await claimBatch();
        for (const row of batch) {
          if (closed) return;
          await deliver(row);
        }
      } while (batch.length === batchSize && !closed);
    } while (wakeRequested && !closed);
  }

  function schedule(delay) {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
    timer.unref?.();
  }

  function run() {
    if (running) {
      wakeRequested = true;
      return;
    }
    running = tick()
      .catch((error) => logger.error('email_worker_tick_failed', { error }))
      .finally(() => {
        running = null;
        schedule(pollMs);
      });
  }

  return {
    start() {
      schedule(0);
      logger.info('email_worker_started', { provider: mailer.provider, pollMs });
      return this;
    },
    /** Process new rows now instead of waiting for the next poll. */
    nudge() {
      if (!closed) run();
    },
    async close() {
      closed = true;
      clearTimeout(timer);
      await running;
    },
  };
}
