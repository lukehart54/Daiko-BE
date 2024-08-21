import { Pool } from "pg";
import pool from "./db"; // Adjust the path to your db connection file

export const getAccessTokenByInstitution = async (
  pool: Pool,
  institution: string
): Promise<string | null> => {
  try {
    const result = await pool.query(
      `SELECT access_token FROM internal_data.access_tokens WHERE institution = $1 ORDER BY expiration_date DESC LIMIT 1`,
      [institution]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].access_token;
  } catch (error) {
    console.error(
      `Error fetching access token for institution ${institution}:`,
      error
    );
    throw new Error(
      `Unable to fetch access token for institution ${institution}`
    );
  }
};
