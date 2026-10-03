import { pool } from '../config/database';

export const holdSeat = async (userId: string, eventId: string, seatId: string) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const admission = await client.query(
      `SELECT 1 FROM queue_entries
       WHERE user_id = $1 AND event_id = $2 AND status = 'admitted'
       FOR SHARE`,
      [userId, eventId]
    );
    if (admission.rows.length === 0) {
      throw new Error('You must be admitted to the queue before holding a seat');
    }

    const userLock = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (userLock.rows.length === 0) {
      throw new Error('User not found');
    }
    
    // Check purchase limit
    const limitRes = await client.query(
      `SELECT COUNT(*) FROM reservations 
       WHERE user_id = $1 AND event_id = $2 AND status IN ('pending','confirmed')`,
      [userId, eventId]
    );
    const eventRes = await client.query('SELECT purchase_limit_per_user FROM events WHERE id = $1', [eventId]);
    const limit = eventRes.rows[0]?.purchase_limit_per_user || 2;
    if (parseInt(limitRes.rows[0].count) >= limit) {
      throw new Error('Purchase limit exceeded');
    }

    // Attempt to hold
    const seatRes = await client.query(
      `SELECT id FROM seats
       WHERE id = $1 AND event_id = $2 AND status = 'available'
       FOR UPDATE`,
      [seatId, eventId]
    );

    if (seatRes.rows.length === 0) {
      throw new Error('Seat not available');
    }

    const holdMinutes = parseInt(process.env.SEAT_HOLD_MINUTES || '10');
    
    await client.query(
      `UPDATE seats SET status = 'held', held_by_user_id = $1, hold_expires_at = NOW() + INTERVAL '${holdMinutes} minutes' WHERE id = $2`,
      [userId, seatId]
    );

    const res = await client.query(
      `INSERT INTO reservations (user_id, event_id, seat_id, status, expires_at) 
       VALUES ($1, $2, $3, 'pending', NOW() + INTERVAL '${holdMinutes} minutes') RETURNING *`,
      [userId, eventId, seatId]
    );

    await client.query('COMMIT');
    return res.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const releaseSeat = async (userId: string, seatId: string) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE seats
       SET status = 'available', held_by_user_id = NULL, hold_expires_at = NULL
       WHERE id = $1 AND held_by_user_id = $2 AND status = 'held'
       RETURNING id`,
      [seatId, userId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `UPDATE reservations SET status = 'cancelled'
       WHERE seat_id = $1 AND user_id = $2 AND status = 'pending'`,
      [seatId, userId]
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const getAvailableSeats = async (eventId: string) => {
  const res = await pool.query(
    `SELECT id, seat_number, status FROM seats
     WHERE event_id = $1 AND status = 'available' ORDER BY seat_number`,
    [eventId]
  );
  return res.rows;
};

export const getEventSeats = async (eventId: string) => {
  const res = await pool.query(
    'SELECT id, seat_number, status FROM seats WHERE event_id = $1 ORDER BY seat_number',
    [eventId]
  );
  return res.rows;
};
