import { pool } from '../config/database';
import { logger } from '../config/logger';

export const run = async () => {
  try {
    const res = await pool.query(`
      UPDATE seats 
      SET status = 'available', held_by_user_id = NULL, hold_expires_at = NULL 
      WHERE status = 'held' AND hold_expires_at < NOW()
      RETURNING id
    `);
    
    if (res.rowCount && res.rowCount > 0) {
      logger.info(`Expired ${res.rowCount} seat holds`);
      // Also update reservations
      await pool.query(`
        UPDATE reservations SET status = 'expired'
        WHERE status = 'pending' AND expires_at < NOW()
      `);
    }
  } catch (error) {
    logger.error('Error expiring holds', error);
  }
};
